import type { Availability, SalesChannel } from '../domain/menu-availability.js';
import type { PizzaPricingRule } from '../domain/menu-pricing.js';
import type { BusinessHour } from '../stores/schemas.js';

/** Response DTOs of the menu API. Dates are ISO strings. */

export type CategoryKind = 'STANDARD' | 'PIZZA';
export type ProductKind = 'STANDARD' | 'SIZED';

export interface SectorDto {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  /** KDS timer alerts (minutes since the ticket was sent). */
  warnAfterMinutes: number;
  lateAfterMinutes: number;
}

export interface ModifierLinkDto {
  groupId: string;
  groupName: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isDisabled: boolean;
}

export interface PizzaSizeDto {
  id: string;
  name: string;
  sortOrder: number;
  maxFlavors: number;
  slices: number | null;
  externalCode: string | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  kind: CategoryKind;
  sortOrder: number;
  isPaused: boolean;
  pausedUntil: string | null;
  channels: SalesChannel[];
  schedules: BusinessHour[];
  modifierLinks: ModifierLinkDto[];
  sizes: PizzaSizeDto[];
  productCount: number;
}

export interface PriceRange {
  /** Lowest charged price (promo considered). */
  fromCents: number | null;
  /** Highest charged price; equal to `fromCents` for single-price products. */
  toCents: number | null;
  hasPromo: boolean;
}

export interface ProductListItemDto {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  categoryKind: CategoryKind;
  kind: ProductKind;
  sku: string | null;
  sectorId: string | null;
  sectorName: string | null;
  thumbUrl: string | null;
  price: PriceRange;
  isPaused: boolean;
  pausedUntil: string | null;
  channels: SalesChannel[];
  sortOrder: number;
}

export interface ProductSizeDto {
  id: string;
  name: string;
  sortOrder: number;
  priceCents: number;
  promoPriceCents: number | null;
  isPaused: boolean;
  pausedUntil: string | null;
  externalCode: string | null;
}

export interface FlavorPriceDto {
  sizeId: string;
  sizeName: string;
  priceCents: number;
  promoPriceCents: number | null;
  isPaused: boolean;
  pausedUntil: string | null;
}

export interface ProductDetailDto extends ProductListItemDto {
  imageUrl: string | null;
  priceCents: number | null;
  promoPriceCents: number | null;
  externalCode: string | null;
  schedules: BusinessHour[];
  /** SIZED products: own sizes with prices. */
  sizes: ProductSizeDto[];
  /** Pizza flavors: prices for each size of the category. */
  flavorPrices: FlavorPriceDto[];
  /** Product-level links (overrides and disabled inherited groups). */
  modifierLinks: ModifierLinkDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ModifierOptionDto {
  id: string;
  /** Name as stored; for combo options see `displayName`. */
  name: string;
  /** Name shown to customers (referenced product name for combo options). */
  displayName: string;
  priceCents: number;
  maxQuantity: number;
  sortOrder: number;
  productId: string | null;
  isPaused: boolean;
  pausedUntil: string | null;
  sku: string | null;
  externalCode: string | null;
  sizePrices: { sizeId: string; priceCents: number }[];
}

export interface ModifierGroupDto {
  id: string;
  name: string;
  description: string | null;
  options: ModifierOptionDto[];
  usage: { categories: number; products: number };
}

// ---- Catalog: fully resolved menu (preview, POS, digital menu) ----

export interface CatalogOption {
  id: string;
  name: string;
  priceCents: number;
  /** Price per size (crusts etc.). */
  sizePrices: { sizeId: string; priceCents: number }[];
  maxQuantity: number;
  available: boolean;
  product: { id: string; name: string; sectorId: string | null } | null;
}

export interface CatalogGroup {
  groupId: string;
  name: string;
  description: string | null;
  minSelect: number;
  maxSelect: number;
  options: CatalogOption[];
}

export interface CatalogSize {
  id: string;
  name: string;
  maxFlavors: number;
  slices: number | null;
  priceCents: number | null;
  promoPriceCents: number | null;
  available: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  kind: ProductKind;
  sku: string | null;
  sectorId: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  priceCents: number | null;
  promoPriceCents: number | null;
  price: PriceRange;
  /** SIZED: own sizes. Pizza flavors: category sizes with this flavor's prices. */
  sizes: CatalogSize[];
  /** Effective groups (category + product, overrides applied). Pizza: category groups. */
  modifierGroups: CatalogGroup[];
  availability: Availability;
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string | null;
  kind: CategoryKind;
  /** Pizza categories: sizes with max flavors. */
  sizes: PizzaSizeDto[];
  /** Pizza categories: groups applied once per pizza (crust...). */
  modifierGroups: CatalogGroup[];
  products: CatalogProduct[];
}

export interface CatalogDto {
  channel: SalesChannel;
  generatedAt: string;
  pizzaPricingRule: PizzaPricingRule;
  categories: CatalogCategory[];
}
