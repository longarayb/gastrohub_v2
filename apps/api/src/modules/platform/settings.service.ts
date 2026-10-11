import { Injectable } from '@nestjs/common';
import type { PlatformSettingsDto, PlatformSettingsInput } from '@app/shared';
import { ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { BillingAccessService } from './billing-access.service.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import type { PlatformActor } from './platform.keys.js';

/** Platform settings singleton: signup mode (D043), trial, grace and warning days (D042). */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly billing: BillingAccessService,
  ) {}

  async get(): Promise<PlatformSettingsDto> {
    const row = await this.prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    return {
      signupMode: row.signupMode,
      signupPlanId: row.signupPlanId,
      trialDays: row.trialDays,
      graceDays: row.graceDays,
      warnDaysBefore: row.warnDaysBefore,
    };
  }

  async update(
    input: Required<Omit<PlatformSettingsInput, 'signupPlanId'>> & { signupPlanId?: string | null },
    actor: PlatformActor,
  ): Promise<PlatformSettingsDto> {
    if (input.signupMode === 'OPEN_TRIAL') {
      const plan = input.signupPlanId
        ? await this.prisma.plan.findFirst({ where: { id: input.signupPlanId, isActive: true } })
        : null;
      if (!plan)
        throw new ValidationError('Escolha o plano do período de teste do cadastro aberto');
    }
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSettings.update({
        where: { id: 'default' },
        data: {
          signupMode: input.signupMode,
          signupPlanId: input.signupPlanId ?? null,
          trialDays: input.trialDays,
          graceDays: input.graceDays,
          warnDaysBefore: input.warnDaysBefore,
        },
      });
      await this.audit.log(
        {
          action: PlatformAuditAction.SETTINGS_UPDATED,
          entity: 'PlatformSettings',
          before,
          after: input,
        },
        actor,
        tx,
      );
    });
    this.billing.invalidate();
    return this.get();
  }
}
