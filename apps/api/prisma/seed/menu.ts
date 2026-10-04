import { normalizeSearch } from '@app/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Realistic demo menu: burgers with inherited complements, a combo, sized portions,
 * half-and-half pizzas with crusts priced by size, sized drinks and desserts.
 * All rows carry tenantId explicitly (the seed uses the raw client).
 */

type Channel = 'DINE_IN' | 'COUNTER' | 'DELIVERY' | 'DIGITAL_MENU';
const R = (reais: number) => Math.round(reais * 100);

interface OptionSeed {
  name: string;
  price?: number;
  maxQuantity?: number;
  /** Combo option: name of a product created earlier. */
  product?: string;
  /** Price per pizza size name. */
  bySize?: Record<string, number>;
}

interface ProductSeed {
  name: string;
  description?: string;
  sku?: string;
  price?: number;
  promo?: number;
  /** SIZED products: [size name, price, promo?] */
  sizes?: [string, number, number?][];
  /** Pizza flavors: price per category size name. */
  flavor?: Record<string, number>;
  flavorPromo?: Record<string, number>;
  sector?: string;
  links?: { group: string; min?: number; max?: number; disabled?: boolean }[];
  channels?: Channel[];
  paused?: boolean;
}

export async function seedMenu(prisma: PrismaClient, tenantId: string) {
  const counts = { categories: 0, products: 0, groups: 0 };

  // ---- Sectors ----
  const sectors: Record<string, string> = {};
  for (const [index, name] of ['Cozinha', 'Bar', 'Pizzaria'].entries()) {
    const sector = await prisma.productionSector.create({
      data: { tenantId, name, sortOrder: index, isDefault: index === 0 },
    });
    sectors[name] = sector.id;
  }

  const products: Record<string, string> = {};
  const groups: Record<string, string> = {};
  const pizzaSizes: Record<string, string> = {};

  async function group(name: string, options: OptionSeed[], description?: string) {
    const g = await prisma.modifierGroup.create({ data: { tenantId, name, description } });
    for (const [sortOrder, o] of options.entries()) {
      const option = await prisma.modifierOption.create({
        data: {
          tenantId,
          groupId: g.id,
          name: o.name,
          priceCents: R(o.price ?? 0),
          maxQuantity: o.maxQuantity ?? 1,
          productId: o.product ? products[o.product] : null,
          sortOrder,
        },
      });
      for (const [sizeName, price] of Object.entries(o.bySize ?? {})) {
        await prisma.modifierOptionSizePrice.create({
          data: {
            tenantId,
            optionId: option.id,
            sizeId: pizzaSizes[sizeName]!,
            priceCents: R(price),
          },
        });
      }
    }
    groups[name] = g.id;
    counts.groups++;
  }

  let categoryOrder = 0;
  async function category(
    name: string,
    opts: {
      kind?: 'STANDARD' | 'PIZZA';
      description?: string;
      links?: { group: string; min?: number; max?: number }[];
      channels?: Channel[];
      schedules?: { weekday: number; opensAt: string; closesAt: string }[];
      sizes?: [string, number, number][]; // pizza: name, maxFlavors, slices
    } = {},
  ) {
    const c = await prisma.category.create({
      data: {
        tenantId,
        name,
        description: opts.description,
        kind: opts.kind ?? 'STANDARD',
        sortOrder: categoryOrder++,
        ...(opts.channels && { channels: opts.channels }),
      },
    });
    for (const [sortOrder, [sizeName, maxFlavors, slices]] of (opts.sizes ?? []).entries()) {
      const size = await prisma.size.create({
        data: { tenantId, categoryId: c.id, name: sizeName, maxFlavors, slices, sortOrder },
      });
      pizzaSizes[sizeName] = size.id;
    }
    for (const s of opts.schedules ?? []) {
      await prisma.availabilitySchedule.create({ data: { tenantId, categoryId: c.id, ...s } });
    }
    counts.categories++;
    return {
      id: c.id,
      links: opts.links ?? [],
    };
  }

  async function linkGroups(
    owner: { categoryId?: string; productId?: string },
    links: { group: string; min?: number; max?: number; disabled?: boolean }[],
  ) {
    for (const [sortOrder, l] of links.entries()) {
      await prisma.modifierGroupLink.create({
        data: {
          tenantId,
          ...owner,
          groupId: groups[l.group]!,
          minSelect: l.min ?? 0,
          maxSelect: l.max ?? 1,
          isDisabled: l.disabled ?? false,
          sortOrder,
        },
      });
    }
  }

  async function addProducts(categoryId: string, items: ProductSeed[], defaultSector = 'Cozinha') {
    for (const [sortOrder, p] of items.entries()) {
      const product = await prisma.product.create({
        data: {
          tenantId,
          categoryId,
          kind: p.sizes ? 'SIZED' : 'STANDARD',
          name: p.name,
          description: p.description,
          sku: p.sku,
          priceCents: p.price != null ? R(p.price) : null,
          promoPriceCents: p.promo != null ? R(p.promo) : null,
          sectorId: sectors[p.sector ?? defaultSector],
          sortOrder,
          isPaused: p.paused ?? false,
          ...(p.channels && { channels: p.channels }),
          searchText: normalizeSearch([p.name, p.sku, p.description].filter(Boolean).join(' ')),
        },
      });
      products[p.name] = product.id;
      counts.products++;

      for (const [index, [sizeName, price, promo]] of (p.sizes ?? []).entries()) {
        const size = await prisma.size.create({
          data: { tenantId, productId: product.id, name: sizeName, sortOrder: index },
        });
        await prisma.productSizePrice.create({
          data: {
            tenantId,
            productId: product.id,
            sizeId: size.id,
            priceCents: R(price),
            promoPriceCents: promo != null ? R(promo) : null,
          },
        });
      }
      for (const [sizeName, price] of Object.entries(p.flavor ?? {})) {
        const promo = p.flavorPromo?.[sizeName];
        await prisma.productSizePrice.create({
          data: {
            tenantId,
            productId: product.id,
            sizeId: pizzaSizes[sizeName]!,
            priceCents: R(price),
            promoPriceCents: promo != null ? R(promo) : null,
          },
        });
      }
      if (p.links) await linkGroups({ productId: product.id }, p.links);
    }
  }

  // ---- Reusable complement groups (pizza crust is created after the pizza sizes) ----
  await group('Ponto da carne', [
    { name: 'Mal passado' },
    { name: 'Ao ponto' },
    { name: 'Bem passado' },
  ]);
  await group('Adicionais', [
    { name: 'Bacon', price: 5, maxQuantity: 2 },
    { name: 'Ovo', price: 3 },
    { name: 'Queijo extra', price: 4, maxQuantity: 2 },
    { name: 'Cebola caramelizada', price: 4 },
    { name: 'Hambúrguer extra 160 g', price: 12 },
  ]);
  await group('Molhos', [
    { name: 'Maionese da casa' },
    { name: 'Barbecue', price: 2 },
    { name: 'Mostarda e mel', price: 2 },
  ]);
  await group('Coberturas', [
    { name: 'Calda de chocolate', price: 3 },
    { name: 'Leite condensado', price: 3 },
    { name: 'Granola', price: 2 },
    { name: 'Morango', price: 4 },
  ]);

  // ---- Drinks first (combo options reference them) ----
  const bebidas = await category('Bebidas');
  await addProducts(
    bebidas.id,
    [
      {
        name: 'Refrigerante cola',
        sku: '501',
        sizes: [
          ['Lata 350 ml', 7],
          ['600 ml', 9.5],
          ['2 L', 16, 14],
        ],
      },
      {
        name: 'Guaraná',
        sku: '502',
        sizes: [
          ['Lata 350 ml', 7],
          ['2 L', 15],
        ],
      },
      { name: 'Refrigerante cola lata', sku: '503', price: 7 },
      { name: 'Guaraná lata', sku: '504', price: 7 },
      { name: 'Água mineral 500 ml', sku: '505', price: 5 },
      {
        name: 'Suco natural',
        description: 'Laranja, limão, abacaxi com hortelã ou maracujá',
        sku: '506',
        sizes: [
          ['300 ml', 9],
          ['500 ml', 13],
        ],
      },
      { name: 'Cerveja long neck', sku: '507', price: 12, channels: ['DINE_IN', 'COUNTER'] },
      { name: 'Chope 300 ml', sku: '508', price: 11, channels: ['DINE_IN', 'COUNTER'] },
    ],
    'Bar',
  );
  await group(
    'Escolha a bebida',
    [
      { name: 'Refrigerante cola lata', product: 'Refrigerante cola lata' },
      { name: 'Guaraná lata', product: 'Guaraná lata' },
      { name: 'Suco natural 300 ml (+ R$ 3)', price: 3 },
    ],
    'Bebida inclusa no combo',
  );

  // ---- Burgers (category groups inherited by every product) ----
  const lanches = await category('Lanches', {
    description: 'Pão brioche, hambúrguer artesanal de 160 g',
    links: [
      { group: 'Adicionais', max: 5 },
      { group: 'Molhos', max: 2 },
    ],
  });
  await linkGroups({ categoryId: lanches.id }, lanches.links);
  const ponto = { group: 'Ponto da carne', min: 1, max: 1 };
  await addProducts(lanches.id, [
    {
      name: 'X-Burguer',
      description: 'Hambúrguer, queijo prato e maionese da casa',
      sku: '101',
      price: 29.9,
      links: [ponto],
    },
    {
      name: 'X-Salada',
      description: 'Hambúrguer, queijo, alface, tomate e cebola roxa',
      sku: '102',
      price: 32.9,
      links: [ponto],
    },
    {
      name: 'X-Bacon',
      description: 'Hambúrguer, queijo, bacon crocante e barbecue',
      sku: '103',
      price: 36.9,
      promo: 32.9,
      links: [ponto],
    },
    {
      name: 'X-Tudo',
      description: 'Dois hambúrgueres, bacon, ovo, queijo, salada',
      sku: '104',
      price: 44.9,
      links: [ponto, { group: 'Adicionais', max: 2 }],
    },
    {
      name: 'Burger vegetariano',
      description: 'Hambúrguer de grão-de-bico, queijo e salada',
      sku: '105',
      price: 31.9,
      // Turns off the inherited "Adicionais" (meat options) for this product.
      links: [{ group: 'Adicionais', disabled: true }],
    },
    {
      name: 'Cachorro-quente',
      description: 'Salsicha, purê, vinagrete e batata palha',
      sku: '106',
      price: 19.9,
    },
  ]);

  const combos = await category('Combos', { description: 'Lanche + batata + bebida' });
  await addProducts(combos.id, [
    {
      name: 'Combo X-Burguer',
      description: 'X-Burguer, batata frita média e bebida',
      sku: '201',
      price: 42.9,
      links: [ponto, { group: 'Escolha a bebida', min: 1, max: 1 }],
    },
    {
      name: 'Combo X-Bacon',
      description: 'X-Bacon, batata frita média e bebida',
      sku: '202',
      price: 48.9,
      links: [ponto, { group: 'Escolha a bebida', min: 1, max: 1 }],
    },
  ]);

  const porcoes = await category('Porções');
  await addProducts(porcoes.id, [
    {
      name: 'Batata frita',
      sku: '301',
      sizes: [
        ['Meia', 19],
        ['Inteira', 32],
      ],
      links: [{ group: 'Molhos', max: 2 }],
    },
    { name: 'Onion rings', sku: '302', price: 26, paused: true },
    { name: 'Frango à passarinho', sku: '303', price: 42 },
  ]);

  // ---- Pizzas (sizes shared by flavors; crust priced by size, linked to the category) ----
  const pizzas = await category('Pizzas', {
    kind: 'PIZZA',
    description: 'Monte meio a meio ou até 4 sabores na família',
    sizes: [
      ['Broto', 1, 4],
      ['Média', 2, 6],
      ['Grande', 3, 8],
      ['Família', 4, 12],
    ],
  });
  await group(
    'Borda',
    [
      { name: 'Catupiry', price: 10, bySize: { Broto: 6, Média: 8, Grande: 10, Família: 14 } },
      { name: 'Cheddar', price: 10, bySize: { Broto: 6, Média: 8, Grande: 10, Família: 14 } },
      { name: 'Chocolate', price: 12, bySize: { Broto: 7, Média: 9, Grande: 12, Família: 16 } },
    ],
    'Borda recheada (opcional)',
  );
  await linkGroups({ categoryId: pizzas.id }, [{ group: 'Borda', min: 0, max: 1 }]);
  const flavor = (b: number, m: number, g: number, f: number) => ({
    Broto: b,
    Média: m,
    Grande: g,
    Família: f,
  });
  await addProducts(
    pizzas.id,
    [
      {
        name: 'Calabresa',
        description: 'Calabresa, cebola e azeitonas',
        sku: '401',
        flavor: flavor(35, 52, 62, 78),
      },
      {
        name: 'Marguerita',
        description: 'Muçarela, tomate e manjericão',
        sku: '402',
        flavor: flavor(36, 54, 64, 80),
      },
      {
        name: 'Portuguesa',
        description: 'Presunto, ovos, cebola, ervilha e azeitonas',
        sku: '403',
        flavor: flavor(38, 56, 68, 84),
      },
      { name: 'Frango com catupiry', sku: '404', flavor: flavor(38, 57, 69, 86) },
      {
        name: 'Quatro queijos',
        description: 'Muçarela, provolone, parmesão e gorgonzola',
        sku: '405',
        flavor: flavor(40, 59, 72, 89),
      },
      {
        name: 'Camarão',
        description: 'Camarão ao alho com catupiry',
        sku: '406',
        flavor: flavor(49, 72, 89, 109),
        flavorPromo: { Grande: 79, Família: 99 },
      },
      {
        name: 'Chocolate com morango',
        description: 'Pizza doce',
        sku: '407',
        flavor: flavor(39, 56, 66, 82),
      },
    ],
    'Pizzaria',
  );

  const sobremesas = await category('Sobremesas', { links: [{ group: 'Coberturas', max: 3 }] });
  await linkGroups({ categoryId: sobremesas.id }, sobremesas.links);
  await addProducts(sobremesas.id, [
    {
      name: 'Pudim de leite',
      sku: '601',
      price: 14,
      links: [{ group: 'Coberturas', disabled: true }],
    },
    { name: 'Brownie com sorvete', sku: '602', price: 22 },
    {
      name: 'Açaí',
      sku: '603',
      sizes: [
        ['300 ml', 16],
        ['500 ml', 22],
      ],
    },
  ]);

  // ---- Executive lunch: dine-in/counter only, weekdays 11:00–15:00 ----
  const almoco = await category('Almoço executivo', {
    description: 'Arroz, feijão, salada e guarnição do dia',
    channels: ['DINE_IN', 'COUNTER'],
    schedules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '11:00', closesAt: '15:00' })),
  });
  await addProducts(almoco.id, [
    { name: 'Executivo de frango grelhado', sku: '701', price: 34.9 },
    { name: 'Executivo de bife acebolado', sku: '702', price: 38.9 },
  ]);

  return counts;
}
