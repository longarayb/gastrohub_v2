import { Injectable } from '@nestjs/common';
import {
  LOSS_KINDS,
  type LossEvent,
  type LossKind,
  type LossUserRow,
  type LossesReportDto,
  PRINT_JOB_KIND_LABELS,
  type TimesReportDto,
  addDaysToDate,
  applyBasisPoints,
  currentBusinessDay,
  durationStats,
} from '@app/shared';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { AuditAction } from '../../core/audit/audit.service.js';
import { MenuContext } from '../menu/menu-common.js';

/**
 * Loss prevention and operation times (D038). Events without a stored business day (item
 * cancellations, reprints, discounts and service fee removals from the audit) are mapped to
 * the business day of their instant with the store hours; the query window is widened by a day
 * on each side and filtered after.
 */
@Injectable()
export class LossesReportService {
  constructor(
    @InjectDb() private readonly db: Db,
    // User names (users are not tenant data) and the store timezone.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
  ) {}

  private async dayMapper() {
    const [hours, store] = await Promise.all([
      this.menu.hours(),
      this.prisma.store.findUnique({
        where: { id: this.ctx.tenantId },
        select: { timezone: true },
      }),
    ]);
    return (at: Date) => currentBusinessDay(hours, at, store?.timezone).date;
  }

  /** Instants that may belong to the business days of the period. */
  private static window(from: string, to: string) {
    return {
      gte: new Date(`${addDaysToDate(from, -1)}T00:00:00Z`),
      lt: new Date(`${addDaysToDate(to, 2)}T12:00:00Z`),
    };
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    const users = unique.length
      ? await this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        })
      : [];
    const map = new Map(users.map((u) => [u.id, u.name]));
    return (id: string | null | undefined) =>
      id ? (map.get(id) ?? 'Usuário removido') : 'Sistema';
  }

  async losses(query: { from: string; to: string }): Promise<LossesReportDto> {
    const period = { gte: query.from, lte: query.to };
    const window = LossesReportService.window(query.from, query.to);
    const dayOf = await this.dayMapper();
    const inPeriod = (date: string) => date >= query.from && date <= query.to;

    const [orders, items, refunds, discounted, waived, audits, reprints, sessions, reopened] =
      await Promise.all([
        this.db.order.findMany({
          where: { closedBusinessDate: period, status: 'CANCELED' },
          select: {
            id: true,
            number: true,
            totalCents: true,
            cancelReason: true,
            canceledById: true,
            canceledAt: true,
            acceptedAt: true,
            closedBusinessDate: true,
            rounds: { where: { sentAt: { not: null } }, select: { id: true }, take: 1 },
          },
        }),
        this.db.orderItem.findMany({
          where: { status: 'CANCELED', canceledAt: window },
          select: {
            name: true,
            quantity: true,
            totalCents: true,
            cancelReason: true,
            canceledById: true,
            canceledAt: true,
            startedAt: true,
            roundId: true,
            order: { select: { id: true, number: true, status: true } },
          },
        }),
        this.db.payment.findMany({
          where: { refundBusinessDate: period, status: 'REFUNDED' },
          select: {
            amountCents: true,
            method: true,
            refundReason: true,
            refundedById: true,
            refundedAt: true,
            refundBusinessDate: true,
            order: { select: { id: true, number: true } },
          },
        }),
        this.db.order.findMany({
          where: {
            closedBusinessDate: period,
            status: 'DELIVERED',
            OR: [{ orderDiscountCents: { gt: 0 } }, { itemDiscountCents: { gt: 0 } }],
          },
          select: {
            id: true,
            number: true,
            orderDiscountCents: true,
            itemDiscountCents: true,
            orderDiscountReason: true,
            deliveredAt: true,
            closedBusinessDate: true,
            items: {
              where: { discountCents: { gt: 0 } },
              select: { discountReason: true },
              take: 1,
            },
          },
        }),
        this.db.order.findMany({
          where: { closedBusinessDate: period, status: 'DELIVERED', serviceFeeWaived: true },
          select: {
            id: true,
            number: true,
            subtotalCents: true,
            orderDiscountCents: true,
            couponDiscountCents: true,
            serviceFeeBps: true,
            serviceFeeWaivedReason: true,
            deliveredAt: true,
            closedBusinessDate: true,
          },
        }),
        this.db.auditLog.findMany({
          where: {
            action: {
              in: [
                AuditAction.ORDER_DISCOUNT,
                AuditAction.ORDER_ITEM_DISCOUNT,
                AuditAction.SERVICE_FEE_REMOVED,
              ],
            },
            createdAt: { gte: new Date(window.gte.getTime() - 30 * 86_400_000), lt: window.lt },
          },
          orderBy: { createdAt: 'asc' },
          select: { action: true, entityId: true, userId: true },
        }),
        this.db.printJob.findMany({
          where: { reprintOfId: { not: null }, createdAt: window },
          select: { kind: true, title: true, createdById: true, createdAt: true, orderId: true },
        }),
        this.db.cashSession.findMany({
          where: { businessDate: period, status: 'CLOSED' },
          select: {
            businessDate: true,
            operatorId: true,
            closedAt: true,
            counts: { select: { differenceCents: true } },
          },
        }),
        this.db.cashSession.findMany({
          where: { reopenedAt: window },
          select: { reopenedAt: true, reopenedById: true, reopenReason: true, businessDate: true },
        }),
      ]);

    // Last user who gave a discount / removed the fee of each order (from the audit).
    const lastUser = new Map<string, string | null>();
    for (const a of audits) if (a.entityId) lastUser.set(`${a.action}:${a.entityId}`, a.userId);

    // Items whose round ticket was printed: canceled after production started.
    const printedRounds = new Set(
      (
        await this.db.printJob.findMany({
          where: {
            kind: 'KITCHEN_TICKET',
            status: { in: ['PRINTED', 'LEASED'] },
            orderId: { in: [...new Set(items.map((i) => i.order.id))] },
          },
          select: { dedupeKey: true },
        })
      )
        .map((j) => j.dedupeKey?.split(':')[1])
        .filter(Boolean) as string[],
    );

    const events: Omit<LossEvent, 'userName'>[] = [];
    for (const o of orders) {
      events.push({
        kind: 'ORDER_CANCELED',
        at: (o.canceledAt ?? new Date()).toISOString(),
        businessDate: o.closedBusinessDate ?? '',
        userId: o.canceledById,
        reason: o.cancelReason,
        cents: o.totalCents,
        orderId: o.id,
        orderNumber: o.number,
        description: `Pedido #${o.number}`,
        afterProduction: !!o.acceptedAt && o.rounds.length > 0,
      });
    }
    for (const i of items) {
      if (!i.canceledAt || i.order.status === 'CANCELED') continue; // the whole order is listed
      const date = dayOf(i.canceledAt);
      if (!inPeriod(date)) continue;
      events.push({
        kind: 'ITEM_CANCELED',
        at: i.canceledAt.toISOString(),
        businessDate: date,
        userId: i.canceledById,
        reason: i.cancelReason,
        cents: i.totalCents,
        orderId: i.order.id,
        orderNumber: i.order.number,
        description: `${i.quantity}x ${i.name}`,
        afterProduction: !!i.startedAt || printedRounds.has(i.roundId),
      });
    }
    for (const r of refunds) {
      events.push({
        kind: 'REFUND',
        at: (r.refundedAt ?? new Date()).toISOString(),
        businessDate: r.refundBusinessDate ?? '',
        userId: r.refundedById,
        reason: r.refundReason,
        cents: r.amountCents,
        orderId: r.order.id,
        orderNumber: r.order.number,
        description: `Estorno ${r.method}`,
        afterProduction: false,
      });
    }
    for (const o of discounted) {
      events.push({
        kind: 'DISCOUNT',
        at: (o.deliveredAt ?? new Date()).toISOString(),
        businessDate: o.closedBusinessDate ?? '',
        userId:
          lastUser.get(`${AuditAction.ORDER_DISCOUNT}:${o.id}`) ??
          lastUser.get(`${AuditAction.ORDER_ITEM_DISCOUNT}:${o.id}`) ??
          null,
        reason: o.orderDiscountReason ?? o.items[0]?.discountReason ?? null,
        cents: o.orderDiscountCents + o.itemDiscountCents,
        orderId: o.id,
        orderNumber: o.number,
        description: `Pedido #${o.number}`,
        afterProduction: false,
      });
    }
    for (const o of waived) {
      const itemsNet = o.subtotalCents - o.orderDiscountCents - o.couponDiscountCents;
      events.push({
        kind: 'SERVICE_FEE_REMOVED',
        at: (o.deliveredAt ?? new Date()).toISOString(),
        businessDate: o.closedBusinessDate ?? '',
        userId: lastUser.get(`${AuditAction.SERVICE_FEE_REMOVED}:${o.id}`) ?? null,
        reason: o.serviceFeeWaivedReason,
        cents: applyBasisPoints(itemsNet, o.serviceFeeBps),
        orderId: o.id,
        orderNumber: o.number,
        description: `Pedido #${o.number} · ${o.serviceFeeBps / 100}%`,
        afterProduction: false,
      });
    }
    for (const j of reprints) {
      const date = dayOf(j.createdAt);
      if (!inPeriod(date)) continue;
      events.push({
        kind: 'REPRINT',
        at: j.createdAt.toISOString(),
        businessDate: date,
        userId: j.createdById,
        reason: null,
        cents: 0,
        orderId: j.orderId,
        orderNumber: null,
        description: `${PRINT_JOB_KIND_LABELS[j.kind]}: ${j.title}`,
        afterProduction: false,
      });
    }
    for (const s of sessions) {
      const difference = s.counts.reduce((t, c) => t + c.differenceCents, 0);
      if (!difference) continue;
      events.push({
        kind: 'CASH_DIFFERENCE',
        at: (s.closedAt ?? new Date()).toISOString(),
        businessDate: s.businessDate,
        userId: s.operatorId,
        reason: difference < 0 ? 'Falta no caixa' : 'Sobra no caixa',
        cents: difference,
        orderId: null,
        orderNumber: null,
        description: `Fechamento de ${s.businessDate.split('-').reverse().join('/')}`,
        afterProduction: false,
      });
    }
    for (const s of reopened) {
      if (!s.reopenedAt || !inPeriod(dayOf(s.reopenedAt))) continue;
      events.push({
        kind: 'CASH_REOPENED',
        at: s.reopenedAt.toISOString(),
        businessDate: dayOf(s.reopenedAt),
        userId: s.reopenedById,
        reason: s.reopenReason,
        cents: 0,
        orderId: null,
        orderNumber: null,
        description: `Caixa de ${s.businessDate.split('-').reverse().join('/')}`,
        afterProduction: false,
      });
    }

    const nameOf = await this.names(events.map((e) => e.userId));
    const full: LossEvent[] = events
      .map((e) => ({ ...e, userName: nameOf(e.userId) }))
      .sort((a, b) => b.at.localeCompare(a.at));

    const users = new Map<string, LossUserRow>();
    const reasons = new Map<
      string,
      { kind: LossKind; reason: string; count: number; cents: number }
    >();
    for (const e of full) {
      const u = users.get(e.userId ?? '') ?? {
        userId: e.userId,
        name: e.userName,
        counts: {},
        cents: {},
        afterProduction: 0,
      };
      u.counts[e.kind] = (u.counts[e.kind] ?? 0) + 1;
      u.cents[e.kind] = (u.cents[e.kind] ?? 0) + e.cents;
      if (e.afterProduction) u.afterProduction += 1;
      users.set(e.userId ?? '', u);
      const reason = e.reason?.trim() || 'Sem motivo informado';
      const key = `${e.kind}:${reason.toLowerCase()}`;
      const r = reasons.get(key) ?? { kind: e.kind, reason, count: 0, cents: 0 };
      r.count += 1;
      r.cents += e.cents;
      reasons.set(key, r);
    }
    const weight = (u: LossUserRow) =>
      Object.values(u.counts).reduce((a, b) => a + (b ?? 0), 0) + u.afterProduction * 2;

    return {
      from: query.from,
      to: query.to,
      events: full,
      totals: LOSS_KINDS.map((kind) => ({
        kind,
        count: full.filter((e) => e.kind === kind).length,
        cents: full.filter((e) => e.kind === kind).reduce((t, e) => t + e.cents, 0),
      })),
      users: [...users.values()].sort((a, b) => weight(b) - weight(a)),
      reasons: [...reasons.values()].sort((a, b) => b.count - a.count),
    };
  }

  // ---------------------------------------------------------------------------
  // Operation times

  async times(query: { from: string; to: string }): Promise<TimesReportDto> {
    const dayOf = await this.dayMapper();
    const tasks = await this.db.productionTask.findMany({
      where: {
        sentAt: LossesReportService.window(query.from, query.to),
        status: 'READY',
        readyAt: { not: null },
      },
      select: {
        name: true,
        sentAt: true,
        startedAt: true,
        readyAt: true,
        sectorId: true,
        sector: { select: { name: true, lateAfterMinutes: true } },
      },
    });
    const valid = tasks.filter((t) => {
      const date = dayOf(t.sentAt);
      return date >= query.from && date <= query.to;
    });
    const seconds = (a: Date | null, b: Date | null) =>
      a && b ? Math.round((b.getTime() - a.getTime()) / 1000) : NaN;
    const group = (key: (t: (typeof valid)[number]) => string) => {
      const map = new Map<string, typeof valid>();
      for (const t of valid) map.set(key(t), [...(map.get(key(t)) ?? []), t]);
      return map;
    };
    const stats = (list: typeof valid, limitSeconds?: number) => ({
      wait: durationStats(list.map((t) => seconds(t.sentAt, t.startedAt))),
      prep: durationStats(list.map((t) => seconds(t.startedAt ?? t.sentAt, t.readyAt))),
      total: durationStats(
        list.map((t) => seconds(t.sentAt, t.readyAt)),
        limitSeconds,
      ),
    });
    const sectors = [...group((t) => t.sectorId)].map(([id, list]) => ({
      id,
      name: list[0]!.sector.name,
      lateAfterMinutes: list[0]!.sector.lateAfterMinutes,
      ...stats(list, list[0]!.sector.lateAfterMinutes * 60),
    }));
    const products = [...group((t) => `${t.sectorId}:${t.name}`)].map(([, list]) => ({
      id: null,
      name: list[0]!.name,
      sectorName: list[0]!.sector.name,
      ...stats(list, list[0]!.sector.lateAfterMinutes * 60),
    }));
    return {
      from: query.from,
      to: query.to,
      sectors: sectors.sort((a, b) => b.total.count - a.total.count),
      products: products
        .filter((p) => p.total.count > 0)
        .sort((a, b) => (b.total.medianSeconds ?? 0) - (a.total.medianSeconds ?? 0)),
    };
  }
}
