import { Injectable } from '@nestjs/common';
import {
  type BusinessHour,
  type CatalogCategory,
  type CatalogDto,
  type CatalogGroup,
  type CatalogProduct,
  type PizzaPricingRule,
  type SalesChannel,
  effectiveModifierLinks,
  getProductAvailability,
  isPausedNow,
} from '@app/shared';
import { ImageService } from '../../core/storage/image.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MenuContext, priceRange } from './menu-common.js';

const scheduleSelect = { select: { weekday: true, opensAt: true, closesAt: true } } as const;
const linkSelect = {
  select: { groupId: true, minSelect: true, maxSelect: true, sortOrder: true, isDisabled: true },
} as const;

const groupInclude = {
  options: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sectorId: true,
          isPaused: true,
          pausedUntil: true,
          deletedAt: true,
        },
      },
      sizePrices: { select: { sizeId: true, priceCents: true } },
    },
  },
} satisfies Prisma.ModifierGroupInclude;
type GroupRow = Prisma.ModifierGroupGetPayload<{ include: typeof groupInclude }>;

export interface CatalogOptions {
  channel: SalesChannel;
  /** Digital menu: products are unavailable while the store is closed. */
  enforceStoreHours?: boolean;
  /** Hide paused/unavailable products (digital menu may prefer to show them as "esgotado"). */
  onlyAvailable?: boolean;
  now?: Date;
}

/**
 * Builds the fully resolved menu for a channel: prices, effective modifier groups
 * (category + product, overrides applied) and availability with reasons.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly menu: MenuContext,
    private readonly images: ImageService,
  ) {}

  async build(options: CatalogOptions): Promise<CatalogDto> {
    const now = options.now ?? new Date();
    const [store, storeHours, categories, groups] = await Promise.all([
      this.menu.store(),
      this.menu.hours(),
      this.db.category.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        include: {
          sizes: { orderBy: { sortOrder: 'asc' } },
          schedules: scheduleSelect,
          modifierLinks: linkSelect,
          products: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            include: {
              sizes: { orderBy: { sortOrder: 'asc' } },
              sizePrices: true,
              schedules: scheduleSelect,
              modifierLinks: linkSelect,
            },
          },
        },
      }),
      this.db.modifierGroup.findMany({ where: { deletedAt: null }, include: groupInclude }),
    ]);
    const groupsById = new Map(groups.map((g) => [g.id, g]));

    const toGroup = (link: {
      groupId: string;
      minSelect: number;
      maxSelect: number;
    }): CatalogGroup | null => {
      const group: GroupRow | undefined = groupsById.get(link.groupId);
      if (!group) return null;
      return {
        groupId: group.id,
        name: group.name,
        description: group.description,
        minSelect: link.minSelect,
        maxSelect: link.maxSelect,
        options: group.options.map((o) => {
          const productGone = !!o.product && (!!o.product.deletedAt || isPausedNow(o.product, now));
          return {
            id: o.id,
            name: o.product?.name ?? o.name,
            priceCents: o.priceCents,
            sizePrices: o.sizePrices,
            maxQuantity: o.maxQuantity,
            available: !isPausedNow(o, now) && !productGone,
            product: o.product
              ? { id: o.product.id, name: o.product.name, sectorId: o.product.sectorId }
              : null,
          };
        }),
      };
    };
    const resolveGroups = (links: { groupId: string; minSelect: number; maxSelect: number }[]) =>
      links.map(toGroup).filter((g): g is CatalogGroup => g !== null);

    const result: CatalogCategory[] = categories.map((category) => {
      const categoryRules = {
        isPaused: category.isPaused,
        pausedUntil: category.pausedUntil,
        channels: category.channels as SalesChannel[],
        schedules: category.schedules as BusinessHour[],
      };
      const isPizza = category.kind === 'PIZZA';

      const products: CatalogProduct[] = category.products.map((p) => {
        const priceOf = (sizeId: string) => p.sizePrices.find((sp) => sp.sizeId === sizeId);
        const sizeSource = isPizza ? category.sizes : p.sizes;
        const sizes = sizeSource.map((s) => {
          const price = priceOf(s.id);
          return {
            id: s.id,
            name: s.name,
            maxFlavors: s.maxFlavors,
            slices: s.slices,
            priceCents: price?.priceCents ?? null,
            promoPriceCents: price?.promoPriceCents ?? null,
            available: !!price && !isPausedNow(price, now),
          };
        });
        const tags =
          p.priceCents != null
            ? [{ priceCents: p.priceCents, promoPriceCents: p.promoPriceCents }]
            : sizes
                .filter((s) => s.priceCents != null)
                .map((s) => ({ priceCents: s.priceCents!, promoPriceCents: s.promoPriceCents }));

        const availability = getProductAvailability({
          category: categoryRules,
          product: {
            isPaused: p.isPaused,
            pausedUntil: p.pausedUntil,
            channels: p.channels as SalesChannel[],
            schedules: p.schedules as BusinessHour[],
          },
          channel: options.channel,
          now,
          timeZone: store.timezone,
          storeHours,
          enforceStoreHours: options.enforceStoreHours,
        });
        // A product whose every size is paused cannot be sold either.
        if (availability.available && sizes.length > 0 && !sizes.some((s) => s.available)) {
          availability.available = false;
          availability.reasons.push({ code: 'SIZE_PAUSED', message: 'Todos os tamanhos pausados' });
        }

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          kind: p.kind,
          sku: p.sku,
          sectorId: p.sectorId,
          imageUrl: this.images.url(p.imageKey),
          thumbUrl: this.images.url(p.thumbKey),
          priceCents: p.priceCents,
          promoPriceCents: p.promoPriceCents,
          price: priceRange(tags),
          sizes,
          modifierGroups: isPizza
            ? []
            : resolveGroups(effectiveModifierLinks(category.modifierLinks, p.modifierLinks)),
          availability,
        };
      });

      return {
        id: category.id,
        name: category.name,
        description: category.description,
        kind: category.kind,
        sizes: category.sizes.map((s) => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          maxFlavors: s.maxFlavors,
          slices: s.slices,
          externalCode: s.externalCode,
        })),
        modifierGroups: isPizza ? resolveGroups(category.modifierLinks) : [],
        products: options.onlyAvailable
          ? products.filter((p) => p.availability.available)
          : products,
      };
    });

    return {
      channel: options.channel,
      generatedAt: now.toISOString(),
      pizzaPricingRule: store.pizzaPricingRule as PizzaPricingRule,
      categories: options.onlyAvailable ? result.filter((c) => c.products.length > 0) : result,
    };
  }
}
