import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type CourierPositionDto,
  type LineString,
  lineLength,
  metersAlongTo,
  pointAlong,
} from '@app/shared';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { OrdersService } from '../orders/orders.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PositionsService } from './positions.service.js';
import { LiveEtaService } from './live-eta.service.js';
import { RoutePlannerService } from './route-planner.service.js';

/** Average speed of a motorcycle in the city (~22 km/h), times the chosen speed-up. */
const BASE_SPEED_MPS = 6.1;
const TICK_MS = 1_000;
/** The looping demo courier stores one position every this many ticks (the map gets all). */
const LOOP_STORE_EVERY = 15;
/** How often the looping couriers of the units (public demo) are looked for. */
const SCAN_EVERY_MS = 60_000;

interface Walk {
  tenantId: string;
  runId: string;
  courierId: string;
  line: LineString;
  length: number;
  meters: number;
  speedMps: number;
  /** The demo courier: walks the stored route forever and never delivers. */
  loop: boolean;
  stops: { stopId: string; orderId: string; at: number }[];
  ticks: number;
  busy: boolean;
  timer: ReturnType<typeof setInterval>;
  position: CourierPositionDto | null;
}

/**
 * The simulated courier (D048): walks a run along its stored route line through the same
 * position path the app uses, to test and demonstrate without anyone on the street. Started from
 * the dispatch screen (development, home server, public demo); the demo's simulated courier loops
 * its pre-calculated route forever, so no geocoding or routing is asked for each lap.
 */
@Injectable()
export class SimulationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Simulation');
  private readonly walks = new Map<string, Walk>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    // The loops of every unit are looked for at once (system job).
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly positions: PositionsService,
    private readonly planner: RoutePlannerService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
    private readonly liveEta: LiveEtaService,
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) return;
    void this.scanLoops();
    this.scanTimer = setInterval(() => void this.scanLoops(), SCAN_EVERY_MS);
    this.scanTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const walk of this.walks.values()) clearInterval(walk.timer);
    this.walks.clear();
  }

  /** Development, the home network server and the public demo (never a real restaurant). */
  async allowed(storeId: string): Promise<boolean> {
    if (!this.config.isProduction || this.config.get('LAN_SERVER')) return true;
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { demoMode: true },
    });
    return store?.demoMode ?? false;
  }

  isWalking(runId: string): boolean {
    return this.walks.has(runId);
  }

  positionOf(runId: string): CourierPositionDto | null {
    return this.walks.get(runId)?.position ?? null;
  }

  /** "Simular entregador" on an open run (inside the request's tenant context). */
  async start(runId: string, speed: number): Promise<void> {
    if (!(await this.allowed(this.ctx.tenantId))) {
      throw new ForbiddenError('A simulação só existe no desenvolvimento e na demonstração');
    }
    let run = await this.db.deliveryRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundError('Saída');
    if (run.status !== 'OUT') throw new ValidationError('Esta saída já foi encerrada');
    if (!run.routeGeometry) {
      await this.planner.planRun(runId);
      run = await this.db.deliveryRun.findFirst({ where: { id: runId } });
    }
    const line = (run?.routeGeometry ?? null) as LineString | null;
    if (!run || !line || line.length < 2) {
      throw new ValidationError('Saída sem rota no mapa: os pedidos precisam de localização');
    }
    const stops = await this.db.deliveryStop.findMany({
      where: { runId, deliveredAt: null, failedAt: null },
      orderBy: { sequence: 'asc' },
      include: { order: { select: { delivery: true } } },
    });
    this.stop(runId);
    const courier = await this.db.courier.findFirst({ where: { id: run.courierId } });
    this.begin({
      tenantId: this.ctx.tenantId,
      runId,
      courierId: run.courierId,
      line,
      speedMps: BASE_SPEED_MPS * speed,
      loop: courier?.simulated ?? false,
      stops: stops
        .filter((s) => s.order.delivery?.latitude != null)
        .map((s) => ({
          stopId: s.id,
          orderId: s.orderId,
          at: metersAlongTo(line, {
            latitude: s.order.delivery!.latitude!,
            longitude: s.order.delivery!.longitude!,
          }),
        })),
    });
  }

  stop(runId: string): void {
    const walk = this.walks.get(runId);
    if (!walk) return;
    clearInterval(walk.timer);
    this.walks.delete(runId);
  }

  private begin(
    input: Omit<Walk, 'length' | 'meters' | 'ticks' | 'busy' | 'timer' | 'position'>,
  ): void {
    const walk: Walk = {
      ...input,
      length: lineLength(input.line),
      meters: 0,
      ticks: 0,
      busy: false,
      position: null,
      timer: setInterval(() => void this.tick(walk), TICK_MS),
    };
    walk.timer.unref();
    this.walks.set(input.runId, walk);
  }

  private async tick(walk: Walk): Promise<void> {
    if (walk.busy) return;
    walk.busy = true;
    try {
      walk.ticks++;
      walk.meters += walk.speedMps * (TICK_MS / 1000);
      if (walk.meters >= walk.length) {
        if (walk.loop) walk.meters = 0;
        else walk.meters = walk.length;
      }
      const point = pointAlong(walk.line, walk.meters);
      const now = new Date();
      walk.position = { ...point, recordedAt: now.toISOString(), simulated: true };
      await this.positions.record(
        {
          tenantId: walk.tenantId,
          runId: walk.runId,
          courierId: walk.courierId,
          ...point,
          speedMps: walk.speedMps,
          recordedAt: now,
          simulated: true,
        },
        !walk.loop || walk.ticks % LOOP_STORE_EVERY === 0,
      );
      if (!walk.loop) {
        await this.deliverReached(walk);
        // Same recalculation as a real courier (the demo loop keeps its fixed route).
        if (this.walks.has(walk.runId)) {
          await this.ctx.run(walk.tenantId, () => this.liveEta.onPosition(walk.runId, point, now));
        }
      }
    } catch (error) {
      this.logger.warn(`Simulação da saída ${walk.runId}: ${(error as Error).message}`);
      this.stop(walk.runId);
    } finally {
      walk.busy = false;
    }
  }

  /** Each stop the courier passes is delivered (paid as expected), like "Entregue" in the app. */
  private async deliverReached(walk: Walk): Promise<void> {
    while (walk.stops.length && walk.meters >= walk.stops[0]!.at - 1) {
      const stop = walk.stops.shift()!;
      await this.ctx.run(walk.tenantId, async () => {
        const order = await this.db.order.findFirst({ where: { id: stop.orderId } });
        if (!order || order.status !== 'DISPATCHED') return;
        await this.orders.changeStatus(stop.orderId, {
          expectedVersion: order.version,
          status: 'DELIVERED',
          reason: 'Entregue (entregador simulado)',
        });
        const balance = Math.max(order.totalCents - order.paidCents, 0);
        const method = order.expectedPaymentMethod ?? 'CASH';
        // Cash: the customer pays with the change asked for at the order.
        const received = method === 'CASH' ? Math.max(order.changeForCents ?? 0, balance) : null;
        if (balance > 0) {
          await this.db.deliveryStop.update({
            where: { id: stop.stopId },
            data: {
              collectedMethod: method,
              collectedCents: balance,
              receivedCents: received,
              changeCents: received == null ? null : received - balance,
              collectedNote: 'Entregador simulado',
            },
          });
        }
        this.liveEta.stopConcluded(walk.runId);
        this.realtime.deliveryUpdated(walk.tenantId);
      });
    }
    if (!walk.stops.length && walk.meters >= walk.length) this.stop(walk.runId);
  }

  /** Keeps every looping simulated courier of every unit walking (the public demo). */
  async scanLoops(): Promise<void> {
    try {
      const runs = await this.prisma.deliveryRun.findMany({
        where: { status: 'OUT', courier: { simulated: true } },
        select: { id: true, tenantId: true, courierId: true, routeGeometry: true },
      });
      for (const run of runs) {
        if (this.walks.has(run.id)) continue;
        const line = run.routeGeometry as LineString | null;
        if (!line || line.length < 2) continue;
        this.begin({
          tenantId: run.tenantId,
          runId: run.id,
          courierId: run.courierId,
          line,
          speedMps: BASE_SPEED_MPS,
          loop: true,
          stops: [],
        });
      }
      // Runs that ended (demo reset) stop walking.
      for (const [runId, walk] of this.walks) {
        if (walk.loop && !runs.some((r) => r.id === runId)) this.stop(runId);
      }
    } catch (error) {
      this.logger.warn(`Busca dos entregadores simulados falhou: ${(error as Error).message}`);
    }
  }
}
