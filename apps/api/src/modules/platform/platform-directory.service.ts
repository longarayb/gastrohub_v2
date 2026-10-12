import { Injectable } from '@nestjs/common';
import {
  type CustomerDetailDto,
  type CustomerListItemDto,
  type CustomerUserDto,
  type InvoiceDisplayStatus,
  PLATFORM_PRIVACY_VERSION,
  PLATFORM_TERMS_VERSION,
  type PlatformInvoiceDto,
  type PlatformPaymentMethod,
  type Role,
  type SubscriptionDto,
  type SupportSessionDto,
  billingDate,
  billingTimeline,
  daysBetween,
  monthlyEquivalentCents,
  subscriptionCharge,
  subscriptionStatus,
} from '@app/shared';
import { NotFoundError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { PlatformInvoice, SupportSession } from '../../generated/prisma/client.js';
import { BillingAccessService, type OrganizationBilling } from './billing-access.service.js';
import { toPlanDto } from './plans.service.js';
import { UNUSABLE_PASSWORD } from '../auth/auth.service.js';

/** How the admin sees an invoice today (overdue, due soon...). */
export function invoiceDisplay(
  invoice: Pick<PlatformInvoice, 'status' | 'dueDate'>,
  today: string,
  warnDaysBefore: number,
): { displayStatus: InvoiceDisplayStatus; daysOverdue: number } {
  if (invoice.status !== 'OPEN') return { displayStatus: invoice.status, daysOverdue: 0 };
  if (today > invoice.dueDate) {
    return { displayStatus: 'OVERDUE', daysOverdue: daysBetween(invoice.dueDate, today) };
  }
  if (daysBetween(today, invoice.dueDate) <= warnDaysBefore) {
    return { displayStatus: 'DUE_SOON', daysOverdue: 0 };
  }
  return { displayStatus: 'OPEN', daysOverdue: 0 };
}

export function toInvoiceDto(
  invoice: PlatformInvoice & { organization?: { name: string } | null },
  today: string,
  warnDaysBefore: number,
): PlatformInvoiceDto {
  return {
    id: invoice.id,
    version: invoice.version,
    organizationId: invoice.organizationId,
    customerName: invoice.organization?.name ?? '',
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    dueDate: invoice.dueDate,
    amountCents: invoice.amountCents,
    details: invoice.details as PlatformInvoiceDto['details'],
    status: invoice.status,
    ...invoiceDisplay(invoice, today, warnDaysBefore),
    paidOn: invoice.paidOn,
    paymentMethod: invoice.paymentMethod as PlatformPaymentMethod | null,
    paymentNote: invoice.paymentNote,
    provider: invoice.provider,
    providerUrl: invoice.providerUrl,
    cancelReason: invoice.cancelReason,
    createdAt: invoice.createdAt.toISOString(),
  };
}

export function toSupportDto(
  s: SupportSession,
  names: { admin?: string | null; customer?: string | null; store?: string | null },
  now = new Date(),
): SupportSessionDto {
  return {
    id: s.id,
    adminName: names.admin ?? null,
    organizationId: s.organizationId,
    customerName: names.customer ?? null,
    storeId: s.storeId,
    storeName: names.store ?? null,
    reason: s.reason,
    mode: s.mode,
    startedAt: s.startedAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    active: !s.endedAt && s.endsAt > now,
  };
}

/**
 * The platform admin's ONLY way to read across restaurants (D041): fixed, named queries over
 * organizations, stores, their users and billing, with the raw client and explicit ids. No
 * generic access; no tenant business data (orders, customers, cash). The rest of the API cannot
 * import this module (ESLint rule and a test).
 */
@Injectable()
export class PlatformDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingAccessService,
  ) {}

  async listCustomers(q?: string): Promise<CustomerListItemDto[]> {
    const term = q?.trim();
    const orgs = await this.prisma.organization.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { legalName: { contains: term, mode: 'insensitive' } },
              { document: { contains: term.replace(/\D/g, '') || term } },
              { stores: { some: { slug: { contains: term.toLowerCase() } } } },
            ],
          }
        : undefined,
      include: {
        stores: { select: { id: true, isActive: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const owners = await this.ownerEmails(orgs.flatMap((o) => o.stores.map((s) => s.id)));
    const result: CustomerListItemDto[] = [];
    for (const org of orgs) {
      const billing = await this.billing.organizationBilling(org.id);
      result.push(this.listItem(org, billing, owners));
    }
    return result;
  }

  async customerDetail(organizationId: string): Promise<CustomerDetailDto> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        stores: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        subscription: {
          include: {
            plan: true,
            changes: { orderBy: { seq: 'desc' }, take: 50 },
          },
        },
        invoices: { orderBy: [{ dueDate: 'desc' }, { seq: 'desc' }], take: 36 },
        termsAcceptances: { orderBy: { acceptedAt: 'desc' }, take: 1 },
      },
    });
    if (!org) throw new NotFoundError('Cliente');
    const settings = await this.billing.settings();
    const today = billingDate(new Date());
    this.billing.invalidate(org.id);
    const billing = await this.billing.organizationBilling(org.id);

    const stores = [];
    for (const s of org.stores) {
      const access = await this.billing.forStore(s.id);
      stores.push({
        id: s.id,
        tradeName: s.tradeName,
        slug: s.slug,
        cnpj: s.cnpj,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
        readOnlyFrom: access.access?.readOnlyFrom?.toISOString() ?? null,
        readOnly: access.access?.readOnly ?? false,
      });
    }

    const terms = org.termsAcceptances[0];
    const termsUser = terms
      ? await this.prisma.user.findUnique({ where: { id: terms.userId }, select: { name: true } })
      : null;
    const sessions = await this.prisma.supportSession.findMany({
      where: { organizationId: org.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    const adminNames = await this.adminNames(sessions.map((s) => s.adminId));

    return {
      id: org.id,
      name: org.name,
      isActive: org.isActive,
      createdVia: org.createdVia,
      documentType: org.documentType,
      document: org.document,
      legalName: org.legalName,
      municipalRegistration: org.municipalRegistration,
      invoiceEmail: org.invoiceEmail,
      contactName: org.contactName,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      address: org.addressCep
        ? {
            cep: org.addressCep,
            street: org.addressStreet ?? '',
            number: org.addressNumber ?? '',
            complement: org.addressComplement ?? '',
            neighborhood: org.addressNeighborhood ?? '',
            city: org.addressCity ?? '',
            state: org.addressState ?? '',
          }
        : null,
      notes: org.notes,
      createdAt: org.createdAt.toISOString(),
      stores,
      users: await this.users(org.stores.map((s) => ({ id: s.id, name: s.tradeName }))),
      subscription:
        org.subscription && billing
          ? await this.subscriptionDto(billing, org.subscription.changes, settings.graceDays)
          : null,
      invoices: org.invoices.map((i) =>
        toInvoiceDto({ ...i, organization: org }, today, settings.warnDaysBefore),
      ),
      terms: terms
        ? {
            termsVersion: terms.termsVersion,
            privacyVersion: terms.privacyVersion,
            userName: termsUser?.name ?? null,
            ip: terms.ip,
            acceptedAt: terms.acceptedAt.toISOString(),
            current:
              terms.termsVersion === PLATFORM_TERMS_VERSION &&
              terms.privacyVersion === PLATFORM_PRIVACY_VERSION,
          }
        : null,
      supportSessions: sessions.map((s) =>
        toSupportDto(s, {
          admin: adminNames.get(s.adminId),
          customer: org.name,
          store: org.stores.find((st) => st.id === s.storeId)?.tradeName,
        }),
      ),
    };
  }

  async adminNames(ids: string[]): Promise<Map<string, string>> {
    const admins = await this.prisma.platformAdmin.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(admins.map((a) => [a.id, a.name]));
  }

  /** Users with access to the given stores (memberships read by explicit tenant ids). */
  private async users(stores: { id: string; name: string }[]): Promise<CustomerUserDto[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId: { in: stores.map((s) => s.id) } },
      include: { user: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const byUser = new Map<string, CustomerUserDto>();
    for (const m of memberships) {
      const u = m.user;
      const entry =
        byUser.get(u.id) ??
        ({
          id: u.id,
          name: u.name,
          email: u.email,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          invitePending: u.passwordHash === UNUSABLE_PASSWORD,
          memberships: [],
        } satisfies CustomerUserDto);
      entry.memberships.push({
        storeId: m.tenantId,
        storeName: stores.find((s) => s.id === m.tenantId)?.name ?? '',
        role: m.role as Role,
        isActive: m.isActive,
      });
      byUser.set(u.id, entry);
    }
    // Owners first.
    return [...byUser.values()].sort(
      (a, b) =>
        Number(b.memberships.some((m) => m.role === 'OWNER')) -
        Number(a.memberships.some((m) => m.role === 'OWNER')),
    );
  }

  private async ownerEmails(storeIds: string[]): Promise<Map<string, string>> {
    const owners = await this.prisma.membership.findMany({
      where: { tenantId: { in: storeIds }, role: 'OWNER' },
      include: { user: { select: { email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const map = new Map<string, string>();
    for (const o of owners) if (!map.has(o.tenantId)) map.set(o.tenantId, o.user.email);
    return map;
  }

  private listItem(
    org: {
      id: string;
      name: string;
      document: string | null;
      isActive: boolean;
      createdAt: Date;
      stores: { id: string; isActive: boolean }[];
    },
    billing: OrganizationBilling | null,
    owners: Map<string, string>,
  ): CustomerListItemDto {
    const timeline = billing ? billingTimeline(billing.timeline) : null;
    return {
      id: org.id,
      name: org.name,
      document: org.document,
      status: billing ? subscriptionStatus(billing.timeline) : null,
      planName: billing?.subscription.plan.name ?? null,
      stores: org.stores.filter((s) => s.isActive).length,
      ownerEmail: org.stores.map((s) => owners.get(s.id)).find(Boolean) ?? null,
      periodCents: billing?.periodCents ?? null,
      interval: billing?.subscription.interval ?? null,
      nextDueDate: billing?.timeline.nextDueDate ?? null,
      daysOverdue: timeline?.daysOverdue ?? 0,
      trialEndsOn: timeline?.trialActive ? (billing?.subscription.trialEndsOn ?? null) : null,
      isActive: org.isActive,
      createdAt: org.createdAt.toISOString(),
    };
  }

  async subscriptionDto(
    billing: OrganizationBilling,
    changes: {
      kind: SubscriptionDto['changes'][number]['kind'];
      fromPlanId: string | null;
      toPlanId: string | null;
      before: unknown;
      after: unknown;
      reason: string | null;
      adminId: string | null;
      createdAt: Date;
    }[],
    defaultGraceDays: number,
  ): Promise<SubscriptionDto> {
    const s = billing.subscription;
    const timeline = billingTimeline(billing.timeline);
    const charge = subscriptionCharge(
      {
        priceCents: s.priceCents,
        storeLimit: s.plan.storeLimit,
        extraStorePriceCents: s.plan.extraStorePriceCents,
      },
      billing.activeStores,
    );
    const planIds = changes
      .flatMap((c) => [c.fromPlanId, c.toPlanId])
      .filter((v): v is string => !!v);
    const plans = await this.prisma.plan.findMany({
      where: { id: { in: [...new Set(planIds)] } },
      select: { id: true, name: true },
    });
    const planName = (id: string | null) =>
      id ? (plans.find((p) => p.id === id)?.name ?? null) : null;
    const admins = await this.adminNames(
      changes.map((c) => c.adminId).filter((v): v is string => !!v),
    );
    return {
      id: s.id,
      version: s.version,
      status: subscriptionStatus(billing.timeline),
      plan: toPlanDto(s.plan),
      priceCents: s.priceCents,
      interval: s.interval,
      startedAt: s.startedAt.toISOString(),
      trialEndsOn: s.trialEndsOn,
      billingStart: s.billingStart,
      graceDays: s.graceDays,
      effectiveGraceDays: s.graceDays ?? defaultGraceDays,
      suspendedAt: s.suspendedAt?.toISOString() ?? null,
      suspendedReason: s.suspendedReason,
      canceledAt: s.canceledAt?.toISOString() ?? null,
      cancelReason: s.cancelReason,
      charge,
      monthlyCents: monthlyEquivalentCents(charge.totalCents, s.interval),
      nextDueDate: billing.timeline.nextDueDate,
      oldestUnpaidDueDate: billing.timeline.oldestUnpaidDueDate,
      daysOverdue: timeline.daysOverdue,
      graceEndsOn: timeline.graceEndsOn,
      readOnlyEligibleAt: timeline.readOnlyEligibleAt?.toISOString() ?? null,
      readOnlyReason: timeline.readOnlyReason,
      changes: changes.map((c) => ({
        kind: c.kind,
        fromPlanName: planName(c.fromPlanId),
        toPlanName: planName(c.toPlanId),
        before: (c.before as Record<string, unknown> | null) ?? null,
        after: (c.after as Record<string, unknown> | null) ?? null,
        reason: c.reason,
        adminName: c.adminId ? (admins.get(c.adminId) ?? null) : null,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}
