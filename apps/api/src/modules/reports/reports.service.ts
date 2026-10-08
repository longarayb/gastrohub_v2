import { Injectable } from '@nestjs/common';
import {
  type ChannelRow,
  type CompareMode,
  type DayReportDto,
  type OrderStatus,
  type PaymentMethod,
  type ReportChannel,
  REPORT_CHANNELS,
  type ReportUnit,
  type SalesReportDto,
  type TopProductRow,
  type WaiterRow,
  abcCurve,
  addBreakdowns,
  agentOnline,
  averageOf,
  averageTicket,
  byHour,
  compare,
  comparisonDates,
  localHourAndWeekday,
  reconcile,
  reportChannelOf,
  salesBreakdown,
  salesBreakdownFromSums,
  sameMomentOn,
} from '@app/shared';
import { ForbiddenError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MenuContext } from '../menu/menu-common.js';
import { OrdersService } from '../orders/orders.service.js';

const OPEN_STATUSES: OrderStatus[] = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DISPATCHED'];

const amountsSelect = {
  id: true,
  type: true,
  source: true,
  subtotalCents: true,
  itemDiscountCents: true,
  orderDiscountCents: true,
  couponDiscountCents: true,
  serviceFeeCents: true,
  deliveryFeeCents: true,
  totalCents: true,
  deliveredAt: true,
} satisfies Prisma.OrderSelect;

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** Orders and revenue by weekday × hour, converting each instant once. */
function heatmaps(orders: readonly { createdAt: Date; totalCents: number }[]) {
  const ordersGrid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const revenueGrid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const o of orders) {
    const { hour, weekday } = localHourAndWeekday(o.createdAt);
    ordersGrid[weekday]![hour]! += 1;
    revenueGrid[weekday]![hour]! += o.totalCents;
  }
  return { orders: ordersGrid, revenueCents: revenueGrid };
}

function channelRows(
  orders: readonly { type: string; source: string; totalCents: number }[],
): ChannelRow[] {
  const map = new Map<ReportChannel, ChannelRow>();
  for (const o of orders) {
    const channel = reportChannelOf(o.type as never, o.source as never);
    const row = map.get(channel) ?? { channel, orders: 0, revenueCents: 0 };
    row.orders += 1;
    row.revenueCents += o.totalCents;
    map.set(channel, row);
  }
  return REPORT_CHANNELS.filter((c) => map.has(c)).map((c) => map.get(c)!);
}

function mergeRows<T extends object>(
  lists: readonly T[][],
  key: (row: T) => string,
  add: (target: T, row: T) => void,
): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const row of list) {
      const k = key(row);
      const existing = map.get(k);
      if (existing) add(existing, row);
      else map.set(k, structuredClone(row));
    }
  }
  return [...map.values()];
}

/**
 * Dashboard of the day and sales by period (docs/DECISOES.md D038). Every number comes from the
 * pure definitions in `shared/domain/reports.ts`; concluded orders count on their closing
 * business day, payments and refunds on theirs. The network view runs the same report inside
 * each unit's tenant context and adds them up (no query crosses tenants).
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself), memberships of the owner across units and user names.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly orders: OrdersService,
  ) {}

  // ---------------------------------------------------------------------------
  // Units (network view)

  /** Units of the owner's organization where the user is an active owner. */
  async networkUnits(): Promise<ReportUnit[]> {
    const userId = this.ctx.userId;
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { organizationId: true },
    });
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        role: 'OWNER',
        isActive: true,
        store: { organizationId: store?.organizationId, isActive: true },
      },
      select: { store: { select: { id: true, tradeName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!memberships.some((m) => m.store.id === this.ctx.tenantId)) {
      throw new ForbiddenError('Só o dono vê o consolidado da rede');
    }
    return memberships.map((m) => ({ storeId: m.store.id, name: m.store.tradeName }));
  }

  private async perUnit<T>(fn: () => Promise<T>): Promise<{ unit: ReportUnit; data: T }[]> {
    const units = await this.networkUnits();
    const results: { unit: ReportUnit; data: T }[] = [];
    // One unit at a time: each one in its own tenant context.
    for (const unit of units) {
      results.push({ unit, data: await this.ctx.run(unit.storeId, fn, this.ctx.userId) });
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Day

  private async daySales(date: string, cutoff: Date | null) {
    const [concluded, refunds, canceled] = await Promise.all([
      this.db.order.findMany({
        where: {
          closedBusinessDate: date,
          status: 'DELIVERED',
          ...(cutoff && { deliveredAt: { lte: cutoff } }),
        },
        select: amountsSelect,
      }),
      this.db.payment.findMany({
        where: {
          refundBusinessDate: date,
          status: 'REFUNDED',
          order: { status: 'DELIVERED', closedBusinessDate: { lte: date } },
          ...(cutoff && { refundedAt: { lte: cutoff } }),
        },
        select: { amountCents: true },
      }),
      this.db.order.aggregate({
        where: {
          closedBusinessDate: date,
          status: 'CANCELED',
          ...(cutoff && { canceledAt: { lte: cutoff } }),
        },
        _count: true,
        _sum: { totalCents: true },
      }),
    ]);
    const breakdown = salesBreakdown(concluded);
    const refundsCents = sum(refunds.map((r) => r.amountCents));
    return {
      concluded,
      breakdown,
      refundsCents,
      revenueCents: breakdown.totalCents - refundsCents,
      canceled: { orders: canceled._count, totalCents: canceled._sum.totalCents ?? 0 },
    };
  }

  private async hourly(date: string, cutoff: Date | null): Promise<number[]> {
    const created = await this.db.order.findMany({
      where: {
        businessDate: date,
        status: { not: 'CANCELED' },
        ...(cutoff && { createdAt: { lte: cutoff } }),
      },
      select: { createdAt: true },
    });
    return byHour(created.map((o) => ({ at: o.createdAt, value: 1 })));
  }

  private async received(date: string, concludedIds: Set<string>) {
    const [payments, refunds] = await Promise.all([
      this.db.payment.findMany({
        where: { businessDate: date },
        select: {
          method: true,
          amountCents: true,
          orderId: true,
          order: { select: { status: true, closedBusinessDate: true } },
        },
      }),
      this.db.payment.findMany({
        where: { refundBusinessDate: date, status: 'REFUNDED' },
        select: {
          method: true,
          amountCents: true,
          orderId: true,
          order: { select: { status: true, closedBusinessDate: true } },
        },
      }),
    ]);
    type Row = (typeof payments)[number];
    const bucket = (p: Row) => {
      const closed = p.order.closedBusinessDate;
      if (p.order.status === 'CANCELED') return 'D';
      if (p.order.status === 'DELIVERED' && closed && closed <= date) {
        return concludedIds.has(p.orderId) ? 'A' : 'B';
      }
      return 'C';
    };
    const byMethod = new Map<PaymentMethod, number>();
    for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
    for (const r of refunds) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) - r.amountCents);
    const total = (rows: Row[], b: string) =>
      sum(rows.filter((r) => bucket(r) === b).map((r) => r.amountCents));
    return {
      receivedCents:
        sum(payments.map((p) => p.amountCents)) - sum(refunds.map((r) => r.amountCents)),
      byMethod: [...byMethod].map(([method, cents]) => ({ method, cents })),
      fromPreviousDaysCents: total(payments, 'B'),
      forOpenOrdersCents: total(payments, 'C') - total(refunds, 'C'),
      canceledNetCents: total(payments, 'D') - total(refunds, 'D'),
    };
  }

  private async attention(now: Date) {
    const [pendingAcceptance, openTasks, printers, soldOut] = await Promise.all([
      this.db.order.count({ where: { status: 'PENDING' } }),
      this.db.productionTask.findMany({
        where: { status: { in: ['QUEUED', 'PREPARING'] } },
        select: {
          roundId: true,
          sectorId: true,
          sentAt: true,
          sector: { select: { lateAfterMinutes: true } },
        },
      }),
      this.db.printer.findMany({
        where: { active: true, deletedAt: null },
        select: { status: true, agent: { select: { lastSeenAt: true, revokedAt: true } } },
      }),
      this.db.product.count({
        where: { isPaused: true, OR: [{ pausedUntil: null }, { pausedUntil: { gt: now } }] },
      }),
    ]);
    const late = new Set(
      openTasks
        .filter((t) => now.getTime() - t.sentAt.getTime() > t.sector.lateAfterMinutes * 60_000)
        .map((t) => `${t.roundId}:${t.sectorId}`),
    );
    return {
      pendingAcceptance,
      lateTickets: late.size,
      printersOffline: printers.filter(
        (p) =>
          ['OFFLINE', 'PAPER_OUT', 'ERROR'].includes(p.status) ||
          !!p.agent.revokedAt ||
          !agentOnline(p.agent.lastSeenAt, now),
      ).length,
      soldOut,
    };
  }

  private async topProducts(
    where: Prisma.OrderWhereInput,
    take?: number,
  ): Promise<TopProductRow[]> {
    const rows = await this.db.orderItem.groupBy({
      by: ['productId', 'name'],
      where: { order: where, status: { not: 'CANCELED' } },
      _sum: { quantity: true, totalCents: true },
    });
    const merged = mergeRows(
      [
        rows.map((r) => ({
          productId: r.productId,
          name: r.name,
          quantity: r._sum.quantity ?? 0,
          revenueCents: r._sum.totalCents ?? 0,
        })),
      ],
      (r) => r.productId ?? `name:${r.name}`,
      (t, r) => {
        t.quantity += r.quantity;
        t.revenueCents += r.revenueCents;
      },
    ).sort((a, b) => b.revenueCents - a.revenueCents);
    return take ? merged.slice(0, take) : merged;
  }

  async dayForStore(
    query: { date?: string; compare: CompareMode },
    now = new Date(),
  ): Promise<DayReportDto> {
    const today = await this.orders.businessDate(now);
    const date = query.date ?? today;
    const isCurrent = date === today;
    const hours = await this.menu.hours();
    const dates = comparisonDates(date, query.compare);
    const cutoffOf = (d: string) => (isCurrent ? sameMomentOn(d, { date, now }, hours) : null);

    const current = await this.daySales(date, null);
    const previous: Awaited<ReturnType<ReportsService['daySales']>>[] = [];
    for (const d of dates) previous.push(await this.daySales(d, cutoffOf(d)));
    const concludedIds = new Set(current.concluded.map((o) => o.id));

    // Payments of the orders concluded on this day (receivable and paid on other days).
    const ownPayments = concludedIds.size
      ? await this.db.payment.findMany({
          where: { orderId: { in: [...concludedIds] }, businessDate: { lte: date } },
          select: { orderId: true, amountCents: true, businessDate: true },
        })
      : [];
    const grossPaid = new Map<string, number>();
    for (const p of ownPayments)
      grossPaid.set(p.orderId, (grossPaid.get(p.orderId) ?? 0) + p.amountCents);
    const unpaid = current.concluded
      .map((o) => Math.max(0, o.totalCents - (grossPaid.get(o.id) ?? 0)))
      .filter((v) => v > 0);
    const received = await this.received(date, concludedIds);

    const [open, statusRows, todayHours] = await Promise.all([
      isCurrent
        ? this.db.order.aggregate({
            where: { status: { in: OPEN_STATUSES } },
            _count: true,
            _sum: { totalCents: true },
          })
        : null,
      this.db.order.groupBy({
        by: ['status'],
        where: isCurrent
          ? { OR: [{ status: { in: OPEN_STATUSES } }, { closedBusinessDate: date }] }
          : { closedBusinessDate: date },
        _count: true,
      }),
      this.hourly(date, null),
    ]);
    const compareHours: number[][] = [];
    for (const d of dates) compareHours.push(await this.hourly(d, cutoffOf(d)));

    const ticket = averageTicket(current.breakdown);
    const prevTickets = previous.map((p) => averageTicket(p.breakdown));
    const avg = (pick: (p: (typeof previous)[number]) => number) => averageOf(previous.map(pick));

    return {
      scope: 'STORE',
      units: [],
      date,
      isCurrent,
      serverTime: now.toISOString(),
      breakdown: current.breakdown,
      refundsCents: current.refundsCents,
      revenueCents: current.revenueCents,
      ticket,
      open: { orders: open?._count ?? 0, totalCents: open?._sum.totalCents ?? 0 },
      canceled: current.canceled,
      receivable: { orders: unpaid.length, cents: sum(unpaid) },
      received: { cents: received.receivedCents, byMethod: received.byMethod },
      reconciliation: reconcile({
        revenueCents: current.revenueCents,
        receivableCents: sum(unpaid),
        paidOnOtherDaysCents: sum(
          ownPayments.filter((p) => p.businessDate !== date).map((p) => p.amountCents),
        ),
        fromPreviousDaysCents: received.fromPreviousDaysCents,
        forOpenOrdersCents: received.forOpenOrdersCents,
        canceledNetCents: received.canceledNetCents,
        receivedCents: received.receivedCents,
      }),
      comparison: {
        mode: query.compare,
        dates,
        untilSameTime: isCurrent,
        revenue: compare(
          current.revenueCents,
          avg((p) => p.revenueCents),
        ),
        orders: compare(
          current.breakdown.orders,
          avg((p) => p.breakdown.orders),
        ),
        ticketTotal: compare(ticket.totalCents, averageOf(prevTickets.map((t) => t.totalCents))),
        ticketProducts: compare(
          ticket.productsCents,
          averageOf(prevTickets.map((t) => t.productsCents)),
        ),
        canceled: compare(
          current.canceled.orders,
          avg((p) => p.canceled.orders),
          'down',
        ),
      },
      channels: channelRows(current.concluded),
      statuses: statusRows.map((r) => ({ status: r.status, orders: r._count })),
      topProducts: await this.topProducts({ closedBusinessDate: date, status: 'DELIVERED' }, 5),
      hours: {
        today: todayHours,
        compare: Array.from(
          { length: 24 },
          (_, h) =>
            Math.round(
              (sum(compareHours.map((c) => c[h]!)) / Math.max(compareHours.length, 1)) * 10,
            ) / 10,
        ),
      },
      attention: isCurrent ? await this.attention(now) : null,
    };
  }

  async day(query: {
    date?: string;
    compare: CompareMode;
    scope: 'STORE' | 'NETWORK';
  }): Promise<DayReportDto> {
    if (query.scope === 'STORE') return this.dayForStore(query);
    const results = await this.perUnit(() => this.dayForStore(query));
    return this.mergeDays(results);
  }

  private mergeDays(results: { unit: ReportUnit; data: DayReportDto }[]): DayReportDto {
    const list = results.map((r) => r.data);
    const first = list[0]!;
    const breakdown = addBreakdowns(list.map((d) => d.breakdown));
    const addCmp = (
      pick: (d: DayReportDto) => { current: number; previous: number },
      better: 'up' | 'down' = 'up',
    ) =>
      compare(
        sum(list.map((d) => pick(d).current)),
        sum(list.map((d) => pick(d).previous)),
        better,
      );
    const ticket = averageTicket(breakdown);
    const prevBreakdowns = list.map((d) => d.comparison);
    const prevOrders = sum(prevBreakdowns.map((c) => c.orders.previous));
    const prevRevenue = sum(prevBreakdowns.map((c) => c.revenue.previous));
    const sumAttention = list.every((d) => d.attention)
      ? {
          pendingAcceptance: sum(list.map((d) => d.attention!.pendingAcceptance)),
          lateTickets: sum(list.map((d) => d.attention!.lateTickets)),
          printersOffline: sum(list.map((d) => d.attention!.printersOffline)),
          soldOut: sum(list.map((d) => d.attention!.soldOut)),
        }
      : null;
    const reconciliationKeys = [
      'revenueCents',
      'receivableCents',
      'paidOnOtherDaysCents',
      'fromPreviousDaysCents',
      'forOpenOrdersCents',
      'canceledNetCents',
      'receivedCents',
    ] as const;
    return {
      ...first,
      scope: 'NETWORK',
      units: results.map((r) => ({
        ...r.unit,
        revenueCents: r.data.revenueCents,
        orders: r.data.breakdown.orders,
        open: r.data.open.orders,
      })),
      breakdown,
      refundsCents: sum(list.map((d) => d.refundsCents)),
      revenueCents: sum(list.map((d) => d.revenueCents)),
      ticket,
      open: {
        orders: sum(list.map((d) => d.open.orders)),
        totalCents: sum(list.map((d) => d.open.totalCents)),
      },
      canceled: {
        orders: sum(list.map((d) => d.canceled.orders)),
        totalCents: sum(list.map((d) => d.canceled.totalCents)),
      },
      receivable: {
        orders: sum(list.map((d) => d.receivable.orders)),
        cents: sum(list.map((d) => d.receivable.cents)),
      },
      received: {
        cents: sum(list.map((d) => d.received.cents)),
        byMethod: mergeRows(
          list.map((d) => d.received.byMethod),
          (r) => r.method,
          (t, r) => {
            t.cents += r.cents;
          },
        ),
      },
      reconciliation: reconcile(
        Object.fromEntries(
          reconciliationKeys.map((k) => [k, sum(list.map((d) => d.reconciliation[k]))]),
        ) as Record<(typeof reconciliationKeys)[number], number>,
      ),
      comparison: {
        ...first.comparison,
        revenue: addCmp((d) => d.comparison.revenue),
        orders: addCmp((d) => d.comparison.orders),
        ticketTotal: compare(
          ticket.totalCents,
          prevOrders ? Math.round(prevRevenue / prevOrders) : 0,
        ),
        ticketProducts: compare(
          ticket.productsCents,
          averageOf(list.map((d) => d.comparison.ticketProducts.previous)),
        ),
        canceled: addCmp((d) => d.comparison.canceled, 'down'),
      },
      channels: mergeRows(
        list.map((d) => d.channels),
        (r) => r.channel,
        (t, r) => {
          t.orders += r.orders;
          t.revenueCents += r.revenueCents;
        },
      ),
      statuses: mergeRows(
        list.map((d) => d.statuses),
        (r) => r.status,
        (t, r) => {
          t.orders += r.orders;
        },
      ),
      topProducts: mergeRows(
        list.map((d) => d.topProducts),
        (r) => r.name,
        (t, r) => {
          t.quantity += r.quantity;
          t.revenueCents += r.revenueCents;
        },
      )
        .sort((a, b) => b.revenueCents - a.revenueCents)
        .slice(0, 5),
      hours: {
        today: Array.from({ length: 24 }, (_, h) => sum(list.map((d) => d.hours.today[h]!))),
        compare: Array.from({ length: 24 }, (_, h) => sum(list.map((d) => d.hours.compare[h]!))),
      },
      attention: sumAttention,
    };
  }

  // ---------------------------------------------------------------------------
  // Period

  async salesForStore(query: { from: string; to: string }): Promise<SalesReportDto> {
    const started = Date.now();
    const period = { gte: query.from, lte: query.to };
    const concludedWhere: Prisma.OrderWhereInput = {
      closedBusinessDate: period,
      status: 'DELIVERED',
    };
    const [
      concludedGroups,
      refunds,
      perDay,
      refundsPerDay,
      products,
      received,
      refundedBy,
      created,
      waiters,
    ] = await Promise.all([
      // Summed by the database: a year has tens of thousands of orders.
      this.db.order.groupBy({
        by: ['type', 'source'],
        where: concludedWhere,
        _count: true,
        _sum: {
          subtotalCents: true,
          itemDiscountCents: true,
          orderDiscountCents: true,
          couponDiscountCents: true,
          serviceFeeCents: true,
          deliveryFeeCents: true,
          totalCents: true,
        },
      }),
      this.db.payment.aggregate({
        where: {
          refundBusinessDate: period,
          status: 'REFUNDED',
          order: { status: 'DELIVERED', closedBusinessDate: { lte: query.to } },
        },
        _sum: { amountCents: true },
      }),
      this.db.order.groupBy({
        by: ['closedBusinessDate'],
        where: concludedWhere,
        _count: true,
        _sum: { totalCents: true },
      }),
      this.db.payment.groupBy({
        by: ['refundBusinessDate'],
        where: {
          refundBusinessDate: period,
          status: 'REFUNDED',
          order: { status: 'DELIVERED', closedBusinessDate: { lte: query.to } },
        },
        _sum: { amountCents: true },
      }),
      this.topProducts(concludedWhere),
      this.db.payment.groupBy({
        by: ['method'],
        where: { businessDate: period },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.db.payment.groupBy({
        by: ['method'],
        where: { refundBusinessDate: period, status: 'REFUNDED' },
        _sum: { amountCents: true },
      }),
      this.db.order.findMany({
        where: { businessDate: period, status: { not: 'CANCELED' } },
        select: { createdAt: true, totalCents: true },
      }),
      this.waiters(concludedWhere),
    ]);
    const breakdown = addBreakdowns(
      concludedGroups.map((g) =>
        salesBreakdownFromSums(g._count, {
          subtotalCents: g._sum.subtotalCents ?? 0,
          itemDiscountCents: g._sum.itemDiscountCents ?? 0,
          orderDiscountCents: g._sum.orderDiscountCents ?? 0,
          couponDiscountCents: g._sum.couponDiscountCents ?? 0,
          serviceFeeCents: g._sum.serviceFeeCents ?? 0,
          deliveryFeeCents: g._sum.deliveryFeeCents ?? 0,
          totalCents: g._sum.totalCents ?? 0,
        }),
      ),
    );
    const refundsCents = refunds._sum.amountCents ?? 0;

    // Categories of the products sold.
    const productIds = products.map((p) => p.productId).filter(Boolean) as string[];
    const catalog = productIds.length
      ? await this.db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, categoryId: true, category: { select: { name: true } } },
        })
      : [];
    const categoryOf = new Map(catalog.map((p) => [p.id, p]));
    const abc = abcCurve(products, (p) => p.revenueCents);
    const productRows = abc.map((r) => ({
      ...r.item,
      categoryName: categoryOf.get(r.item.productId ?? '')?.category.name ?? 'Sem categoria',
      sharePct: r.sharePct,
      cumulativePct: r.cumulativePct,
      abc: r.abc,
    }));
    const itemsTotal = sum(products.map((p) => p.revenueCents));
    const categories = mergeRows(
      [
        productRows.map((p) => ({
          categoryId: categoryOf.get(p.productId ?? '')?.categoryId ?? null,
          name: p.categoryName,
          quantity: p.quantity,
          revenueCents: p.revenueCents,
          sharePct: 0,
        })),
      ],
      (r) => r.categoryId ?? r.name,
      (t, r) => {
        t.quantity += r.quantity;
        t.revenueCents += r.revenueCents;
      },
    )
      .map((c) => ({
        ...c,
        sharePct: itemsTotal ? Math.round((c.revenueCents / itemsTotal) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);

    const refundedOf = new Map(refundedBy.map((r) => [r.method, r._sum.amountCents ?? 0]));
    const payments = received.map((r) => {
      const receivedCents = r._sum.amountCents ?? 0;
      const refundedCents = refundedOf.get(r.method) ?? 0;
      return {
        method: r.method,
        receivedCents,
        refundedCents,
        netCents: receivedCents - refundedCents,
        payments: r._count,
      };
    });
    for (const [method, refundedCents] of refundedOf) {
      if (!payments.some((p) => p.method === method)) {
        payments.push({
          method,
          receivedCents: 0,
          refundedCents,
          netCents: -refundedCents,
          payments: 0,
        });
      }
    }
    payments.sort((a, b) => b.netCents - a.netCents);

    const refundOfDay = new Map(
      refundsPerDay.map((r) => [r.refundBusinessDate ?? '', r._sum.amountCents ?? 0]),
    );
    const days = perDay
      .map((d) => ({
        date: d.closedBusinessDate ?? '',
        orders: d._count,
        revenueCents: (d._sum.totalCents ?? 0) - (refundOfDay.get(d.closedBusinessDate ?? '') ?? 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      scope: 'STORE',
      units: [],
      from: query.from,
      to: query.to,
      breakdown,
      refundsCents,
      revenueCents: breakdown.totalCents - refundsCents,
      ticket: averageTicket(breakdown),
      days,
      products: productRows,
      categories,
      payments,
      channels: mergeRows(
        [
          concludedGroups.map((g) => ({
            channel: reportChannelOf(g.type, g.source),
            orders: g._count,
            revenueCents: g._sum.totalCents ?? 0,
          })),
        ],
        (r) => r.channel,
        (t, r) => {
          t.orders += r.orders;
          t.revenueCents += r.revenueCents;
        },
      ).sort((a, b) => REPORT_CHANNELS.indexOf(a.channel) - REPORT_CHANNELS.indexOf(b.channel)),
      heatmap: heatmaps(created),
      waiters,
      elapsedMs: Date.now() - started,
    };
  }

  /** Items sent by each user (rounds) and service fee of the tables each one served. */
  private async waiters(where: Prisma.OrderWhereInput): Promise<WaiterRow[]> {
    // Items summed per round by the database, then each round's sender.
    const [itemsByRound, roundSenders, tables] = await Promise.all([
      this.db.orderItem.groupBy({
        by: ['roundId'],
        where: { order: { ...where, type: 'DINE_IN' }, status: { not: 'CANCELED' } },
        _sum: { totalCents: true, quantity: true },
      }),
      this.db.orderRound.findMany({
        where: { order: { ...where, type: 'DINE_IN' } },
        select: { id: true, sentById: true },
      }),
      this.db.order.findMany({
        where: { ...where, type: 'DINE_IN' },
        select: {
          serviceFeeCents: true,
          tableSessionId: true,
          tableSession: { select: { waiterId: true } },
        },
      }),
    ]);
    const rows = new Map<string, WaiterRow>();
    const row = (userId: string | null) => {
      const key = userId ?? '';
      if (!rows.has(key)) {
        rows.set(key, { userId, name: '', itemsCents: 0, items: 0, tables: 0, serviceFeeCents: 0 });
      }
      return rows.get(key)!;
    };
    const senderOf = new Map(roundSenders.map((r) => [r.id, r.sentById]));
    for (const i of itemsByRound) {
      const r = row(senderOf.get(i.roundId) ?? null);
      r.itemsCents += i._sum.totalCents ?? 0;
      r.items += i._sum.quantity ?? 0;
    }
    const sessions = new Map<string, string | null>();
    for (const t of tables) {
      const waiter = t.tableSession?.waiterId ?? null;
      row(waiter).serviceFeeCents += t.serviceFeeCents;
      if (t.tableSessionId) sessions.set(t.tableSessionId, waiter);
    }
    for (const waiter of sessions.values()) row(waiter).tables += 1;
    const ids = [...rows.keys()].filter(Boolean);
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return [...rows.values()]
      .map((r) => ({
        ...r,
        name: r.userId ? (names.get(r.userId) ?? 'Usuário removido') : 'Sem garçom',
      }))
      .sort((a, b) => b.itemsCents - a.itemsCents);
  }

  async sales(query: {
    from: string;
    to: string;
    scope: 'STORE' | 'NETWORK';
  }): Promise<SalesReportDto> {
    if (query.scope === 'STORE') return this.salesForStore(query);
    const started = Date.now();
    const results = await this.perUnit(() => this.salesForStore(query));
    const list = results.map((r) => r.data);
    const breakdown = addBreakdowns(list.map((d) => d.breakdown));
    const refundsCents = sum(list.map((d) => d.refundsCents));
    const products = mergeRows(
      list.map((d) => d.products),
      (r) => r.name,
      (t, r) => {
        t.quantity += r.quantity;
        t.revenueCents += r.revenueCents;
      },
    );
    const abc = abcCurve(products, (p) => p.revenueCents).map((r) => ({
      ...r.item,
      sharePct: r.sharePct,
      cumulativePct: r.cumulativePct,
      abc: r.abc,
    }));
    const grid = (pick: (d: SalesReportDto) => number[][]) =>
      Array.from({ length: 7 }, (_, w) =>
        Array.from({ length: 24 }, (_, h) => sum(list.map((d) => pick(d)[w]![h]!))),
      );
    return {
      scope: 'NETWORK',
      units: results.map((r) => ({
        ...r.unit,
        revenueCents: r.data.revenueCents,
        orders: r.data.breakdown.orders,
      })),
      from: query.from,
      to: query.to,
      breakdown,
      refundsCents,
      revenueCents: breakdown.totalCents - refundsCents,
      ticket: averageTicket(breakdown),
      days: mergeRows(
        list.map((d) => d.days),
        (r) => r.date,
        (t, r) => {
          t.orders += r.orders;
          t.revenueCents += r.revenueCents;
        },
      ).sort((a, b) => a.date.localeCompare(b.date)),
      products: abc,
      categories: mergeRows(
        list.map((d) => d.categories),
        (r) => r.name,
        (t, r) => {
          t.quantity += r.quantity;
          t.revenueCents += r.revenueCents;
        },
      ).sort((a, b) => b.revenueCents - a.revenueCents),
      payments: mergeRows(
        list.map((d) => d.payments),
        (r) => r.method,
        (t, r) => {
          t.receivedCents += r.receivedCents;
          t.refundedCents += r.refundedCents;
          t.netCents += r.netCents;
          t.payments += r.payments;
        },
      ),
      channels: mergeRows(
        list.map((d) => d.channels),
        (r) => r.channel,
        (t, r) => {
          t.orders += r.orders;
          t.revenueCents += r.revenueCents;
        },
      ),
      heatmap: {
        orders: grid((d) => d.heatmap.orders),
        revenueCents: grid((d) => d.heatmap.revenueCents),
      },
      // Waiters are per unit (a person works in one unit): listed with the unit name.
      waiters: results.flatMap((r) =>
        r.data.waiters.map((w) => ({ ...w, name: `${w.name} · ${r.unit.name}` })),
      ),
      elapsedMs: Date.now() - started,
    };
  }
}
