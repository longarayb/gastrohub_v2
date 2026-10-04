import { Injectable } from '@nestjs/common';
import {
  type CatalogCategory,
  type CatalogDto,
  type CatalogGroup,
  type CatalogProduct,
  type MenuItemPricing,
  type ModifierGroupRule,
  type OrderItemData,
  type PricedModifier,
  type SalesChannel,
  optionPriceForSize,
  priceMenuItem,
  validateModifierSelections,
} from '@app/shared';
import { DomainError, ValidationError } from '../../core/errors/domain-error.js';
import { CatalogService } from '../menu/catalog.service.js';

export interface PricedOrderItem {
  input: OrderItemData;
  pricing: MenuItemPricing;
  productId: string | null;
}

/** 422 with one pt-BR message per unavailable/invalid item. */
export class ItemsUnavailableError extends DomainError {
  constructor(messages: string[]) {
    super(messages.join(' · '), 'BUSINESS_RULE', 422, { items: messages });
  }
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

/**
 * Resolves order items against the menu of the order's sales channel and prices them.
 * Uses the same catalog the panel and the digital menu display, so availability rules
 * ("Acabou", channels, schedules, store hours on the digital menu) are identical.
 * Prices sent by clients are never used.
 */
@Injectable()
export class OrderPricingService {
  constructor(private readonly catalog: CatalogService) {}

  loadCatalog(channel: SalesChannel, enforceStoreHours: boolean): Promise<CatalogDto> {
    return this.catalog.build({ channel, enforceStoreHours });
  }

  priceItems(catalog: CatalogDto, items: OrderItemData[]): PricedOrderItem[] {
    const errors: string[] = [];
    const priced: PricedOrderItem[] = [];
    const products = new Map<string, { product: CatalogProduct; category: CatalogCategory }>();
    for (const category of catalog.categories) {
      for (const product of category.products) products.set(product.id, { product, category });
    }

    for (const item of items) {
      try {
        priced.push(
          item.pizza
            ? this.pricePizza(catalog, item)
            : this.priceProduct(products.get(item.productId ?? ''), item),
        );
      } catch (error) {
        if (error instanceof RangeError || error instanceof ValidationError) {
          errors.push(error.message);
        } else {
          throw error;
        }
      }
    }
    if (errors.length) throw new ItemsUnavailableError(errors);
    return priced;
  }

  private modifiers(
    label: string,
    groups: CatalogGroup[],
    item: OrderItemData,
    sizeId: string | null,
  ): PricedModifier[] {
    const problems = validateModifierSelections(groupRules(groups), item.modifiers);
    if (problems.length) throw new ValidationError(`${label}: ${problems[0]}`);

    return item.modifiers.map((selection) => {
      const group = groups.find((g) => g.groupId === selection.groupId)!;
      const option = group.options.find((o) => o.id === selection.optionId)!;
      if (!option.available) throw new ValidationError(`${label}: "${option.name}" esgotado`);
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

  private priceProduct(
    found: { product: CatalogProduct; category: CatalogCategory } | undefined,
    item: OrderItemData,
  ): PricedOrderItem {
    if (!found) throw new ValidationError('Produto não encontrado no cardápio deste canal');
    const { product, category } = found;
    if (category.kind === 'PIZZA') {
      throw new ValidationError(`${product.name}: escolha o tamanho e os sabores da pizza`);
    }
    if (!product.availability.available) {
      throw new ValidationError(`${product.name}: ${product.availability.reasons[0]?.message}`);
    }

    let size: CatalogProduct['sizes'][number] | null = null;
    if (product.kind === 'SIZED') {
      size = product.sizes.find((s) => s.id === item.sizeId) ?? null;
      if (!size) throw new ValidationError(`${product.name}: escolha o tamanho`);
      if (!size.available || size.priceCents == null) {
        throw new ValidationError(`${product.name} ${size.name}: tamanho indisponível`);
      }
    }

    const modifiers = this.modifiers(product.name, product.modifierGroups, item, size?.id ?? null);
    const pricing = priceMenuItem({
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
    return { input: item, pricing, productId: product.id };
  }

  private pricePizza(catalog: CatalogDto, item: OrderItemData): PricedOrderItem {
    const pizza = item.pizza!;
    const category = catalog.categories.find(
      (c) => c.id === pizza.categoryId && c.kind === 'PIZZA',
    );
    if (!category) throw new ValidationError('Categoria de pizza não encontrada');
    const size = category.sizes.find((s) => s.id === pizza.sizeId);
    if (!size) throw new ValidationError(`${category.name}: escolha o tamanho`);
    const label = `${category.name} ${size.name}`;

    const flavors = pizza.flavors.map((f) => {
      const product = category.products.find((p) => p.id === f.productId);
      if (!product) throw new ValidationError(`${label}: sabor não encontrado`);
      if (!product.availability.available) {
        throw new ValidationError(`${product.name}: ${product.availability.reasons[0]?.message}`);
      }
      const price = product.sizes.find((s) => s.id === size.id);
      if (!price || !price.available || price.priceCents == null) {
        throw new ValidationError(`${product.name}: indisponível no tamanho ${size.name}`);
      }
      return {
        product: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          sectorId: product.sectorId,
        },
        priceCents: price.priceCents,
        promoPriceCents: price.promoPriceCents,
        note: f.note,
      };
    });

    const modifiers = this.modifiers(label, category.modifierGroups, item, size.id);
    const pricing = priceMenuItem({
      kind: 'PIZZA',
      category: { id: category.id, name: category.name },
      size: { id: size.id, name: size.name, maxFlavors: size.maxFlavors },
      flavors,
      rule: catalog.pizzaPricingRule,
      modifiers,
      quantity: item.quantity,
      note: item.notes,
    });
    return { input: item, pricing, productId: null };
  }
}
