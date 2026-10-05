import {
  type MenuItemPricing,
  type ModifierGroupRule,
  type PricedModifier,
  priceMenuItem,
  validateModifierSelections,
} from '../domain/menu-pricing.js';
import { optionPriceForSize } from '../domain/menu-modifiers.js';
import type { CatalogCategory, CatalogDto, CatalogGroup, CatalogProduct } from '../menu/types.js';
import type { OrderItemData } from './schemas.js';

/**
 * Resolves order items against a resolved catalog (the menu of one sales channel) and prices
 * them. Shared by the API (authoritative) and the panel (live totals while typing the order),
 * so availability rules and prices are identical on both sides.
 */

/** An item that cannot be ordered as requested; message in pt-BR, ready for the user. */
export class ItemPricingError extends Error {
  override name = 'ItemPricingError';
}

export interface CatalogIndex {
  catalog: CatalogDto;
  products: Map<string, { product: CatalogProduct; category: CatalogCategory }>;
}

export function indexCatalog(catalog: CatalogDto): CatalogIndex {
  const products = new Map<string, { product: CatalogProduct; category: CatalogCategory }>();
  for (const category of catalog.categories) {
    for (const product of category.products) products.set(product.id, { product, category });
  }
  return { catalog, products };
}

function groupRules(groups: CatalogGroup[]): ModifierGroupRule[] {
  return groups.map((g) => ({
    groupId: g.groupId,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    options: g.options.map((o) => ({ optionId: o.id, name: o.name, maxQuantity: o.maxQuantity })),
  }));
}

function pricedModifiers(
  label: string,
  groups: CatalogGroup[],
  item: OrderItemData,
  sizeId: string | null,
): PricedModifier[] {
  const problems = validateModifierSelections(groupRules(groups), item.modifiers);
  if (problems.length) throw new ItemPricingError(`${label}: ${problems[0]}`);

  return item.modifiers.map((selection) => {
    const group = groups.find((g) => g.groupId === selection.groupId)!;
    const option = group.options.find((o) => o.id === selection.optionId)!;
    if (!option.available) throw new ItemPricingError(`${label}: "${option.name}" esgotado`);
    return {
      groupId: group.groupId,
      groupName: group.name,
      optionId: option.id,
      name: option.name,
      quantity: selection.quantity,
      unitPriceCents: optionPriceForSize(option, sizeId),
      product: option.product,
      sectorId: option.product?.sectorId ?? null,
    };
  });
}

function priceProduct(index: CatalogIndex, item: OrderItemData): MenuItemPricing {
  const found = index.products.get(item.productId ?? '');
  if (!found) throw new ItemPricingError('Produto não encontrado no cardápio deste canal');
  const { product, category } = found;
  if (category.kind === 'PIZZA') {
    throw new ItemPricingError(`${product.name}: escolha o tamanho e os sabores da pizza`);
  }
  if (!product.availability.available) {
    throw new ItemPricingError(`${product.name}: ${product.availability.reasons[0]?.message}`);
  }

  let size: CatalogProduct['sizes'][number] | null = null;
  if (product.kind === 'SIZED') {
    size = product.sizes.find((s) => s.id === item.sizeId) ?? null;
    if (!size) throw new ItemPricingError(`${product.name}: escolha o tamanho`);
    if (!size.available || size.priceCents == null) {
      throw new ItemPricingError(`${product.name} ${size.name}: tamanho indisponível`);
    }
  }

  const modifiers = pricedModifiers(product.name, product.modifierGroups, item, size?.id ?? null);
  return priceMenuItem({
    kind: product.kind,
    product: { id: product.id, name: product.name, sku: product.sku, sectorId: product.sectorId },
    categoryId: category.id,
    size: size ? { id: size.id, name: size.name } : null,
    priceCents: size ? size.priceCents! : product.priceCents!,
    promoPriceCents: size ? size.promoPriceCents : product.promoPriceCents,
    modifiers,
    quantity: item.quantity,
    note: item.notes,
  });
}

function pricePizza(index: CatalogIndex, item: OrderItemData): MenuItemPricing {
  const pizza = item.pizza!;
  const category = index.catalog.categories.find(
    (c) => c.id === pizza.categoryId && c.kind === 'PIZZA',
  );
  if (!category) throw new ItemPricingError('Categoria de pizza não encontrada');
  const size = category.sizes.find((s) => s.id === pizza.sizeId);
  if (!size) throw new ItemPricingError(`${category.name}: escolha o tamanho`);
  const label = `${category.name} ${size.name}`;

  const flavors = pizza.flavors.map((f) => {
    const product = category.products.find((p) => p.id === f.productId);
    if (!product) throw new ItemPricingError(`${label}: sabor não encontrado`);
    if (!product.availability.available) {
      throw new ItemPricingError(`${product.name}: ${product.availability.reasons[0]?.message}`);
    }
    const price = product.sizes.find((s) => s.id === size.id);
    if (!price || !price.available || price.priceCents == null) {
      throw new ItemPricingError(`${product.name}: indisponível no tamanho ${size.name}`);
    }
    return {
      product: { id: product.id, name: product.name, sku: product.sku, sectorId: product.sectorId },
      priceCents: price.priceCents,
      promoPriceCents: price.promoPriceCents,
      note: f.note,
    };
  });

  const modifiers = pricedModifiers(label, category.modifierGroups, item, size.id);
  return priceMenuItem({
    kind: 'PIZZA',
    category: { id: category.id, name: category.name },
    size: { id: size.id, name: size.name, maxFlavors: size.maxFlavors },
    flavors,
    rule: index.catalog.pizzaPricingRule,
    modifiers,
    quantity: item.quantity,
    note: item.notes,
  });
}

/**
 * Prices one item. Throws ItemPricingError (unavailable, missing choice) or RangeError
 * (invalid quantity/flavor count) with a pt-BR message.
 */
export function priceCatalogItem(index: CatalogIndex, item: OrderItemData): MenuItemPricing {
  return item.pizza ? pricePizza(index, item) : priceProduct(index, item);
}
