import { Injectable } from '@nestjs/common';
import {
  type Address,
  type DispatchBoardDto,
  type DispatchCourierDto,
  type DispatchInput,
  type DispatchOrderDto,
  type DispatchStopDto,
  type LineString,
  type OrderDetailDto,
} from '@app/shared';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { RoutingService } from '../../core/routing/routing.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { OrdersService } from '../orders/orders.service.js';
import { OrderLocationService } from './order-location.service.js';
import { PositionsService } from './positions.service.js';
import { RoutePlannerService } from './route-planner.service.js';
import { SimulationService } from './simulation.service.js';

const addressLine = (json: unknown): string => {
  const a = json as Partial<Address> | null;
  if (!a?.street) return '';
  const main = [a.street, a.number].filter(Boolean).join(', ');
  return [main, a.complement].filter(Boolean).join(' · ');
};

/**
 * The dispatch screen (D048): delivery orders waiting to leave with where they go, and each
 * courier with the open run (stops, route line, last position). Orders without coordinates are
 * queued for geocoding in the background and arrive by realtime.
 */
@Injectable()
export class DispatchBoardService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) is not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
    private readonly locations: OrderLocationService,
    private readonly planner: RoutePlannerService,
    private readonly positions: PositionsService,
    private readonly simulation: SimulationService,
    private readonly routing: RoutingService,
  ) {}

  async board(): Promise<DispatchBoardDto> {
    const tenantId = this.ctx.tenantId;
    const store = await this.prisma.store.findUnique({
      where: { id: tenantId },
      select: { tradeName: true, latitude: true, longitude: true },
    });
    const summaries = await this.orders.list({
      type: 'DELIVERY',
      status: ['ACCEPTED', 'PREPARING', 'READY'],
    });
    const details = summaries.length
      ? await this.db.order.findMany({
          where: { id: { in: summaries.map((o) => o.id) } },
          select: { id: true, deliveryAddress: true, delivery: true },
        })
      : [];
    const missing: string[] = [];
    const orders: DispatchOrderDto[] = summaries.map((summary) => {
      const detail = details.find((d) => d.id === summary.id);
      const d = detail?.delivery;
      const located = d?.latitude != null && d.longitude != null;
      const locating = !located && !!d && !d.geocodedAt;
      if (locating) missing.push(summary.id);
      return {
        ...summary,
        addressLine: addressLine(detail?.deliveryAddress),
        location: located
          ? {
              latitude: d.latitude!,
              longitude: d.longitude!,
              source: d.geoSource,
              precision: d.geoPrecision,
            }
          : null,
        locating,
      };
    });
    if (missing.length) this.locations.enqueue(tenantId, missing);

    const couriers = await this.db.courier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const runs = await this.db.deliveryRun.findMany({
      where: { status: 'OUT' },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: { order: { select: { number: true, delivery: true } } },
        },
      },
    });
    const latest = await this.positions.latest(runs.map((r) => r.id));
    const result: DispatchCourierDto[] = couriers.map((courier) => {
      const run = runs.find((r) => r.courierId === courier.id);
      return {
        id: courier.id,
        name: courier.name,
        simulated: courier.simulated,
        status: run ? 'OUT' : 'FREE',
        run: run
          ? {
              id: run.id,
              departedAt: run.departedAt.toISOString(),
              stops: run.stops.map((s): DispatchStopDto => ({
                orderId: s.orderId,
                number: s.order.number,
                sequence: s.sequence,
                status: s.deliveredAt ? 'DELIVERED' : s.failedAt ? 'FAILED' : 'PENDING',
                etaAt: s.etaAt?.toISOString() ?? null,
                location:
                  s.order.delivery?.latitude != null && s.order.delivery.longitude != null
                    ? { latitude: s.order.delivery.latitude, longitude: s.order.delivery.longitude }
                    : null,
              })),
              geometry: (run.routeGeometry ?? null) as LineString | null,
              routeSource: run.routeSource,
              distanceMeters: run.routeDistanceMeters,
              position: this.simulation.positionOf(run.id) ?? latest.get(run.id) ?? null,
              simulating: this.simulation.isWalking(run.id),
            }
          : null,
      };
    });

    return {
      store: {
        name: store?.tradeName ?? '',
        location:
          store?.latitude != null && store.longitude != null
            ? { latitude: store.latitude, longitude: store.longitude }
            : null,
      },
      orders,
      couriers: result,
      routing: this.routing.configured,
      simulationAllowed: await this.simulation.allowed(tenantId),
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * "Despachar" (F9): the orders leave in the given order (the stops keep it) and the run gets
   * its route. The route is planned after the commit; when it fails the run still left.
   */
  async dispatch(input: DispatchInput): Promise<OrderDetailDto[]> {
    const result = await this.orders.dispatchMany(input);
    const run = await this.db.deliveryRun.findFirst({
      where: { courierId: input.courierId, status: 'OUT' },
    });
    if (run) await this.planner.planRun(run.id).catch(() => undefined);
    return result;
  }
}
