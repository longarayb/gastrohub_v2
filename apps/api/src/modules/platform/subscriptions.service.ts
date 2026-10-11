import { Injectable } from '@nestjs/common';
import { type CustomerDetailDto, billingDate } from '@app/shared';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type {
  Prisma,
  Subscription,
  SubscriptionChangeKind,
} from '../../generated/prisma/client.js';
import { BillingAccessService } from './billing-access.service.js';
import { CustomersService } from './customers.service.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import { PlatformDirectoryService } from './platform-directory.service.js';
import type { PlatformActor } from './platform.keys.js';

const STALE =
  'Esta assinatura foi alterada por outra pessoa. Os dados foram atualizados; confira e tente de novo.';

interface Change {
  kind: SubscriptionChangeKind;
  action: (typeof PlatformAuditAction)[keyof typeof PlatformAuditAction];
  data: Prisma.SubscriptionUncheckedUpdateInput;
  reason: string;
  fromPlanId?: string | null;
  toPlanId?: string | null;
}

/**
 * Subscription changes (D042): each one is versioned (409 when stale), recorded in the history
 * with the reason and in the platform audit, and refreshes the stores' banners right away.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly billing: BillingAccessService,
    private readonly customers: CustomersService,
    private readonly directory: PlatformDirectoryService,
  ) {}

  async changePlan(
    organizationId: string,
    input: { expectedVersion: number; planId: string; priceCents?: number | null; reason: string },
    actor: PlatformActor,
  ): Promise<CustomerDetailDto> {
    const current = await this.find(organizationId);
    const plan = await this.prisma.plan.findFirst({ where: { id: input.planId, isActive: true } });
    if (!plan) throw new ValidationError('Plano não encontrado ou inativo');
    if (plan.id === current.planId && input.priceCents == null) {
      throw new ValidationError('O cliente já está neste plano');
    }
    const data: Prisma.SubscriptionUncheckedUpdateInput = {
      planId: plan.id,
      priceCents: input.priceCents ?? plan.priceCents,
      interval: plan.interval,
    };
    if (plan.interval !== current.interval) {
      // A new periodicity starts at the next due date: periods already billed are kept.
      const billing = await this.billing.organizationBilling(organizationId);
      data.billingStart = billing?.timeline.nextDueDate ?? billingDate(new Date());
    }
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'PLAN_CHANGED',
        action: PlatformAuditAction.SUBSCRIPTION_PLAN_CHANGED,
        data,
        reason: input.reason,
        fromPlanId: current.planId,
        toPlanId: plan.id,
      },
      actor,
    );
  }

  async changePrice(
    organizationId: string,
    input: { expectedVersion: number; priceCents: number; reason: string },
    actor: PlatformActor,
  ) {
    const current = await this.find(organizationId);
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'PRICE_CHANGED',
        action: PlatformAuditAction.SUBSCRIPTION_PRICE_CHANGED,
        data: { priceCents: input.priceCents },
        reason: input.reason,
      },
      actor,
    );
  }

  /** Extends or ends the trial; only before the first invoice exists. */
  async changeTrial(
    organizationId: string,
    input: { expectedVersion: number; trialEndsOn: string | null; reason: string },
    actor: PlatformActor,
  ) {
    const current = await this.find(organizationId);
    const invoices = await this.prisma.platformInvoice.count({
      where: { subscriptionId: current.id },
    });
    if (invoices > 0) {
      throw new ValidationError('A assinatura já tem cobranças: o período de teste não pode mudar');
    }
    const today = billingDate(new Date());
    if (input.trialEndsOn && input.trialEndsOn <= today) {
      throw new ValidationError(
        'O fim do teste precisa ser uma data futura (ou encerre o teste hoje)',
      );
    }
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'TRIAL_CHANGED',
        action: PlatformAuditAction.SUBSCRIPTION_TRIAL_CHANGED,
        data: { trialEndsOn: input.trialEndsOn, billingStart: input.trialEndsOn ?? today },
        reason: input.reason,
      },
      actor,
    );
  }

  async changeGrace(
    organizationId: string,
    input: { expectedVersion: number; graceDays: number | null; reason: string },
    actor: PlatformActor,
  ) {
    const current = await this.find(organizationId);
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'GRACE_CHANGED',
        action: PlatformAuditAction.SUBSCRIPTION_GRACE_CHANGED,
        data: { graceDays: input.graceDays },
        reason: input.reason,
      },
      actor,
    );
  }

  /** Manual suspension: read-only mode at the next safe moment of each store (D042). */
  async suspend(
    organizationId: string,
    input: { expectedVersion: number; reason: string },
    actor: PlatformActor,
  ) {
    const current = await this.find(organizationId);
    if (current.suspendedAt) throw new ValidationError('A assinatura já está suspensa');
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'SUSPENDED',
        action: PlatformAuditAction.SUBSCRIPTION_SUSPENDED,
        data: { suspendedAt: new Date(), suspendedReason: input.reason },
        reason: input.reason,
      },
      actor,
    );
  }

  /** Lifts a manual suspension or a cancellation (overdue invoices still count). */
  async reactivate(
    organizationId: string,
    input: { expectedVersion: number; reason: string },
    actor: PlatformActor,
  ) {
    const current = await this.find(organizationId);
    if (!current.suspendedAt && !current.canceledAt) {
      throw new ValidationError('A assinatura não está suspensa nem cancelada');
    }
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'REACTIVATED',
        action: PlatformAuditAction.SUBSCRIPTION_REACTIVATED,
        data: { suspendedAt: null, suspendedReason: null, canceledAt: null, cancelReason: null },
        reason: input.reason,
      },
      actor,
    );
  }

  /** Cancellation: read-only at the next safe moment; no new invoices after it. */
  async cancel(
    organizationId: string,
    input: { expectedVersion: number; reason: string },
    actor: PlatformActor,
  ) {
    const current = await this.find(organizationId);
    if (current.canceledAt) throw new ValidationError('A assinatura já está cancelada');
    return this.apply(
      organizationId,
      current,
      input.expectedVersion,
      {
        kind: 'CANCELED',
        action: PlatformAuditAction.SUBSCRIPTION_CANCELED,
        data: { canceledAt: new Date(), cancelReason: input.reason },
        reason: input.reason,
      },
      actor,
    );
  }

  private async find(organizationId: string): Promise<Subscription> {
    const subscription = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!subscription) throw new NotFoundError('Assinatura');
    return subscription;
  }

  private async apply(
    organizationId: string,
    current: Subscription,
    expectedVersion: number,
    change: Change,
    actor: PlatformActor,
  ): Promise<CustomerDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { id: current.id, version: expectedVersion },
        data: {
          ...(change.data as Prisma.SubscriptionUncheckedUpdateManyInput),
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictError(STALE);
      const after = await tx.subscription.findUniqueOrThrow({ where: { id: current.id } });
      const pick = (s: Subscription) =>
        Object.fromEntries(Object.keys(change.data).map((k) => [k, s[k as keyof Subscription]]));
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: current.id,
          kind: change.kind,
          fromPlanId: change.fromPlanId ?? null,
          toPlanId: change.toPlanId ?? null,
          before: JSON.parse(JSON.stringify(pick(current))),
          after: JSON.parse(JSON.stringify(pick(after))),
          reason: change.reason,
          adminId: actor.adminId,
        },
      });
      await this.audit.log(
        {
          action: change.action,
          entity: 'Subscription',
          entityId: current.id,
          organizationId,
          reason: change.reason,
          before: pick(current),
          after: pick(after),
        },
        actor,
        tx,
      );
    });
    await this.customers.notify(organizationId);
    return this.directory.customerDetail(organizationId);
  }
}
