import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  LEGAL_REVIEW_NOTICE,
  PLATFORM_PRIVACY,
  PLATFORM_SUPPORT_ROLE,
  PLATFORM_TERMS,
  acceptTermsSchema,
} from '@app/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { ForbiddenError } from '../../core/errors/domain-error.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { Public } from '../auth/auth.decorators.js';
import { extractBearer } from '../auth/jwt-auth.guard.js';
import { StoreNoticesService } from './store-notices.service.js';
import { SupportService } from './support.service.js';

/** Restaurant side of the platform (D042/D043): banners, terms and the support session panel. */
@ApiTags('platform-store')
@Controller()
export class PlatformStoreController {
  constructor(
    private readonly notices: StoreNoticesService,
    private readonly support: SupportService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('stores/current/notices')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Avisos da plataforma: mensalidade, somente leitura, suporte, termos e módulos',
  })
  storeNotices() {
    return this.notices.notices();
  }

  @Post('stores/current/terms')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'O dono aceita os termos de uso e a política de privacidade da plataforma',
  })
  @ApiZodBody(acceptTermsSchema)
  async acceptTerms(
    @ZBody(acceptTermsSchema) body: z.output<typeof acceptTermsSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.notices.acceptTerms(body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Get('platform-terms')
  @ApiOperation({ summary: 'Textos dos termos de uso e da política de privacidade da plataforma' })
  terms() {
    return { reviewNotice: LEGAL_REVIEW_NOTICE, terms: PLATFORM_TERMS, privacy: PLATFORM_PRIVACY };
  }

  @Get('support/session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sessão do painel aberto pelo suporte da plataforma' })
  supportSession(@Req() req: Request) {
    if (this.ctx.role !== PLATFORM_SUPPORT_ROLE || !this.ctx.supportSessionId) {
      throw new ForbiddenError();
    }
    return this.support.panelSession(
      this.ctx.supportSessionId,
      extractBearer(req.headers.authorization)!,
    );
  }
}
