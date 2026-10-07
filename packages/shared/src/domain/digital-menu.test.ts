import { describe, expect, it } from 'vitest';
import type { CatalogDto, CatalogProduct } from '../menu/types.js';
import { indexCatalog } from '../orders/catalog-pricing.js';
import { orderItemInputSchema } from '../orders/schemas.js';
import {
  DEFAULT_DIGITAL_ORDER_LIMITS,
  cartChanges,
  contrastRatio,
  customerRejectionMessage,
  describeItem,
  digitalOrderLimitError,
  estimatedTime,
  isHexColor,
  isMobilePhone,
  privacyNoticeTemplate,
  readableForeground,
  storeOpenState,
  trackingTimeline,
} from './digital-menu.js';

// Lunch every day, dinner Fri/Sat until 02:00 (crosses midnight).
const HOURS = [
  ...[0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '11:00', closesAt: '15:00' })),
  { weekday: 5, opensAt: '18:00', closesAt: '02:00' },
  { weekday: 6, opensAt: '18:00', closesAt: '02:00' },
];
// 2026-10-09 is a Friday; São Paulo is UTC-3.
const at = (iso: string) => new Date(`${iso}-03:00`);

describe('storeOpenState', () => {
  it('is open during a shift, including after midnight of an overnight one', () => {
    expect(storeOpenState(HOURS, at('2026-10-09T12:00')).open).toBe(true);
    expect(storeOpenState(HOURS, at('2026-10-10T01:30')).open).toBe(true);
  });

  it('labels the next opening today, tomorrow or by weekday', () => {
    expect(storeOpenState(HOURS, at('2026-10-09T16:00')).nextOpening?.label).toBe('hoje às 18:00');
    expect(storeOpenState(HOURS, at('2026-10-08T16:00')).nextOpening?.label).toBe(
      'amanhã às 11:00',
    );
    const onlyMonday = [{ weekday: 1, opensAt: '11:00', closesAt: '15:00' }];
    expect(storeOpenState(onlyMonday, at('2026-10-09T16:00')).nextOpening).toEqual({
      at: '2026-10-12T14:00:00.000Z',
      label: 'segunda às 11:00',
    });
  });

  it('is always open without opening hours', () => {
    expect(storeOpenState([], at('2026-10-09T04:00'))).toEqual({ open: true, nextOpening: null });
  });
});

describe('brand color', () => {
  it('validates hex colors', () => {
    expect(isHexColor('#e85d04')).toBe(true);
    expect(isHexColor('e85d04')).toBe(false);
    expect(isHexColor('#fff')).toBe(false);
  });

  it('picks the readable text color', () => {
    expect(readableForeground('#1d3557')).toBe('#ffffff');
    expect(readableForeground('#ffd166')).toBe('#111111');
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});

describe('cartChanges', () => {
  const product = (p: Partial<CatalogProduct> & { id: string }): CatalogProduct => ({
    name: p.id,
    description: null,
    kind: 'STANDARD',
    sku: null,
    sectorId: null,
    imageUrl: null,
    thumbUrl: null,
    priceCents: 1000,
    promoPriceCents: null,
    price: { fromCents: 1000, toCents: 1000, hasPromo: false },
    sizes: [],
    modifierGroups: [],
    availability: { available: true, reasons: [] },
    ...p,
  });
  const catalog: CatalogDto = {
    channel: 'DIGITAL_MENU',
    generatedAt: '2026-10-09T15:00:00Z',
    pizzaPricingRule: 'HIGHEST',
    categories: [
      {
        id: 'c',
        name: 'Lanches',
        description: null,
        kind: 'STANDARD',
        sizes: [],
        modifierGroups: [],
        products: [
          product({ id: 'same' }),
          product({ id: 'pricier', priceCents: 1200 }),
          product({
            id: 'gone',
            availability: {
              available: false,
              reasons: [{ code: 'PRODUCT_PAUSED', message: 'Esgotado no momento' }],
            },
          }),
        ],
      },
    ],
  };
  const line = (id: string, cents: number) => ({
    key: id,
    input: orderItemInputSchema.parse({ productId: id, quantity: 1 }),
    unitChargedPriceCents: cents,
  });

  it('flags items that ran out or changed price', () => {
    const changes = cartChanges(
      [line('same', 1000), line('pricier', 1000), line('gone', 1000), line('deleted', 1000)],
      indexCatalog(catalog),
    );
    expect(changes.map((c) => [c.key, c.kind])).toEqual([
      ['pricier', 'PRICE_CHANGED'],
      ['gone', 'UNAVAILABLE'],
      ['deleted', 'UNAVAILABLE'],
    ]);
    expect(changes[0]).toMatchObject({ fromCents: 1000, toCents: 1200 });
  });
});

describe('digitalOrderLimitError', () => {
  const none = { phoneOpen: 0, phoneDay: 0, ipHour: 0, storePending: 0 };
  const limits = DEFAULT_DIGITAL_ORDER_LIMITS;

  it('lets orders through under every limit', () => {
    expect(digitalOrderLimitError({ ...none, phoneOpen: 1, ipHour: 29 }, limits)).toBeNull();
  });

  it('checks the phone first (main protection), the IP only against bots', () => {
    expect(digitalOrderLimitError({ ...none, phoneOpen: 2 }, limits)).toMatch(/em andamento/);
    expect(digitalOrderLimitError({ ...none, phoneDay: 10 }, limits)).toMatch(/por dia/);
    expect(digitalOrderLimitError({ ...none, storePending: 20 }, limits)).toMatch(/muitos pedidos/);
    expect(digitalOrderLimitError({ ...none, ipHour: 30 }, limits)).toMatch(/desta conexão/);
  });
});

describe('isMobilePhone', () => {
  it('needs a mobile number with DDD', () => {
    expect(isMobilePhone('(11) 99876-5432')).toBe(true);
    expect(isMobilePhone('11 3456-7890')).toBe(false);
    expect(isMobilePhone('99876-5432')).toBe(false);
  });
});

describe('customer-facing rejection', () => {
  it('shows the label, or the text for "other"', () => {
    expect(customerRejectionMessage('OUT_OF_STOCK', 'nota interna')).toBe('Item esgotado');
    expect(customerRejectionMessage('OTHER', 'Fechamos mais cedo hoje')).toBe(
      'Fechamos mais cedo hoje',
    );
    expect(customerRejectionMessage(null, null)).toBe('O restaurante cancelou o pedido.');
  });
});

describe('trackingTimeline', () => {
  const times = {
    createdAt: '2026-10-09T15:00:00Z',
    acceptedAt: '2026-10-09T15:02:00Z',
    readyAt: null,
    dispatchedAt: null,
    deliveredAt: null,
  };

  it('has a dispatch step only for delivery and marks the current step', () => {
    const delivery = trackingTimeline('DELIVERY', 'PREPARING', times);
    expect(delivery.map((s) => s.key)).toEqual([
      'RECEIVED',
      'ACCEPTED',
      'PREPARING',
      'READY',
      'DISPATCHED',
      'DELIVERED',
    ]);
    expect(delivery.filter((s) => s.done).map((s) => s.key)).toEqual([
      'RECEIVED',
      'ACCEPTED',
      'PREPARING',
    ]);
    expect(delivery.find((s) => s.current)?.key).toBe('PREPARING');
    const takeout = trackingTimeline('TAKEOUT', 'READY', times);
    expect(takeout.map((s) => s.key)).not.toContain('DISPATCHED');
    expect(takeout.find((s) => s.current)?.label).toBe('Pronto para retirar');
  });

  it('has no current step once delivered', () => {
    expect(trackingTimeline('DELIVERY', 'DELIVERED', times).some((s) => s.current)).toBe(false);
  });

  it('estimates from the acceptance', () => {
    expect(estimatedTime({ type: 'DELIVERY', ...times, etaMinutes: 40 })).toBe(
      '2026-10-09T15:42:00.000Z',
    );
  });
});

describe('privacyNoticeTemplate', () => {
  it('names the controller and the contact', () => {
    const text = privacyNoticeTemplate({
      name: 'Cantina',
      legalName: 'Cantina LTDA',
      cnpj: '11.222.333/0001-81',
      email: 'contato@cantina.com',
      phone: null,
    });
    expect(text).toContain('Cantina LTDA (CNPJ 11.222.333/0001-81) é o responsável (controlador)');
    expect(text).toContain('pelo contato contato@cantina.com');
    expect(text).toContain('sem seu nome ou telefone');
  });
});

describe('describeItem', () => {
  it('summarizes size, flavors, modifiers and note', () => {
    expect(
      describeItem({
        size: { name: 'Grande' },
        flavors: [
          { name: 'Calabresa', fraction: { numerator: 1, denominator: 2 } },
          { name: 'Marguerita', fraction: { numerator: 1, denominator: 2 } },
        ],
        modifiers: [
          { name: 'Catupiry', quantity: 1 },
          { name: 'Bacon', quantity: 2 },
        ],
        note: 'sem cebola',
      }),
    ).toBe('Grande · ½ Calabresa, ½ Marguerita · Catupiry, 2× Bacon · Obs.: sem cebola');
    expect(describeItem({ size: null, flavors: [], modifiers: [], note: null })).toBeNull();
  });
});
