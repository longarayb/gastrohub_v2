import { Injectable } from '@nestjs/common';
import {
  type BusinessHour,
  type PauseInput,
  type PriceRange,
  chargedPrice,
  endOfBusinessDay,
  normalizeSearch,
} from '@app/shared';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

export interface PauseState {
  isPaused: boolean;
  pausedUntil: Date | null;
}

/** Store data the menu needs (timezone, hours, pizza rule). */
@Injectable()
export class MenuContext {
  constructor(
    // Store is the tenant itself (not tenant-scoped).
    private readonly prisma: PrismaService,
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
  ) {}

  async store() {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { id: true, timezone: true, pizzaPricingRule: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    return store;
  }

  async hours(): Promise<BusinessHour[]> {
    return this.db.businessHours.findMany({
      select: { weekday: true, opensAt: true, closesAt: true },
    });
  }

  /** Pause state for "Acabou" (end of the business day) or an indefinite pause. */
  async pauseState(input: PauseInput, now = new Date()): Promise<PauseState> {
    if (input.mode === 'INDEFINITE') return { isPaused: true, pausedUntil: null };
    const [store, hours] = await Promise.all([this.store(), this.hours()]);
    return { isPaused: true, pausedUntil: endOfBusinessDay(hours, now, store.timezone) };
  }
}

export const RESUMED: PauseState = { isPaused: false, pausedUntil: null };

/**
 * Rewrites `sortOrder` following the order of `ids`, which must contain exactly the existing ids.
 */
export async function applyOrder(
  tx: DbTx,
  model: 'category' | 'product' | 'productionSector',
  ids: string[],
  existingIds: string[],
): Promise<void> {
  const known = new Set(existingIds);
  // The full list is required: a partial list would leave duplicated positions.
  if (
    ids.length !== known.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !known.has(id))
  ) {
    throw new ValidationError('Lista de ordenação inválida. Atualize a página e tente novamente.');
  }
  for (const [index, id] of ids.entries()) {
    // Prisma has no bulk "update with different values"; lists are small.
    await (tx[model] as unknown as { update: (a: unknown) => Promise<unknown> }).update({
      where: { id },
      data: { sortOrder: index },
    });
  }
}

export function buildSearchText(...parts: (string | null | undefined)[]): string {
  return normalizeSearch(parts.filter(Boolean).join(' '));
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Price range over a list of price tags (charged prices). */
export function priceRange(
  tags: { priceCents: number; promoPriceCents: number | null }[],
): PriceRange {
  if (tags.length === 0) return { fromCents: null, toCents: null, hasPromo: false };
  const charged = tags.map(chargedPrice);
  return {
    fromCents: Math.min(...charged),
    toCents: Math.max(...charged),
    hasPromo: tags.some((t) => chargedPrice(t) < t.priceCents),
  };
}
