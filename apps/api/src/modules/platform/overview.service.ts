import { Injectable } from '@nestjs/common';
import {
  type PlatformAuditEntryDto,
  type PlatformOverviewDto,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatus,
  addDaysToDate,
  billingDate,
  monthlyRecurringRevenue,
} from '@app/shared';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { InvoicesService } from './invoices.service.js';
import { PlatformDirectoryService } from './platform-directory.service.js';

/** Admin home (D041) and the platform audit list. */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: PlatformDirectoryService,
    private readonly invoices: InvoicesService,
  ) {}

  async overview(): Promise<PlatformOverviewDto> {
    const customers = await this.directory.listCustomers();
    const counts = Object.fromEntries(
      Object.keys(SUBSCRIPTION_STATUS_LABELS).map((s) => [s, 0]),
    ) as Record<SubscriptionStatus, number>;
    let withoutSubscription = 0;
    for (const c of customers) {
      if (c.status) counts[c.status] += 1;
      else withoutSubscription += 1;
    }
    const mrrCents = monthlyRecurringRevenue(
      customers
        .filter((c) => c.status && c.periodCents != null && c.interval)
        .map((c) => ({ status: c.status!, totalCents: c.periodCents!, interval: c.interval! })),
    );
    const open = await this.invoices.list({ status: 'OPEN' });
    const today = billingDate(new Date());
    const soon = addDaysToDate(today, 7);
    return {
      counts: { ...counts, total: customers.length, withoutSubscription },
      mrrCents,
      dueSoon: open.filter((i) => i.displayStatus !== 'OVERDUE' && i.dueDate <= soon),
      overdue: open.filter((i) => i.displayStatus === 'OVERDUE'),
      trialsEnding: customers
        .filter((c) => c.trialEndsOn && c.trialEndsOn <= soon)
        .map((c) => ({ id: c.id, name: c.name, trialEndsOn: c.trialEndsOn! }))
        .sort((a, b) => a.trialEndsOn.localeCompare(b.trialEndsOn)),
      activity: (await this.audit({ take: 15 })).items,
      recentCustomers: (
        await this.prisma.organization.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 5,
          select: { id: true, name: true, createdVia: true, createdAt: true },
        })
      ).map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
    };
  }

  async audit(query: {
    organizationId?: string;
    action?: string;
    before?: string;
    take?: number;
  }): Promise<{ items: PlatformAuditEntryDto[]; next: string | null }> {
    const take = Math.min(query.take ?? 50, 200);
    const where: Prisma.PlatformAuditLogWhereInput = {
      organizationId: query.organizationId || undefined,
      action: query.action ? { startsWith: query.action } : undefined,
      seq: query.before ? { lt: BigInt(query.before) } : undefined,
    };
    const rows = await this.prisma.platformAuditLog.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: take + 1,
    });
    const page = rows.slice(0, take);
    const admins = await this.directory.adminNames(
      page.map((r) => r.adminId).filter((v): v is string => !!v),
    );
    const orgs = await this.prisma.organization.findMany({
      where: {
        id: { in: [...new Set(page.map((r) => r.organizationId).filter((v): v is string => !!v))] },
      },
      select: { id: true, name: true },
    });
    return {
      items: page.map((r) => ({
        seq: r.seq.toString(),
        adminName: r.adminId ? (admins.get(r.adminId) ?? null) : null,
        actorEmail: r.actorEmail,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        organizationId: r.organizationId,
        customerName: orgs.find((o) => o.id === r.organizationId)?.name ?? null,
        storeId: r.storeId,
        reason: r.reason,
        before: r.before,
        after: r.after,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      next: rows.length > take ? page[page.length - 1]!.seq.toString() : null,
    };
  }
}
