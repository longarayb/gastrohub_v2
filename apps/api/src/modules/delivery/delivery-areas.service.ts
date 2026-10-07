import { Injectable } from '@nestjs/common';
import {
  type Address,
  type DeliveryAreaDto,
  type UnmatchedNeighborhoodDto,
  type deliveryAreaSchema,
  isAreaPaused,
  normalizePlace,
  unmatchedNeighborhoods,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { DeliveryArea } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type AreaData = z.output<typeof deliveryAreaSchema>;

const UNMATCHED_DAYS = 60;

function toDto(a: DeliveryArea, now = new Date()): DeliveryAreaDto {
  const paused = isAreaPaused(a, now);
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    neighborhoods: a.neighborhoods,
    city: a.city,
    radiusMeters: a.radiusMeters,
    feeCents: a.feeCents,
    etaMinutes: a.etaMinutes,
    minimumOrderCents: a.minimumOrderCents,
    freeAboveCents: a.freeAboveCents,
    // An expired pause reads as active (it resumes by itself).
    pausedReason: paused ? a.pausedReason : null,
    pausedUntil: paused && a.pausedUntil ? a.pausedUntil.toISOString() : null,
    paused,
    sortOrder: a.sortOrder,
  };
}

/** Delivery areas by neighborhood (default) or radius (docs/DECISOES.md D029). */
@Injectable()
export class DeliveryAreasService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  private async find(id: string): Promise<DeliveryArea> {
    const area = await this.db.deliveryArea.findFirst({ where: { id, deletedAt: null } });
    if (!area) throw new NotFoundError('Área de entrega');
    return area;
  }

  private changed(): void {
    this.realtime.deliveryUpdated(this.ctx.tenantId);
  }

  async list(): Promise<DeliveryAreaDto[]> {
    const areas = await this.db.deliveryArea.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const now = new Date();
    return areas.map((a) => toDto(a, now));
  }

  /** A neighborhood (or variation) can belong to one area only, or the match is ambiguous. */
  private async assertNeighborhoodsFree(
    data: Pick<AreaData, 'kind' | 'neighborhoods' | 'city'>,
    exceptId?: string,
  ): Promise<void> {
    if (data.kind !== 'NEIGHBORHOOD') return;
    const others = await this.db.deliveryArea.findMany({
      where: { deletedAt: null, kind: 'NEIGHBORHOOD', ...(exceptId && { id: { not: exceptId } }) },
    });
    const city = normalizePlace(data.city);
    for (const name of data.neighborhoods) {
      const key = normalizePlace(name);
      const clash = others.find(
        (o) =>
          (!o.city || !city || normalizePlace(o.city) === city) &&
          o.neighborhoods.some((n) => normalizePlace(n) === key),
      );
      if (clash) {
        const message = `O bairro "${name}" já está na área ${clash.name}`;
        throw new ValidationError(message, [{ path: 'neighborhoods', message }]);
      }
    }
  }

  private dataOf(input: AreaData) {
    const byNeighborhood = input.kind === 'NEIGHBORHOOD';
    return {
      name: input.name,
      kind: input.kind,
      neighborhoods: byNeighborhood ? input.neighborhoods : [],
      city: byNeighborhood ? input.city : null,
      radiusMeters: byNeighborhood ? null : (input.radiusMeters ?? null),
      feeCents: input.feeCents,
      etaMinutes: input.etaMinutes,
      minimumOrderCents: input.minimumOrderCents ?? null,
      freeAboveCents: input.freeAboveCents ?? null,
    };
  }

  async create(input: AreaData): Promise<DeliveryAreaDto> {
    await this.assertNeighborhoodsFree(input);
    const last = await this.db.deliveryArea.findFirst({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'desc' },
    });
    const area = await this.db.deliveryArea.create({
      data: { ...this.dataOf(input), sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    this.changed();
    return toDto(area);
  }

  async update(id: string, input: AreaData): Promise<DeliveryAreaDto> {
    await this.find(id);
    await this.assertNeighborhoodsFree(input, id);
    const area = await this.db.deliveryArea.update({ where: { id }, data: this.dataOf(input) });
    this.changed();
    return toDto(area);
  }

  /** Soft delete: past orders keep the area name. */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.db.deliveryArea.update({ where: { id }, data: { deletedAt: new Date() } });
    this.changed();
  }

  async pause(id: string, input: { reason: string; until?: Date | null }) {
    const area = await this.find(id);
    if (input.until && input.until <= new Date()) {
      throw new ValidationError('A retomada precisa ser no futuro');
    }
    const saved = await this.db.$transaction(async (tx) => {
      const updated = await tx.deliveryArea.update({
        where: { id },
        data: { pausedReason: input.reason, pausedUntil: input.until ?? null },
      });
      await this.audit.log(
        {
          action: AuditAction.DELIVERY_AREA_PAUSED,
          entity: 'DeliveryArea',
          entityId: id,
          reason: input.reason,
          after: { name: area.name, until: input.until ?? null },
        },
        tx,
      );
      return updated;
    });
    this.changed();
    return toDto(saved);
  }

  async resume(id: string) {
    const area = await this.find(id);
    const saved = await this.db.$transaction(async (tx) => {
      const updated = await tx.deliveryArea.update({
        where: { id },
        data: { pausedReason: null, pausedUntil: null },
      });
      await this.audit.log(
        {
          action: AuditAction.DELIVERY_AREA_RESUMED,
          entity: 'DeliveryArea',
          entityId: id,
          before: { name: area.name, reason: area.pausedReason },
        },
        tx,
      );
      return updated;
    });
    this.changed();
    return toDto(saved);
  }

  /** Adds a neighborhood name (variation) to an area, e.g. from the unmatched list. */
  async addNeighborhood(id: string, name: string): Promise<DeliveryAreaDto> {
    const area = await this.find(id);
    if (area.kind !== 'NEIGHBORHOOD') {
      throw new ValidationError('Esta área é por raio: não tem lista de bairros');
    }
    if (area.neighborhoods.some((n) => normalizePlace(n) === normalizePlace(name))) {
      return toDto(area);
    }
    await this.assertNeighborhoodsFree(
      { kind: 'NEIGHBORHOOD', neighborhoods: [name], city: area.city },
      id,
    );
    const saved = await this.db.deliveryArea.update({
      where: { id },
      data: { neighborhoods: [...area.neighborhoods, name.trim()] },
    });
    this.changed();
    return toDto(saved);
  }

  /** Neighborhoods of recent delivery orders and customers that no area covers. */
  async unmatched(): Promise<UnmatchedNeighborhoodDto[]> {
    const since = new Date(Date.now() - UNMATCHED_DAYS * 86_400_000);
    const [areas, orders, addresses, misses] = await Promise.all([
      this.db.deliveryArea.findMany({ where: { deletedAt: null } }),
      this.db.order.findMany({
        where: { type: 'DELIVERY', createdAt: { gte: since } },
        select: { deliveryAddress: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      this.db.customerAddress.findMany({
        where: { createdAt: { gte: since } },
        select: { neighborhood: true, city: true, createdAt: true },
        take: 2000,
      }),
      // Addresses the digital menu could not deliver to (D033).
      this.db.deliveryQuoteMiss.findMany({
        where: { createdAt: { gte: since } },
        select: { neighborhood: true, city: true, createdAt: true },
        take: 2000,
      }),
    ]);
    // Radius areas cover by distance: only the neighborhood areas are compared by name.
    const named = areas.filter((a) => a.kind === 'NEIGHBORHOOD');
    if (named.length === 0) return [];
    const seen = [
      ...orders
        .map((o) => ({ address: o.deliveryAddress as Address | null, at: o.createdAt }))
        .filter((o) => o.address)
        .map((o) => ({ neighborhood: o.address!.neighborhood, city: o.address!.city, at: o.at })),
      ...addresses.map((a) => ({ neighborhood: a.neighborhood, city: a.city, at: a.createdAt })),
      ...misses.map((m) => ({ neighborhood: m.neighborhood, city: m.city, at: m.createdAt })),
    ];
    return unmatchedNeighborhoods(seen, named).slice(0, 50);
  }
}
