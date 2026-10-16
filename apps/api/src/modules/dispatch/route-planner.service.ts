import { Injectable } from '@nestjs/common';
import {
  type Coordinates,
  type LineString,
  type RouteSuggestionDto,
  type RouteSuggestionInput,
  STOP_SERVICE_SECONDS,
  orderStops,
} from '@app/shared';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { RoutingService } from '../../core/routing/routing.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

interface Stop {
  orderId: string;
  number: number;
  point: Coordinates;
}

/**
 * Order of the stops and the route (D048): travel matrix from the routing service, order by our
 * own pure function (`orderStops`), legs and arrivals; straight line and order by distance when
 * the routing service fails, so dispatching never stops.
 */
@Injectable()
export class RoutePlannerService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) is not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly routing: RoutingService,
  ) {}

  async storePoint(): Promise<Coordinates> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { latitude: true, longitude: true },
    });
    if (store?.latitude == null || store.longitude == null) {
      throw new ValidationError(
        'A unidade não tem localização: confira o endereço em Configurações › Empresa',
      );
    }
    return { latitude: store.latitude, longitude: store.longitude };
  }

  private async stops(orderIds: readonly string[]): Promise<Stop[]> {
    const orders = await this.db.order.findMany({
      where: { id: { in: [...orderIds] } },
      select: { id: true, number: true, type: true, delivery: true },
    });
    return orderIds.map((id) => {
      const order = orders.find((o) => o.id === id);
      if (!order) throw new NotFoundError('Pedido');
      if (order.type !== 'DELIVERY')
        throw new ValidationError(`Pedido ${order.number} não é delivery`);
      const d = order.delivery;
      if (d?.latitude == null || d.longitude == null) {
        throw new ValidationError(`Pedido ${order.number} sem localização: marque no mapa`);
      }
      return {
        orderId: id,
        number: order.number,
        point: { latitude: d.latitude, longitude: d.longitude },
      };
    });
  }

  /** Suggested (or kept) order of the selected orders, leaving the store now. */
  async suggest(input: RouteSuggestionInput, now = new Date()): Promise<RouteSuggestionDto> {
    const ids = [...new Set(input.orderIds)];
    const stops = await this.stops(ids);
    const store = await this.storePoint();
    let ordered = stops;
    let fallback = false;
    if (!input.keepOrder && stops.length > 1) {
      const { matrix, source } = await this.routing.matrix([store, ...stops.map((s) => s.point)]);
      fallback = source === 'STRAIGHT' && this.routing.configured !== 'STRAIGHT';
      ordered = orderStops(matrix.durations).map((index) => stops[index - 1]!);
    }
    const route = await this.routing.route([store, ...ordered.map((s) => s.point)]);
    fallback ||= route.source === 'STRAIGHT' && this.routing.configured !== 'STRAIGHT';
    let clock = now.getTime();
    const legs = ordered.map((stop, i) => {
      const leg = route.legs[i]!;
      if (i > 0) clock += STOP_SERVICE_SECONDS * 1000;
      clock += leg.durationSeconds * 1000;
      return {
        orderId: stop.orderId,
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
        etaAt: new Date(clock).toISOString(),
      };
    });
    return {
      orderIds: ordered.map((s) => s.orderId),
      legs,
      distanceMeters: route.distanceMeters,
      durationSeconds: Math.round((clock - now.getTime()) / 1000),
      geometry: route.geometry,
      source: route.source,
      fallback,
    };
  }

  /**
   * Route of an open run through its pending stops, in their sequence, from the store (on
   * departure) or from the courier's current position (on the way, D049): saved on the run
   * (geometry, totals, source) and on each stop (leg and expected arrival). Stops without
   * coordinates are skipped (the run still works; the map just cannot draw them).
   */
  async planRun(runId: string, now = new Date(), from: Coordinates | null = null): Promise<void> {
    const run = await this.db.deliveryRun.findFirst({
      where: { id: runId },
      include: {
        stops: {
          where: { deliveredAt: null, failedAt: null },
          orderBy: { sequence: 'asc' },
          include: { order: { select: { delivery: true } } },
        },
      },
    });
    if (!run) throw new NotFoundError('Saída');
    const located = run.stops.filter(
      (s) => s.order.delivery?.latitude != null && s.order.delivery.longitude != null,
    );
    if (!located.length) return;
    const store = from ?? (await this.storePoint().catch(() => null));
    if (!store) return;
    const points = located.map((s) => ({
      latitude: s.order.delivery!.latitude!,
      longitude: s.order.delivery!.longitude!,
    }));
    const route = await this.routing.route([store, ...points]);
    await this.db.deliveryRun.update({
      where: { id: run.id },
      data: {
        routeGeometry: route.geometry as LineString,
        routeDistanceMeters: route.distanceMeters,
        routeDurationSeconds: route.durationSeconds,
        routeSource: route.source,
      },
    });
    let clock = now.getTime();
    for (const [i, stop] of located.entries()) {
      const leg = route.legs[i]!;
      if (i > 0) clock += STOP_SERVICE_SECONDS * 1000;
      clock += leg.durationSeconds * 1000;
      await this.db.deliveryStop.update({
        where: { id: stop.id },
        data: {
          legDistanceMeters: leg.distanceMeters,
          legDurationSeconds: leg.durationSeconds,
          etaAt: new Date(clock),
        },
      });
    }
  }
}
