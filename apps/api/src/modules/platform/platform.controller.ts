import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  cancelInvoiceSchema,
  changeGraceSchema,
  changePlanSchema,
  changePriceSchema,
  changeTrialSchema,
  createCustomerSchema,
  customerActiveSchema,
  customerDataSchema,
  generateInvoicesSchema,
  invoiceListQuerySchema,
  markInvoicePaidSchema,
  planSchema,
  platformChangePasswordSchema,
  platformEnrollStartSchema,
  platformLoginSchema,
  platformRecoverySchema,
  platformSettingsSchema,
  platformTotpSchema,
  startSupportSchema,
  subscriptionReasonSchema,
  zTotpCode,
} from '@app/shared';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ApiZodBody, ZBody, ZQuery } from '../../core/validation/zod.js';
import { CustomersService } from './customers.service.js';
import { InvoicesService } from './invoices.service.js';
import { OverviewService } from './overview.service.js';
import { type IssuedPlatformSession, PlatformAuthService } from './platform-auth.service.js';
import { PlatformDirectoryService } from './platform-directory.service.js';
import {
  Actor,
  AllowsPendingPassword,
  PlatformController,
  PlatformPublic,
} from './platform.decorators.js';
import { type PlatformActor, type PlatformRequest, actorOf } from './platform.keys.js';
import { PlansService } from './plans.service.js';
import { PlatformSettingsService } from './settings.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SupportService } from './support.service.js';

export const PLATFORM_REFRESH_COOKIE = 'app_platform_refresh';
const loginLimit = () => Number(process.env.PLATFORM_LOGIN_RATE_LIMIT_PER_MINUTE) || 5;

/** Platform admin login (D041): password, then TOTP or a recovery code; first access enrolls. */
@ApiTags('platform')
@PlatformController()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly config: AppConfig,
  ) {}

  @PlatformPublic()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Senha do administrador (devolve a próxima etapa: código ou cadastro do 2FA)',
  })
  @ApiZodBody(platformLoginSchema)
  login(
    @ZBody(platformLoginSchema) body: z.output<typeof platformLoginSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.auth.login(body.email, body.password, actorOf(req));
  }

  @PlatformPublic()
  @Post('2fa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @ApiZodBody(platformTotpSchema)
  async verify(
    @ZBody(platformTotpSchema) body: z.output<typeof platformTotpSchema>,
    @Req() req: PlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.verifyCode(body.challenge, body.code, actorOf(req)));
  }

  @PlatformPublic()
  @Post('2fa/recover')
  @HttpCode(200)
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @ApiZodBody(platformRecoverySchema)
  async recover(
    @ZBody(platformRecoverySchema) body: z.output<typeof platformRecoverySchema>,
    @Req() req: PlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.auth.recover(body.challenge, body.recoveryCode, actorOf(req)),
    );
  }

  @PlatformPublic()
  @Post('2fa/enroll/start')
  @HttpCode(200)
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @ApiZodBody(platformEnrollStartSchema)
  enrollStart(@ZBody(platformEnrollStartSchema) body: z.output<typeof platformEnrollStartSchema>) {
    return this.auth.enrollStart(body.challenge);
  }

  @PlatformPublic()
  @Post('2fa/enroll/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @ApiZodBody(platformTotpSchema)
  async enrollConfirm(
    @ZBody(platformTotpSchema) body: z.output<typeof platformTotpSchema>,
    @Req() req: PlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.auth.enrollConfirm(body.challenge, body.code, actorOf(req)),
    );
  }

  @PlatformPublic()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(readCookie(req)));
    } catch (error) {
      res.clearCookie(PLATFORM_REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @PlatformPublic()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: PlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readCookie(req), actorOf(req));
    res.clearCookie(PLATFORM_REFRESH_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @AllowsPendingPassword()
  me(@Req() req: PlatformRequest) {
    return this.auth.me(req.admin!.id);
  }

  @Post('password')
  @AllowsPendingPassword()
  @HttpCode(204)
  @ApiOperation({ summary: 'Troca a senha do administrador (as outras sessões são encerradas)' })
  @ApiZodBody(platformChangePasswordSchema)
  async changePassword(
    @ZBody(platformChangePasswordSchema) body: z.output<typeof platformChangePasswordSchema>,
    @Req() req: PlatformRequest,
  ): Promise<void> {
    await this.auth.changePassword(req.admin!.id, req.admin!.sessionId, body, actorOf(req));
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gera novos códigos de recuperação (os anteriores deixam de valer)' })
  regenerateCodes(@Body() body: { code?: string }, @Actor() actor: PlatformActor) {
    return this.auth.regenerateRecoveryCodes(
      actor.adminId!,
      zTotpCode.parse(body.code ?? ''),
      actor,
    );
  }

  private respond(res: Response, issued: IssuedPlatformSession) {
    res.cookie(PLATFORM_REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      expires: issued.refreshExpiresAt,
    });
    return issued.session;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict',
      path: '/api/platform/auth',
    };
  }
}

function readCookie(req: Request): string | undefined {
  return (req.cookies as Record<string, string | undefined> | undefined)?.[PLATFORM_REFRESH_COOKIE];
}

const idParam = z.string().min(1);

/** Platform admin API (D041–D043). Every change is audited in PlatformAuditLog. */
@ApiTags('platform')
@PlatformController()
@Controller('platform')
export class PlatformAdminController {
  constructor(
    private readonly overview: OverviewService,
    private readonly directory: PlatformDirectoryService,
    private readonly customers: CustomersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly plans: PlansService,
    private readonly invoices: InvoicesService,
    private readonly settings: PlatformSettingsService,
    private readonly support: SupportService,
  ) {}

  @Get('overview')
  home() {
    return this.overview.overview();
  }

  @Get('audit')
  audit(
    @Query('organizationId') organizationId?: string,
    @Query('action') action?: string,
    @Query('before') before?: string,
  ) {
    return this.overview.audit({
      organizationId,
      action,
      before: before && /^\d+$/.test(before) ? before : undefined,
    });
  }

  // ---- Customers ----

  @Get('customers')
  listCustomers(@Query('q') q?: string) {
    return this.directory.listCustomers(q);
  }

  @Post('customers')
  @ApiZodBody(createCustomerSchema)
  createCustomer(
    @ZBody(createCustomerSchema) body: z.output<typeof createCustomerSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.customers.create(body, actor);
  }

  @Get('customers/:id')
  customer(@Param('id') id: string) {
    return this.directory.customerDetail(idParam.parse(id));
  }

  @Put('customers/:id')
  @ApiZodBody(customerDataSchema)
  updateCustomer(
    @Param('id') id: string,
    @ZBody(customerDataSchema) body: z.output<typeof customerDataSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.customers.update(id, body, actor);
  }

  @Post('customers/:id/active')
  @HttpCode(200)
  @ApiZodBody(customerActiveSchema)
  setActive(
    @Param('id') id: string,
    @ZBody(customerActiveSchema) body: z.output<typeof customerActiveSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.customers.setActive(id, body.active, body.reason, actor);
  }

  @Post('customers/:id/users/:userId/invite')
  @HttpCode(204)
  async invite(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Actor() actor: PlatformActor,
  ) {
    await this.customers.invite(id, userId, actor);
  }

  /** Link of the invitation to send by WhatsApp (replaces the e-mailed one). */
  @Post('customers/:id/users/:userId/invite-link')
  @HttpCode(200)
  inviteLink(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Actor() actor: PlatformActor,
  ): Promise<{ link: string }> {
    return this.customers.inviteLink(id, userId, actor);
  }

  // ---- Subscription ----

  @Post('customers/:id/subscription/plan')
  @HttpCode(200)
  @ApiZodBody(changePlanSchema)
  changePlan(
    @Param('id') id: string,
    @ZBody(changePlanSchema) body: z.output<typeof changePlanSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.changePlan(id, body, actor);
  }

  @Post('customers/:id/subscription/price')
  @HttpCode(200)
  @ApiZodBody(changePriceSchema)
  changePrice(
    @Param('id') id: string,
    @ZBody(changePriceSchema) body: z.output<typeof changePriceSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.changePrice(id, body, actor);
  }

  @Post('customers/:id/subscription/trial')
  @HttpCode(200)
  @ApiZodBody(changeTrialSchema)
  changeTrial(
    @Param('id') id: string,
    @ZBody(changeTrialSchema) body: z.output<typeof changeTrialSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.changeTrial(id, body, actor);
  }

  @Post('customers/:id/subscription/grace')
  @HttpCode(200)
  @ApiZodBody(changeGraceSchema)
  changeGrace(
    @Param('id') id: string,
    @ZBody(changeGraceSchema) body: z.output<typeof changeGraceSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.changeGrace(id, body, actor);
  }

  @Post('customers/:id/subscription/suspend')
  @HttpCode(200)
  @ApiZodBody(subscriptionReasonSchema)
  suspend(
    @Param('id') id: string,
    @ZBody(subscriptionReasonSchema) body: z.output<typeof subscriptionReasonSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.suspend(id, body, actor);
  }

  @Post('customers/:id/subscription/reactivate')
  @HttpCode(200)
  @ApiZodBody(subscriptionReasonSchema)
  reactivate(
    @Param('id') id: string,
    @ZBody(subscriptionReasonSchema) body: z.output<typeof subscriptionReasonSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.reactivate(id, body, actor);
  }

  @Post('customers/:id/subscription/cancel')
  @HttpCode(200)
  @ApiZodBody(subscriptionReasonSchema)
  cancel(
    @Param('id') id: string,
    @ZBody(subscriptionReasonSchema) body: z.output<typeof subscriptionReasonSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.subscriptions.cancel(id, body, actor);
  }

  // ---- Plans ----

  @Get('plans')
  listPlans() {
    return this.plans.list();
  }

  @Post('plans')
  @ApiZodBody(planSchema)
  createPlan(@ZBody(planSchema) body: z.output<typeof planSchema>, @Actor() actor: PlatformActor) {
    return this.plans.create(body, actor);
  }

  @Put('plans/:id')
  @ApiZodBody(planSchema)
  updatePlan(
    @Param('id') id: string,
    @ZBody(planSchema) body: z.output<typeof planSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.plans.update(id, body, actor);
  }

  // ---- Invoices ----

  @Get('invoices')
  listInvoices(@ZQuery(invoiceListQuerySchema) query: z.output<typeof invoiceListQuerySchema>) {
    return this.invoices.list(query);
  }

  @Post('invoices/generate')
  @HttpCode(200)
  @ApiZodBody(generateInvoicesSchema)
  generate(
    @ZBody(generateInvoicesSchema) body: z.output<typeof generateInvoicesSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.invoices.generate(body.organizationId, actor);
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @ApiZodBody(markInvoicePaidSchema)
  pay(
    @Param('id') id: string,
    @ZBody(markInvoicePaidSchema) body: z.output<typeof markInvoicePaidSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.invoices.markPaid(id, body, actor);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @ApiZodBody(cancelInvoiceSchema)
  cancelInvoice(
    @Param('id') id: string,
    @ZBody(cancelInvoiceSchema) body: z.output<typeof cancelInvoiceSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.invoices.cancel(id, body, actor);
  }

  // ---- Settings ----

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @ApiZodBody(platformSettingsSchema)
  updateSettings(
    @ZBody(platformSettingsSchema) body: z.output<typeof platformSettingsSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.settings.update(body, actor);
  }

  // ---- Support ----

  @Get('support-sessions')
  supportSessions() {
    return this.support.list();
  }

  @Post('support-sessions')
  @ApiZodBody(startSupportSchema)
  startSupport(
    @ZBody(startSupportSchema) body: z.output<typeof startSupportSchema>,
    @Actor() actor: PlatformActor,
  ) {
    return this.support.start(body, actor);
  }

  @Post('support-sessions/:id/end')
  @HttpCode(200)
  endSupport(@Param('id') id: string, @Actor() actor: PlatformActor) {
    return this.support.end(id, actor);
  }
}
