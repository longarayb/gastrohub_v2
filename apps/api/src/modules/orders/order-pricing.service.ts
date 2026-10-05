import { Injectable } from '@nestjs/common';
import {
  type CatalogDto,
  ItemPricingError,
  type MenuItemPricing,
  type OrderItemData,
  type SalesChannel,
  indexCatalog,
  priceCatalogItem,
} from '@app/shared';
import { DomainError } from '../../core/errors/domain-error.js';
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
    const index = indexCatalog(catalog);
    const errors: string[] = [];
    const priced: PricedOrderItem[] = [];
    for (const item of items) {
      try {
        const pricing = priceCatalogItem(index, item);
        priced.push({ input: item, pricing, productId: item.pizza ? null : item.productId! });
      } catch (error) {
        if (error instanceof ItemPricingError || error instanceof RangeError) {
          errors.push(error.message);
        } else {
          throw error;
        }
      }
    }
    if (errors.length) throw new ItemsUnavailableError(errors);
    return priced;
  }
}
