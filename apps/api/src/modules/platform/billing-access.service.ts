import { Injectable } from '@nestjs/common';
import {
  BILLING_DEFAULTS,
  type BillingTimelineInput,
  type BusinessHour,
  type PlatformModule,
  type StoreBillingAccess,
  billingDate,
  billingPeriod,
  storeBillingAccess,
  subscriptionCharge,
} from '@app/shared';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { Plan, PlatformInvoice, Subscription } from '../../generated/prisma/client.js';

/** Billing situation of one organization (independent of the stores' opening hours). */
export interface OrganizationBilling {
  organizationId: string;
  subscription: Subscription & { plan: Plan };
  timeline: BillingTimelineInput;
  modules: PlatformModule[];
  activeStores: number;
  periodCents: number;
}

export interface StoreAccess {
  /** Null = organization without subscription (legacy/internal): no banner, no limits. */
  billing: OrganizationBilling | null;
  access: StoreBillingAccess | null;
}

const CACHE_MS = 30_000;

/**
 * Timeline input from the subscription, its invoices and the platform defaults (pure, tested).
 * The first period counts as unpaid from its due date even before its invoice is generated
 * (an expired trial cannot stay free just because nobody generated the invoice).
 */
export function timelineInputOf(
  subscription: Subscription,
  invoices: readonly Pick<PlatformInvoice, 'periodStart' | 'dueDate' | 'status'>[],
  settings: { graceDays: number; warnDaysBefore: number },
  now: Date,
): BillingTimelineInput {
  const today = billingDate(now);
  const open = invoices
    .filter((i) => i.status === 'OPEN')
    .map((i) => i.dueDate)
    .sort();
  const billed = new Set(invoices.filter((i) => i.status !== 'CANCELED').map((i) => i.periodStart));
  const firstDue = subscription.billingStart;
  const unpaid = [...open];
  if (!billed.has(firstDue) && firstDue <= today && !subscription.canceledAt) unpaid.push(firstDue);
  unpaid.sort();

  // Next due date: the earliest open invoice, or the next period not billed yet.
  let nextDueDate: string | null = open[0] ?? null;
  if (!nextDueDate && !subscription.canceledAt) {
    for (let i = 0; i < 1200; i++) {
      const period = billingPeriod(
        { billingStart: subscription.billingStart, interval: subscription.interval },
        i,
      );
      if (period.periodStart >= today && !billed.has(period.periodStart)) {
        nextDueDate = period.dueDate;
        break;
      }
    }
  }

  return {
    trialEndsOn: subscription.trialEndsOn,
    oldestUnpaidDueDate: unpaid[0] ?? null,
    nextDueDate,
    suspendedAt: subscription.suspendedAt,
    canceledAt: subscription.canceledAt,
    graceDays: subscription.graceDays ?? settings.graceDays,
    warnDaysBefore: settings.warnDaysBefore,
    now,
  };
}

/**
 * The restaurant side's only path to platform billing data (D041/D042): it reads the billing
 * situation of the CURRENT store's own organization, by explicit ids, nothing else. Used by the
 * read-only interceptor, plan limits and modules, and the panel banners. Cached for a few
 * seconds; registering a payment (or any admin change) invalidates it right away.
 */
@Injectable()
export class BillingAccessService {
  private readonly orgCache = new Map<string, { at: number; value: OrganizationBilling | null }>();
  private readonly storeCache = new Map<
    string,
    { at: number; organizationId: string; hours: BusinessHour[]; timezone: string }
  >();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(organizationId?: string): void {
    if (organizationId) this.orgCache.delete(organizationId);
    else this.orgCache.clear();
  }

  /** Opening hours changed: the read-only boundary of the store moves. */
  invalidateStore(storeId: string): void {
    this.storeCache.delete(storeId);
  }

  async organizationBilling(
    organizationId: string,
    now = new Date(),
  ): Promise<OrganizationBilling | null> {
    const cached = this.orgCache.get(organizationId);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return cached.value && { ...cached.value, timeline: { ...cached.value.timeline, now } };
    }
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: {
        plan: true,
        invoices: { select: { periodStart: true, dueDate: true, status: true } },
      },
    });
    let value: OrganizationBilling | null = null;
    if (subscription) {
      const settings = await this.settings();
      const activeStores = await this.prisma.store.count({
        where: { organizationId, isActive: true },
      });
      const { invoices, ...rest } = subscription;
      value = {
        organizationId,
        subscription: rest,
        timeline: timelineInputOf(rest, invoices, settings, now),
        modules: subscription.plan.modules as PlatformModule[],
        activeStores,
        periodCents: subscriptionCharge(
          {
            priceCents: subscription.priceCents,
            storeLimit: subscription.plan.storeLimit,
            extraStorePriceCents: subscription.plan.extraStorePriceCents,
          },
          activeStores,
        ).totalCents,
      };
    }
    this.orgCache.set(organizationId, { at: Date.now(), value });
    return value;
  }

  async forStore(storeId: string, now = new Date()): Promise<StoreAccess> {
    const store = await this.storeInfo(storeId);
    if (!store) return { billing: null, access: null };
    const billing = await this.organizationBilling(store.organizationId, now);
    if (!billing) return { billing: null, access: null };
    return {
      billing,
      access: storeBillingAccess({
        ...billing.timeline,
        hours: store.hours,
        timeZone: store.timezone,
      }),
    };
  }

  async settings(): Promise<{ graceDays: number; warnDaysBefore: number; trialDays: number }> {
    const row = await this.prisma.platformSettings.findUnique({ where: { id: 'default' } });
    return {
      graceDays: row?.graceDays ?? BILLING_DEFAULTS.graceDays,
      warnDaysBefore: row?.warnDaysBefore ?? BILLING_DEFAULTS.warnDaysBefore,
      trialDays: row?.trialDays ?? BILLING_DEFAULTS.trialDays,
    };
  }

  private async storeInfo(storeId: string) {
    const cached = this.storeCache.get(storeId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached;
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { organizationId: true, timezone: true },
    });
    if (!store) return null;
    // Explicit tenant id (this service runs before and outside the tenant-scoped client).
    const hours = await this.prisma.businessHours.findMany({
      where: { tenantId: storeId },
      select: { weekday: true, opensAt: true, closesAt: true },
    });
    const value = {
      at: Date.now(),
      organizationId: store.organizationId,
      hours,
      timezone: store.timezone,
    };
    this.storeCache.set(storeId, value);
    return value;
  }
}
