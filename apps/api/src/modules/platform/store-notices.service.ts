import { Injectable } from '@nestjs/common';
import {
  PLATFORM_PRIVACY_VERSION,
  PLATFORM_TERMS_VERSION,
  type StoreNoticesDto,
  needsTermsAcceptance,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { BillingAccessService } from './billing-access.service.js';
import { SupportService } from './support.service.js';

/**
 * What the restaurant panel shows about the platform (D042/D043): billing banner and read-only
 * mode, active support session, plan modules and, for the owner, the terms to accept.
 * Reads only the current store's own organization.
 */
@Injectable()
export class StoreNoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly billing: BillingAccessService,
    private readonly support: SupportService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async notices(): Promise<StoreNoticesDto> {
    const storeId = this.ctx.tenantId;
    const role = this.ctx.role;
    const { billing, access } = await this.billing.forStore(storeId);
    const session = await this.support.activeForStore(storeId);
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { organizationId: true, demoMode: true },
    });

    let termsRequired: StoreNoticesDto['termsRequired'] = null;
    // The public demo (D045) is not a customer: visitors never accept terms in its name.
    if (role === 'OWNER' && !store.demoMode) {
      const latest = await this.prisma.termsAcceptance.findFirst({
        where: { organizationId: store.organizationId },
        orderBy: { acceptedAt: 'desc' },
      });
      if (needsTermsAcceptance(latest)) {
        termsRequired = {
          termsVersion: PLATFORM_TERMS_VERSION,
          privacyVersion: PLATFORM_PRIVACY_VERSION,
        };
      }
    }

    const seesAmounts = role === 'OWNER' || role === 'MANAGER';
    return {
      billing:
        access && billing
          ? {
              level: access.level,
              readOnly: access.readOnly,
              readOnlyFrom: access.readOnlyFrom?.toISOString() ?? null,
              readOnlyReason: access.readOnlyReason,
              daysToDue: access.daysToDue,
              daysOverdue: access.daysOverdue,
              dueDate: access.dueDate,
              trialEndsOn: access.trialEndsOn,
              amountCents: seesAmounts ? billing.periodCents : null,
            }
          : null,
      support: session
        ? { reason: session.reason, mode: session.mode, endsAt: session.endsAt.toISOString() }
        : null,
      termsRequired,
      modules: billing ? billing.modules : null,
      demoMode: store.demoMode,
    };
  }

  /** The owner accepts the current platform terms (date, versions and IP recorded). */
  async acceptTerms(
    input: { termsVersion: string; privacyVersion: string },
    meta: { ip?: string; userAgent?: string },
  ): Promise<void> {
    if (this.ctx.role !== 'OWNER' || !this.ctx.userId) {
      throw new ForbiddenError('Só o dono do restaurante pode aceitar os termos');
    }
    if (
      input.termsVersion !== PLATFORM_TERMS_VERSION ||
      input.privacyVersion !== PLATFORM_PRIVACY_VERSION
    ) {
      throw new ValidationError('Os termos mudaram. Recarregue a página e leia a versão atual.');
    }
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: this.ctx.tenantId },
      select: { organizationId: true },
    });
    await this.prisma.termsAcceptance.create({
      data: {
        organizationId: store.organizationId,
        userId: this.ctx.userId,
        termsVersion: input.termsVersion,
        privacyVersion: input.privacyVersion,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
    await this.audit.log({
      action: AuditAction.TERMS_ACCEPTED,
      entity: 'Organization',
      entityId: store.organizationId,
      after: { termsVersion: input.termsVersion, privacyVersion: input.privacyVersion },
    });
    this.realtime.noticesUpdated(this.ctx.tenantId);
  }
}
