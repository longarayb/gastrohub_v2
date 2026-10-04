import { describe, expect, it } from 'vitest';
import {
  effectiveModifierLinks,
  optionPriceForSize,
  validateLinkLimits,
} from './menu-modifiers.js';
import {
  type ModifierGroupRule,
  chargedPrice,
  combinePizzaPrices,
  priceMenuItem,
  validateModifierSelections,
} from './menu-pricing.js';

const product = (id: string, name: string, sectorId = 'kitchen') => ({ id, name, sectorId });

describe('chargedPrice', () => {
  it('uses the promo only when lower than the full price', () => {
    expect(chargedPrice({ priceCents: 3000, promoPriceCents: 2500 })).toBe(2500);
    expect(chargedPrice({ priceCents: 3000, promoPriceCents: 3500 })).toBe(3000);
    expect(chargedPrice({ priceCents: 3000, promoPriceCents: null })).toBe(3000);
    expect(chargedPrice({ priceCents: 3000, promoPriceCents: 0 })).toBe(0);
  });
});

describe('combinePizzaPrices', () => {
  it('takes the highest flavor price', () => {
    expect(combinePizzaPrices([5990, 6990], 'HIGHEST')).toBe(6990);
  });

  it('averages and rounds up to the cent', () => {
    expect(combinePizzaPrices([5990, 6990], 'AVERAGE')).toBe(6490);
    expect(combinePizzaPrices([1000, 1000, 1001], 'AVERAGE')).toBe(1001); // 1000.33 → 1001
  });

  it('requires at least one flavor', () => {
    expect(() => combinePizzaPrices([], 'HIGHEST')).toThrow(RangeError);
  });
});

describe('priceMenuItem — standard and sized', () => {
  it('prices a burger with modifiers and quantity', () => {
    const r = priceMenuItem({
      kind: 'STANDARD',
      product: { id: 'p1', name: 'X-Burger', sku: '101', sectorId: 'kitchen' },
      categoryId: 'c1',
      priceCents: 2890,
      modifiers: [
        {
          groupId: 'g1',
          groupName: 'Ponto da carne',
          optionId: 'o1',
          name: 'Ao ponto',
          quantity: 1,
          unitPriceCents: 0,
        },
        {
          groupId: 'g2',
          groupName: 'Adicionais',
          optionId: 'o2',
          name: 'Bacon',
          quantity: 2,
          unitPriceCents: 450,
        },
      ],
      quantity: 3,
      note: '  sem cebola ',
    });
    expect(r.unitChargedPriceCents).toBe(2890 + 900);
    expect(r.totalChargedCents).toBe((2890 + 900) * 3);
    expect(r.promoDiscountCents).toBe(0);
    expect(r.snapshot).toMatchObject({
      kind: 'STANDARD',
      name: 'X-Burger',
      sku: '101',
      sectorId: 'kitchen',
      note: 'sem cebola',
      modifiers: [
        { name: 'Ao ponto', totalCents: 0, sectorId: 'kitchen' },
        { name: 'Bacon', quantity: 2, unitPriceCents: 450, totalCents: 900 },
      ],
    });
  });

  it('keeps full and charged prices when there is a promotion', () => {
    const r = priceMenuItem({
      kind: 'STANDARD',
      product: product('p1', 'X-Salada'),
      priceCents: 3000,
      promoPriceCents: 2500,
      quantity: 2,
    });
    expect(r.snapshot.baseFullPriceCents).toBe(3000);
    expect(r.snapshot.baseChargedPriceCents).toBe(2500);
    expect(r.unitFullPriceCents).toBe(3000);
    expect(r.unitChargedPriceCents).toBe(2500);
    expect(r.promoDiscountCents).toBe(1000);
  });

  it('prices a drink by size and requires the size', () => {
    const r = priceMenuItem({
      kind: 'SIZED',
      product: product('p2', 'Refrigerante Cola', 'bar'),
      size: { id: 's2', name: '600 ml' },
      priceCents: 800,
    });
    expect(r.snapshot.name).toBe('Refrigerante Cola 600 ml');
    expect(r.snapshot.size).toEqual({ id: 's2', name: '600 ml' });
    expect(() =>
      priceMenuItem({ kind: 'SIZED', product: product('p2', 'Cola'), priceCents: 800 }),
    ).toThrow('Escolha o tamanho');
  });

  it('records combo options with the referenced product and its sector', () => {
    const r = priceMenuItem({
      kind: 'STANDARD',
      product: product('combo', 'Combo X-Burger'),
      priceCents: 3990,
      modifiers: [
        {
          groupId: 'drink',
          groupName: 'Escolha a bebida',
          optionId: 'opt-cola',
          name: 'ignored',
          quantity: 1,
          unitPriceCents: 0,
          product: { id: 'cola', name: 'Refrigerante Cola lata', sectorId: 'bar' },
        },
        {
          groupId: 'drink2',
          groupName: 'Troque a bebida',
          optionId: 'opt-juice',
          name: 'x',
          quantity: 1,
          unitPriceCents: 300,
          product: { id: 'juice', name: 'Suco natural', sectorId: 'bar' },
        },
      ],
    });
    expect(r.snapshot.modifiers[0]).toMatchObject({
      name: 'Refrigerante Cola lata',
      product: { id: 'cola', sectorId: 'bar' },
      sectorId: 'bar',
      totalCents: 0,
    });
    expect(r.unitChargedPriceCents).toBe(3990 + 300);
  });

  it('rejects invalid input', () => {
    const base = { kind: 'STANDARD' as const, product: product('p', 'P') };
    expect(() => priceMenuItem({ ...base, priceCents: -1 })).toThrow(RangeError);
    expect(() => priceMenuItem({ ...base, priceCents: 10.5 })).toThrow(RangeError);
    expect(() => priceMenuItem({ ...base, priceCents: 100, quantity: 0 })).toThrow(
      'Quantidade inválida',
    );
  });
});

describe('priceMenuItem — pizza', () => {
  const size = { id: 'g', name: 'Grande', maxFlavors: 3 };
  const category = { id: 'pz', name: 'Pizzas' };
  const calabresa = { product: product('cal', 'Calabresa', 'pizza'), priceCents: 5990 };
  const marguerita = { product: product('mar', 'Marguerita', 'pizza'), priceCents: 6490 };
  const camarao = {
    product: product('cam', 'Camarão', 'pizza'),
    priceCents: 8990,
    promoPriceCents: 7990,
  };
  const crust = {
    groupId: 'borda',
    groupName: 'Borda',
    optionId: 'cat',
    name: 'Catupiry',
    quantity: 1,
    unitPriceCents: 1200,
  };

  it('half and half with the highest-price rule, plus crust', () => {
    const r = priceMenuItem({
      kind: 'PIZZA',
      category,
      size,
      flavors: [calabresa, { ...marguerita, note: 'sem azeitona' }],
      rule: 'HIGHEST',
      modifiers: [crust],
    });
    expect(r.unitChargedPriceCents).toBe(6490 + 1200);
    expect(r.snapshot).toMatchObject({
      kind: 'PIZZA',
      name: 'Pizzas — Grande',
      productId: null,
      categoryId: 'pz',
      sectorId: 'pizza',
      pizzaPricingRule: 'HIGHEST',
      flavors: [
        { name: 'Calabresa', fraction: { numerator: 1, denominator: 2 }, note: null },
        { name: 'Marguerita', fraction: { numerator: 1, denominator: 2 }, note: 'sem azeitona' },
      ],
    });
  });

  it('average rule with a promotional flavor keeps full and charged prices', () => {
    const r = priceMenuItem({
      kind: 'PIZZA',
      category,
      size,
      flavors: [calabresa, marguerita, camarao],
      rule: 'AVERAGE',
    });
    // full: (5990 + 6490 + 8990) / 3 = 7156.67 → 7157; charged: (5990 + 6490 + 7990) / 3 = 6823.33 → 6824
    expect(r.unitFullPriceCents).toBe(7157);
    expect(r.unitChargedPriceCents).toBe(6824);
    expect(r.snapshot.flavors[2]).toMatchObject({ fullPriceCents: 8990, chargedPriceCents: 7990 });
    expect(r.promoDiscountCents).toBe(7157 - 6824);
  });

  it('enforces the number of flavors of the size and forbids repeated flavors', () => {
    const broto = { id: 'b', name: 'Broto', maxFlavors: 1 };
    expect(() =>
      priceMenuItem({
        kind: 'PIZZA',
        category,
        size: broto,
        flavors: [calabresa, marguerita],
        rule: 'HIGHEST',
      }),
    ).toThrow('O tamanho Broto permite até 1 sabores');
    expect(() =>
      priceMenuItem({
        kind: 'PIZZA',
        category,
        size,
        flavors: [calabresa, calabresa],
        rule: 'HIGHEST',
      }),
    ).toThrow('Sabor repetido na pizza');
    expect(() =>
      priceMenuItem({ kind: 'PIZZA', category, size, flavors: [], rule: 'HIGHEST' }),
    ).toThrow('Escolha pelo menos um sabor');
  });
});

describe('validateModifierSelections', () => {
  const groups: ModifierGroupRule[] = [
    {
      groupId: 'ponto',
      name: 'Ponto da carne',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { optionId: 'mal', name: 'Mal passado', maxQuantity: 1 },
        { optionId: 'bem', name: 'Bem passado', maxQuantity: 1 },
      ],
    },
    {
      groupId: 'add',
      name: 'Adicionais',
      minSelect: 0,
      maxSelect: 3,
      options: [
        { optionId: 'bacon', name: 'Bacon', maxQuantity: 2 },
        { optionId: 'ovo', name: 'Ovo', maxQuantity: 1 },
      ],
    },
  ];

  it('accepts a valid selection', () => {
    expect(
      validateModifierSelections(groups, [
        { groupId: 'ponto', optionId: 'bem', quantity: 1 },
        { groupId: 'add', optionId: 'bacon', quantity: 2 },
        { groupId: 'add', optionId: 'ovo', quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('reports required groups, limits and per-option quantities', () => {
    expect(validateModifierSelections(groups, [])).toEqual([
      'Escolha uma opção em "Ponto da carne"',
    ]);
    expect(
      validateModifierSelections(groups, [
        { groupId: 'ponto', optionId: 'mal', quantity: 1 },
        { groupId: 'ponto', optionId: 'bem', quantity: 1 },
        { groupId: 'add', optionId: 'bacon', quantity: 3 },
        { groupId: 'add', optionId: 'ovo', quantity: 1 },
      ]),
    ).toEqual([
      '"Bacon" permite no máximo 2',
      'Escolha apenas uma opção em "Ponto da carne"',
      'Escolha no máximo 3 opções em "Adicionais"',
    ]);
  });

  it('rejects options from other groups and repeated lines', () => {
    expect(
      validateModifierSelections(groups, [{ groupId: 'ponto', optionId: 'bacon', quantity: 1 }]),
    ).toContain('Complemento inválido para este produto');
    expect(
      validateModifierSelections(groups, [
        { groupId: 'ponto', optionId: 'mal', quantity: 1 },
        { groupId: 'add', optionId: 'ovo', quantity: 1 },
        { groupId: 'add', optionId: 'ovo', quantity: 1 },
      ]),
    ).toContain('Complemento repetido; ajuste a quantidade');
  });
});

describe('effectiveModifierLinks', () => {
  const category = [
    { groupId: 'add', minSelect: 0, maxSelect: 5, sortOrder: 1 },
    { groupId: 'molho', minSelect: 0, maxSelect: 2, sortOrder: 2 },
  ];

  it('inherits category groups and lets the product override or disable them', () => {
    const links = effectiveModifierLinks(category, [
      { groupId: 'ponto', minSelect: 1, maxSelect: 1, sortOrder: 0 },
      { groupId: 'add', minSelect: 0, maxSelect: 2, sortOrder: 1 },
      { groupId: 'molho', minSelect: 0, maxSelect: 1, sortOrder: 9, isDisabled: true },
    ]);
    expect(links.map((l) => [l.groupId, l.maxSelect, l.source])).toEqual([
      ['ponto', 1, 'PRODUCT'],
      ['add', 2, 'PRODUCT'],
    ]);
  });

  it('keeps category groups when the product has no links', () => {
    expect(effectiveModifierLinks(category, []).map((l) => l.source)).toEqual([
      'CATEGORY',
      'CATEGORY',
    ]);
  });
});

describe('option prices and link limits', () => {
  it('uses the price of the chosen size when defined', () => {
    const crust = { priceCents: 1000, sizePrices: [{ sizeId: 'grande', priceCents: 1400 }] };
    expect(optionPriceForSize(crust, 'grande')).toBe(1400);
    expect(optionPriceForSize(crust, 'broto')).toBe(1000);
    expect(optionPriceForSize(crust)).toBe(1000);
  });

  it('validates min/max', () => {
    expect(validateLinkLimits(0, 3)).toBeNull();
    expect(validateLinkLimits(2, 1)).toBe('O mínimo não pode ser maior que o máximo');
    expect(validateLinkLimits(0, 0)).toBe('O máximo deve ser pelo menos 1');
    expect(validateLinkLimits(-1, 1)).toBe('O mínimo não pode ser negativo');
  });
});
