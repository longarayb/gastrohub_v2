import { Injectable } from '@nestjs/common';
import {
  type CourierPositionsInput,
  type CourierTrackingDto,
  type PositionSample,
  type PositionsAcceptedDto,
  TRACKING_CONSENT_VERSION,
  isUsablePosition,
  shouldStorePosition,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ForbiddenError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Courier } from '../../generated/prisma/client.js';
import { LiveEtaService } from './live-eta.service.js';
import { PositionsService } from './positions.service.js';

/** Positions a little before the departure or ahead of the server clock are still accepted. */
const CLOCK_SLACK_MS = 60_000;

/**
 * Location sharing of the signed-in courier (D049): accepted once (text version and date), sent
 * by the phone only during an open run, thinned before storing (moved enough or time passed),
 * shown live on the dispatch map and used to recalculate the arrivals.
 */
@Injectable()
export class TrackingService {
  /** Last stored position of each run (thinning without reading the table on each batch). */
  private readonly lastStored = new Map<string, PositionSample>();

  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) is not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly positions: PositionsService,
    private readonly liveEta: LiveEtaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private async courier(): Promise<Courier> {
    const userId = this.ctx.userId;
    if (!userId) throw new ForbiddenError();
    const courier = await this.db.courier.findFirst({ where: { userId, isActive: true } });
    if (!courier) throw new ForbiddenError('Seu usuário não está vinculado a um entregador');
    return courier;
  }

  /**
   * The public demo never receives a real person's location (any visitor could sign in as the
   * cashier and see it): its map has the simulated courier. The home network server (private)
   * and development allow it, to test with a real phone.
   */
  private async assertRealLocationAllowed(): Promise<void> {
    if (!this.config.isProduction || this.config.get('LAN_SERVER')) return;
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { demoMode: true },
    });
    if (store?.demoMode) {
      throw new ForbiddenError(
        'Na demonstração pública a localização real não é enviada: veja o entregador simulado no despacho',
      );
    }
  }

  async trackingOf(courier: Courier): Promise<CourierTrackingDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { tradeName: true },
    });
    return {
      storeName: store?.tradeName ?? '',
      consentVersion: courier.trackingConsentVersion,
      consentAt: courier.trackingConsentAt?.toISOString() ?? null,
      storedPositions: await this.positions.countOf(courier.id),
    };
  }

  /** "Concordo e compartilhar": only the current text version is accepted. */
  async consent(version: string): Promise<CourierTrackingDto> {
    if (version !== TRACKING_CONSENT_VERSION) {
      throw new ValidationError('O texto do compartilhamento mudou: leia de novo e aceite');
    }
    await this.assertRealLocationAllowed();
    const courier = await this.courier();
    const updated = await this.db.courier.update({
      where: { id: courier.id },
      data: { trackingConsentVersion: version, trackingConsentAt: new Date() },
    });
    await this.audit.log({
      action: AuditAction.COURIER_TRACKING_CONSENT,
      entity: 'Courier',
      entityId: courier.id,
      after: { version },
    });
    return this.trackingOf(updated);
  }

  async ingest(input: CourierPositionsInput, now = new Date()): Promise<PositionsAcceptedDto> {
    await this.assertRealLocationAllowed();
    const courier = await this.courier();
    if (courier.trackingConsentVersion !== TRACKING_CONSENT_VERSION) {
      throw new ForbiddenError('Aceite o compartilhamento da localização antes de enviar');
    }
    const run = await this.db.deliveryRun.findFirst({ where: { openCourierId: courier.id } });
    if (!run) {
      throw new ValidationError('Nenhuma saída aberta: a localização só é enviada durante a rota');
    }
    const from = run.departedAt.getTime() - CLOCK_SLACK_MS;
    const until = now.getTime() + CLOCK_SLACK_MS;
    const accepted = input.positions
      .filter((p) => isUsablePosition(p))
      .filter((p) => {
        const t = Date.parse(p.recordedAt);
        return t >= from && t <= until;
      })
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const pendingStops = await this.db.deliveryStop.count({
      where: { runId: run.id, deliveredAt: null, failedAt: null },
    });
    if (!accepted.length) return { accepted: 0, stored: 0, pendingStops };

    let last: PositionSample | null = this.lastStored.get(run.id) ?? null;
    if (!last) {
      const stored = await this.db.courierPosition.findFirst({
        where: { runId: run.id },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      });
      last = stored ? { ...stored, recordedAt: stored.recordedAt.toISOString() } : null;
    }
    let stored = 0;
    for (const [i, p] of accepted.entries()) {
      const keep = shouldStorePosition(last, p);
      const latest = i === accepted.length - 1;
      if (!keep && !latest) continue;
      await this.positions.record(
        {
          tenantId: this.ctx.tenantId,
          runId: run.id,
          courierId: courier.id,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracyMeters: p.accuracyMeters ?? null,
          speedMps: p.speedMps ?? null,
          heading: p.heading ?? null,
          recordedAt: new Date(p.recordedAt),
          simulated: false,
        },
        keep,
        latest,
      );
      if (keep) {
        stored++;
        last = p;
      }
    }
    if (last) this.lastStored.set(run.id, last);
    const latest = accepted.at(-1)!;
    await this.liveEta.onPosition(run.id, latest, now);
    return { accepted: accepted.length, stored, pendingStops };
  }
}
