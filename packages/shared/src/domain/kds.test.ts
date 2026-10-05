import { describe, expect, it } from 'vitest';
import {
  consolidate,
  deriveItemStatus,
  isRemoval,
  kitchenTransitions,
  noteParts,
  routeItem,
  scaleTaskQuantity,
  sectorLimitsError,
  timerLevel,
} from './kds.js';
import type { MenuItemSnapshot, SnapshotModifier } from './menu-pricing.js';

const KITCHEN = 'sector-kitchen';
const BAR = 'sector-bar';

const modifier = (extra: Partial<SnapshotModifier>): SnapshotModifier => ({
  groupId: 'g',
  groupName: 'Grupo',
  optionId: 'o',
  name: 'Opção',
  quantity: 1,
  unitPriceCents: 0,
  totalCents: 0,
  product: null,
  sectorId: null,
  ...extra,
});

const snapshot = (extra: Partial<MenuItemSnapshot> = {}): MenuItemSnapshot =>
  ({
    version: 1,
    kind: 'STANDARD',
    name: 'Combo X-Burguer',
    productId: 'p1',
    categoryId: 'c1',
    sku: null,
    sectorId: KITCHEN,
    size: null,
    flavors: [],
    pizzaPricingRule: null,
    baseFullPriceCents: 3000,
    baseChargedPriceCents: 3000,
    modifiers: [],
    unitFullPriceCents: 3000,
    unitChargedPriceCents: 3000,
    note: null,
    ...extra,
  }) as MenuItemSnapshot;

describe('routeItem', () => {
  it('sends a combo drink of another sector to that sector', () => {
    const tasks = routeItem(
      snapshot({
        modifiers: [
          modifier({ name: 'Ao ponto', groupName: 'Ponto da carne' }),
          modifier({
            name: 'Guaraná lata',
            product: { id: 'p2', name: 'Guaraná lata', sectorId: BAR },
            sectorId: BAR,
          }),
          modifier({
            name: 'Batata frita',
            product: { id: 'p3', name: 'Batata frita', sectorId: KITCHEN },
            sectorId: KITCHEN,
          }),
        ],
      }),
      2,
      KITCHEN,
    );
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      sectorId: KITCHEN,
      kind: 'ITEM',
      name: 'Combo X-Burguer',
      quantity: 2,
    });
    // Same-sector parts stay with the line.
    expect(tasks[0]!.details.modifiers.map((m) => m.name)).toEqual(['Ao ponto', 'Batata frita']);
    expect(tasks[1]).toMatchObject({
      sectorId: BAR,
      kind: 'COMBO_PART',
      name: 'Guaraná lata',
      quantity: 2,
      details: { comboOf: 'Combo X-Burguer' },
    });
  });

  it('multiplies the combo part by the option quantity', () => {
    const tasks = routeItem(
      snapshot({
        modifiers: [
          modifier({
            name: 'Chope',
            quantity: 2,
            product: { id: 'p4', name: 'Chope 300 ml', sectorId: BAR },
            sectorId: BAR,
          }),
        ],
      }),
      3,
      KITCHEN,
    );
    expect(tasks[1]).toMatchObject({ name: 'Chope 300 ml', quantity: 6 });
  });

  it('keeps an option without a product (or without a sector) in the item sector', () => {
    const tasks = routeItem(
      snapshot({ modifiers: [modifier({ name: 'Bacon', sectorId: BAR })] }),
      1,
      KITCHEN,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.details.modifiers[0]!.name).toBe('Bacon');
  });

  it('lists pizza flavors with fractions and flags removals from options and notes', () => {
    const [task] = routeItem(
      snapshot({
        kind: 'PIZZA',
        name: 'Pizzas — Grande',
        size: { id: 's', name: 'Grande' },
        flavors: [
          {
            productId: 'a',
            name: 'Calabresa',
            fraction: { numerator: 1, denominator: 2 },
            fullPriceCents: 0,
            chargedPriceCents: 0,
            note: 'sem cebola',
          },
          {
            productId: 'b',
            name: 'Marguerita',
            fraction: { numerator: 1, denominator: 2 },
            fullPriceCents: 0,
            chargedPriceCents: 0,
            note: null,
          },
        ],
        modifiers: [modifier({ name: 'Sem orégano' })],
        note: 'bem assada, tirar azeitona',
      }),
      1,
      'sector-pizza',
    );
    expect(task!.details.size).toBeNull(); // already in the pizza name
    expect(task!.details.flavors).toEqual([
      { name: 'Calabresa', fraction: '1/2', note: 'sem cebola' },
      { name: 'Marguerita', fraction: '1/2', note: null },
    ]);
    expect(task!.details.removals).toEqual([
      'Sem orégano',
      'tirar azeitona',
      'Calabresa: sem cebola',
    ]);
    expect(task!.details.modifiers[0]).toEqual({ name: 'Sem orégano', quantity: 1, removal: true });
  });

  it('shows the size of sized products', () => {
    const [task] = routeItem(
      snapshot({ kind: 'SIZED', size: { id: 's', name: 'Meia' } }),
      1,
      KITCHEN,
    );
    expect(task!.details.size).toBe('Meia');
  });

  it('does not repeat a size already in the name', () => {
    const [task] = routeItem(
      snapshot({ kind: 'SIZED', name: 'Refrigerante cola 2 L', size: { id: 's', name: '2 L' } }),
      1,
      KITCHEN,
    );
    expect(task!.details.size).toBeNull();
  });
});

describe('removals', () => {
  it('recognizes common removal wording', () => {
    expect(isRemoval('Sem cebola')).toBe(true);
    expect(isRemoval('tirar o tomate')).toBe(true);
    expect(isRemoval('Retirar picles')).toBe(true);
    expect(isRemoval('Não colocar sal')).toBe(true);
    expect(isRemoval('Bem passado')).toBe(false);
    expect(isRemoval('Semente de gergelim')).toBe(false);
  });

  it('splits notes in parts', () => {
    expect(noteParts('bem passado, sem cebola')).toEqual([
      { text: 'bem passado', removal: false },
      { text: 'sem cebola', removal: true },
    ]);
    expect(noteParts('  ')).toEqual([]);
    expect(noteParts(null)).toEqual([]);
  });
});

describe('scaleTaskQuantity', () => {
  it('scales tasks with the line', () => {
    expect(scaleTaskQuantity(3, 3, 1)).toBe(1);
    expect(scaleTaskQuantity(6, 3, 2)).toBe(4); // 2 drinks per combo
  });
});

describe('deriveItemStatus', () => {
  it('follows the tasks of every sector', () => {
    expect(deriveItemStatus(['QUEUED', 'QUEUED'])).toBe('QUEUED');
    expect(deriveItemStatus(['READY', 'QUEUED'])).toBe('PREPARING');
    expect(deriveItemStatus(['PREPARING', 'QUEUED'])).toBe('PREPARING');
    expect(deriveItemStatus(['READY', 'READY'])).toBe('READY');
    expect(deriveItemStatus(['READY', 'CANCELED'])).toBe('READY');
    expect(deriveItemStatus(['CANCELED'])).toBe('CANCELED');
  });
});

describe('kitchenTransitions', () => {
  it('starts preparing when the first task starts', () => {
    expect(kitchenTransitions('ACCEPTED', ['PREPARING', 'QUEUED'])).toEqual(['PREPARING']);
    expect(kitchenTransitions('ACCEPTED', ['QUEUED', 'QUEUED'])).toEqual([]);
  });

  it('is ready only when every active task of every sector is ready', () => {
    expect(kitchenTransitions('PREPARING', ['READY', 'PREPARING'])).toEqual([]);
    expect(kitchenTransitions('PREPARING', ['READY', 'READY', 'CANCELED'])).toEqual(['READY']);
    expect(kitchenTransitions('ACCEPTED', ['READY'])).toEqual(['PREPARING', 'READY']);
  });

  it('goes back to preparing when a ready is undone or a new round arrives', () => {
    expect(kitchenTransitions('READY', ['READY', 'PREPARING'])).toEqual(['PREPARING']);
    expect(kitchenTransitions('READY', ['READY', 'QUEUED'])).toEqual(['PREPARING']);
    expect(kitchenTransitions('READY', ['READY'])).toEqual([]);
  });

  it('never moves orders outside the kitchen', () => {
    for (const status of ['PENDING', 'DISPATCHED', 'DELIVERED', 'CANCELED'] as const) {
      expect(kitchenTransitions(status, ['READY'])).toEqual([]);
    }
    expect(kitchenTransitions('PREPARING', ['CANCELED'])).toEqual([]);
  });
});

describe('screen helpers', () => {
  const sent = new Date('2026-10-05T12:00:00Z');
  const at = (minutes: number) => new Date(sent.getTime() + minutes * 60_000);
  const limits = { warnAfterMinutes: 10, lateAfterMinutes: 20 };

  it('colors the timer by the sector limits', () => {
    expect(timerLevel(sent, at(9), limits)).toBe('ok');
    expect(timerLevel(sent, at(10), limits)).toBe('warn');
    expect(timerLevel(sent, at(20), limits)).toBe('late');
  });

  it('consolidates pending quantities per product', () => {
    expect(
      consolidate([
        { name: 'X-Burguer', quantity: 2, status: 'QUEUED' },
        { name: 'X-Burguer', quantity: 5, status: 'PREPARING' },
        { name: 'X-Burguer', quantity: 1, status: 'READY' },
        { name: 'Batata frita', size: 'Meia', quantity: 3, status: 'QUEUED' },
        { name: 'Água', quantity: 1, status: 'CANCELED' },
      ]),
    ).toEqual([
      { name: 'X-Burguer', quantity: 7 },
      { name: 'Batata frita (Meia)', quantity: 3 },
    ]);
  });

  it('validates the sector limits', () => {
    expect(sectorLimitsError(10, 20)).toBeNull();
    expect(sectorLimitsError(0, 20)).toMatch(/amarelo/);
    expect(sectorLimitsError(20, 20)).toMatch(/vermelho/);
  });
});
