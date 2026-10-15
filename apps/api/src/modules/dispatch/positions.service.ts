import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { CourierPositionDto } from '@app/shared';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Positions are kept 7 days (D048, LGPD); only the run summary stays for the reports. */
export const POSITION_RETENTION_DAYS = 7;
const CLEANUP_EVERY_MS = 6 * 3_600_000;

export interface PositionInput {
  tenantId: string;
  runId: string;
  courierId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  speedMps?: number | null;
  heading?: number | null;
  recordedAt: Date;
  simulated: boolean;
}

/** Courier positions during an open run: stored, sent to the unit's room, deleted after 7 days. */
@Injectable()
export class PositionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Positions');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    // Retention runs for every unit at once (system job, no tenant).
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    void this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes positions older than the retention (all units). */
  async cleanup(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - POSITION_RETENTION_DAYS * 24 * 3_600_000);
    try {
      const { count } = await this.prisma.courierPosition.deleteMany({
        where: { recordedAt: { lt: before } },
      });
      if (count) this.logger.log(`${count} posições antigas apagadas`);
      return count;
    } catch (error) {
      this.logger.warn(`Limpeza das posições falhou: ${(error as Error).message}`);
      return 0;
    }
  }

  /** Sends the position to the unit's room; `store` also keeps it (the simulator skips most). */
  async record(input: PositionInput, store = true): Promise<void> {
    if (store) {
      await this.prisma.courierPosition.create({
        data: {
          tenantId: input.tenantId,
          runId: input.runId,
          courierId: input.courierId,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracyMeters: input.accuracyMeters ?? null,
          speedMps: input.speedMps ?? null,
          heading: input.heading ?? null,
          recordedAt: input.recordedAt,
          simulated: input.simulated,
        },
      });
    }
    this.realtime.courierPosition(input.tenantId, {
      courierId: input.courierId,
      runId: input.runId,
      latitude: input.latitude,
      longitude: input.longitude,
      recordedAt: input.recordedAt.toISOString(),
      simulated: input.simulated,
    });
  }

  /** Last stored position of each run (inside a tenant context). */
  async latest(runIds: readonly string[]): Promise<Map<string, CourierPositionDto>> {
    const result = new Map<string, CourierPositionDto>();
    for (const runId of runIds) {
      const last = await this.db.courierPosition.findFirst({
        where: { runId },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      });
      if (last) {
        result.set(runId, {
          latitude: last.latitude,
          longitude: last.longitude,
          recordedAt: last.recordedAt.toISOString(),
          simulated: last.simulated,
        });
      }
    }
    return result;
  }
}
