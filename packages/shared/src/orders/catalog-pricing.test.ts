import { describe, expect, it } from 'vitest';
import type { CatalogDto, CatalogGroup, CatalogProduct } from '../menu/types.js';
import { ItemPricingError, indexCatalog, priceCatalogItem } from './catalog-pricing.js';
import { type OrderItemInput, orderItemInputSchema } from './schemas.js';

const available = { available: true, reasons: [] };

const point: CatalogGroup = {
  groupId: 'g-point',
  name: 'Ponto',
  description: null,
  minSelect: 1,
  maxSelect: 1,
  options: [
    {
      id: 'o-rare',
      name: 'Mal passado',
      priceCents: 0,
      sizePrices: [],
      maxQuantity: 1,
      available: true,
      product: null,
    },
    {
      id: 'o-well',
      name: 'Bem passado',
      priceCents: 0,
      sizePrices: [],
      maxQuantity: 1,
      available: false,
      product: null,
    },
  ],
};

const product = (p: Partial<CatalogProduct> & { id: string; name: string }): CatalogProduct => ({
  description: null,
  kind: 'STANDARD',
  sku: null,
  sectorId: null,
  imageUrl: null,
  thumbUrl: null,
  priceCents: null,
  promoPriceCents: null,
  price: { minCents: 0, maxCents: 0, fromPromo: false } as never,
  sizes: [],
  modifierGroups: [],
  availability: available,
  ...p,
});

const crust: CatalogGroup = {
  groupId: 'g-crust',
  name: 'Borda',
  description: null,
  minSelect: 0,
  maxSelect: 1,
  options: [
    {
      id: 'o-cheddar',
      name: 'Cheddar',
      priceCents: 800,
      sizePrices: [{ sizeId: 's-big', priceCents: 1200 }],
      maxQuantity: 1,
      available: true,
      product: null,
    },
  ],
};

const pizzaSize = (id: string, priceCents: number) => ({
  id,
  name: 'Grande',
  maxFlavors: 2,
  slices: 8,
  priceCents,
  promoPriceCents: null,
  available: true,
});

const catalog: CatalogDto = {
  channel: 'COUNTER',
  generatedAt: '2026-10-04T12:00:00.000Z',
  pizzaPricingRule: 'HIGHEST',
  categories: [
    {
      id: 'c-burgers',
      name: 'Lanches',
      description: null,
      kind: 'STANDARD',
      sizes: [],
      modifierGroups: [],
      products: [
        product({
          id: 'p-burger',
          name: 'X-Burguer',
          priceCents: 3000,
          promoPriceCents: 2500,
          modifierGroups: [point],
        }),
        product({
          id: 'p-soda',
          name: 'Refrigerante',
          priceCents: 700,
          availability: {
            available: false,
            reasons: [{ code: 'PAUSED', message: 'Acabou' }] as never,
          },
        }),
      ],
    },
    {
      id: 'c-pizza',
      name: 'Pizzas',
      description: null,
      kind: 'PIZZA',
      sizes: [
        { id: 's-big', name: 'Grande', sortOrder: 0, maxFlavors: 2, slices: 8, externalCode: null },
      ],
      modifierGroups: [crust],
      products: [
        product({
          id: 'p-mozza',
          name: 'Mussarela',
          kind: 'SIZED',
          sizes: [pizzaSize('s-big', 5000)],
        }),
        product({
          id: 'p-cal',
          name: 'Calabresa',
          kind: 'SIZED',
          sizes: [pizzaSize('s-big', 6000)],
        }),
      ],
    },
  ],
};

const index = indexCatalog(catalog);
const price = (item: OrderItemInput) => priceCatalogItem(index, orderItemInputSchema.parse(item));

describe('priceCatalogItem', () => {
  it('prices a product with the catalog promo price and its modifiers', () => {
    const result = price({
      productId: 'p-burger',
      quantity: 2,
      modifiers: [{ groupId: 'g-point', optionId: 'o-rare' }],
    });
    expect(result.unitChargedPriceCents).toBe(2500);
    expect(result.totalChargedCents).toBe(5000);
    expect(result.promoDiscountCents).toBe(1000);
    expect(result.snapshot.modifiers[0]?.name).toBe('Mal passado');
  });

  it('requires mandatory modifier groups', () => {
    expect(() => price({ productId: 'p-burger', quantity: 1 })).toThrow(ItemPricingError);
    expect(() => price({ productId: 'p-burger', quantity: 1 })).toThrow(/X-Burguer: .*Ponto/);
  });

  it('rejects unavailable products and options', () => {
    expect(() => price({ productId: 'p-soda', quantity: 1 })).toThrow('Refrigerante: Acabou');
    expect(() =>
      price({
        productId: 'p-burger',
        quantity: 1,
        modifiers: [{ groupId: 'g-point', optionId: 'o-well' }],
      }),
    ).toThrow('"Bem passado" esgotado');
    expect(() => price({ productId: 'unknown', quantity: 1 })).toThrow(/não encontrado/);
  });

  it('asks for size and flavors when a pizza flavor is ordered as a product', () => {
    expect(() => price({ productId: 'p-mozza', quantity: 1 })).toThrow(/tamanho e os sabores/);
  });

  it('prices a half-and-half pizza by the highest flavor plus the crust for the size', () => {
    const result = price({
      pizza: {
        categoryId: 'c-pizza',
        sizeId: 's-big',
        flavors: [{ productId: 'p-mozza' }, { productId: 'p-cal' }],
      },
      quantity: 1,
      modifiers: [{ groupId: 'g-crust', optionId: 'o-cheddar' }],
    });
    expect(result.unitChargedPriceCents).toBe(6000 + 1200);
    expect(result.snapshot.flavors).toHaveLength(2);
  });
});
