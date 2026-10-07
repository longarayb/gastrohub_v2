import { Injectable } from '@nestjs/common';
import type { DeliveryReportDto, DeliveryReportRowDto } from '@app/shared';
import { ValidationError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';

const MAX_DAYS = 92;
const minutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;

interface Sample {
  delivered: boolean;
  failed: boolean;
  /** Dispatch → delivered. */
  deliveryMinutes: number | null;
  /** Order created → delivered. */
  totalMinutes: number | null;
  late: boolean;
}

function row(key: string, name: string, samples: Sample[]): DeliveryReportRowDto {
  const avg = (values: (number | null)[]) => {
    const list = values.filter((v): v is number => v != null);
    return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
  };
  return {
    key,
    name,
    deliveries: samples.filter((s) => s.delivered).length,
    failures: samples.filter((s) => s.failed).length,
    avgDeliveryMinutes: avg(samples.map((s) => s.deliveryMinutes)),
    avgTotalMinutes: avg(samples.map((s) => s.totalMinutes)),
    late: samples.filter((s) => s.late).length,
  };
}

function grouped(entries: { key: string; name: string; sample: Sample }[]) {
  const groups = new Map<string, { name: string; samples: Sample[] }>();
  for (const e of entries) {
    const g = groups.get(e.key) ?? { name: e.name, samples: [] };
    g.samples.push(e.sample);
    groups.set(e.key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => row(key, g.name, g.samples))
    .sort((a, b) => b.deliveries - a.deliveries || a.name.localeCompare(b.name));
}

/** Delivery report of a period (business dates): fees apart, times per area and courier. */
@Injectable()
export class DeliveryReportService {
  constructor(@InjectDb() private readonly db: Db) {}

  async report(query: { from: string; to: string }): Promise<DeliveryReportDto> {
    if (query.from > query.to) throw new ValidationError('O início é depois do fim');
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
    if (days > MAX_DAYS) throw new ValidationError(`Período máximo de ${MAX_DAYS} dias`);
    const period = { gte: query.from, lte: query.to };

    const [orders, stops, couriers, balances, settlements] = await Promise.all([
      this.db.order.findMany({
        where: { type: 'DELIVERY', status: 'DELIVERED', businessDate: period },
        select: {
          totalCents: true,
          deliveryFeeCents: true,
          createdAt: true,
          deliveredAt: true,
          delivery: { select: { areaId: true, areaName: true, etaMinutes: true } },
        },
      }),
      this.db.deliveryStop.findMany({
        where: { run: { businessDate: period } },
        select: {
          dispatchedAt: true,
          deliveredAt: true,
          failedAt: true,
          run: { select: { courierId: true } },
          order: {
            select: {
              createdAt: true,
              delivery: { select: { areaId: true, areaName: true, etaMinutes: true } },
            },
          },
        },
      }),
      this.db.courier.findMany({ select: { id: true, name: true } }),
      this.db.courierLedgerEntry.groupBy({ by: ['courierId'], _sum: { amountCents: true } }),
      this.db.courierSettlement.groupBy({
        by: ['courierId'],
        where: { businessDate: period },
        _sum: { courierOwesCents: true },
      }),
    ]);

    const sampleOf = (s: (typeof stops)[number]): Sample => {
      const total = s.deliveredAt ? minutes(s.order.createdAt, s.deliveredAt) : null;
      const eta = s.order.delivery?.etaMinutes ?? null;
      return {
        delivered: !!s.deliveredAt,
        failed: !!s.failedAt,
        deliveryMinutes: s.deliveredAt ? minutes(s.dispatchedAt, s.deliveredAt) : null,
        totalMinutes: total,
        late: total != null && eta != null && total > eta,
      };
    };
    const courierName = new Map(couriers.map((c) => [c.id, c.name]));
    const owes = new Map(settlements.map((s) => [s.courierId, s._sum.courierOwesCents ?? 0]));

    return {
      from: query.from,
      to: query.to,
      orders: orders.length,
      productsCents: orders.reduce((t, o) => t + o.totalCents - o.deliveryFeeCents, 0),
      deliveryFeesCents: orders.reduce((t, o) => t + o.deliveryFeeCents, 0),
      byArea: grouped(
        stops.map((s) => ({
          key: s.order.delivery?.areaId ?? s.order.delivery?.areaName ?? 'none',
          name: s.order.delivery?.areaName ?? 'Sem área',
          sample: sampleOf(s),
        })),
      ),
      byCourier: grouped(
        stops.map((s) => ({
          key: s.run.courierId,
          name: courierName.get(s.run.courierId) ?? '',
          sample: sampleOf(s),
        })),
      ),
      balances: balances
        .map((b) => ({
          courierId: b.courierId,
          name: courierName.get(b.courierId) ?? '',
          balanceCents: b._sum.amountCents ?? 0,
          courierOwesCents: owes.get(b.courierId) ?? 0,
        }))
        .concat(
          [...owes.keys()]
            .filter((id) => !balances.some((b) => b.courierId === id))
            .map((id) => ({
              courierId: id,
              name: courierName.get(id) ?? '',
              balanceCents: 0,
              courierOwesCents: owes.get(id) ?? 0,
            })),
        )
        .filter((b) => b.balanceCents !== 0 || b.courierOwesCents !== 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
