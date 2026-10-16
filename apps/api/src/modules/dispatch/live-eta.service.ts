import { Injectable, Logger } from '@nestjs/common';
import { type Coordinates, ETA_REFRESH_SECONDS } from '@app/shared';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RoutePlannerService } from './route-planner.service.js';

/** Pending stops are compared this often (a delivered stop recalculates right away). */
const CHECK_EVERY_MS = 30_000;

interface RunState {
  /** Last recalculation and the pending stops at that time. */
  plannedAt: number;
  pending: string;
  checkedAt: number;
  busy: boolean;
}

/**
 * Arrivals recalculated on the way (D049): from the courier's position through the pending stops,
 * when a stop is concluded or every few minutes — never on each position, to spare the routing
 * service. The demo's looping courier never comes here (its route is fixed).
 */
@Injectable()
export class LiveEtaService {
  private readonly logger = new Logger('LiveEta');
  private readonly runs = new Map<string, RunState>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly planner: RoutePlannerService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Inside the unit's tenant context. True when the arrivals were recalculated. */
  async onPosition(runId: string, position: Coordinates, now = new Date()): Promise<boolean> {
    const at = now.getTime();
    const state = this.runs.get(runId) ?? { plannedAt: 0, pending: '', checkedAt: 0, busy: false };
    this.runs.set(runId, state);
    if (state.busy) return false;
    const due = at - state.plannedAt >= ETA_REFRESH_SECONDS * 1000;
    if (!due && at - state.checkedAt < CHECK_EVERY_MS) return false;
    state.busy = true;
    state.checkedAt = at;
    try {
      const stops = await this.db.deliveryStop.findMany({
        where: { runId, deliveredAt: null, failedAt: null },
        select: { id: true },
        orderBy: { sequence: 'asc' },
      });
      if (!stops.length) {
        this.runs.delete(runId);
        return false;
      }
      const pending = stops.map((s) => s.id).join(',');
      if (!due && pending === state.pending) return false;
      await this.planner.planRun(runId, now, position);
      state.plannedAt = at;
      state.pending = pending;
      this.realtime.deliveryUpdated(this.ctx.tenantId);
      return true;
    } catch (error) {
      this.logger.warn(`Previsões da saída ${runId}: ${(error as Error).message}`);
      return false;
    } finally {
      state.busy = false;
    }
  }

  /**
   * A stop was concluded (courier app, simulator): the next position recalculates right away.
   * Stops concluded elsewhere (kanban) are noticed by the periodic check.
   */
  stopConcluded(runId: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.checkedAt = 0;
      state.plannedAt = 0;
    }
  }

  /** Tests: forget the timers of a run. */
  reset(runId?: string): void {
    if (runId) this.runs.delete(runId);
    else this.runs.clear();
  }
}
