import { describe, expect, it } from 'vitest';
import {
  type DeliveryAreaRule,
  courierEarnings,
  courierStatus,
  deliveryQuote,
  distanceMeters,
  effectivePayRule,
  feeChange,
  isAreaPaused,
  mapLinks,
  normalizePlace,
  payoutError,
  resolveDeliveryArea,
  settlementSummary,
  unmatchedNeighborhoods,
} from './delivery.js';

const store = { latitude: -23.5649, longitude: -46.6519 }; // Av. Paulista
const now = new Date('2026-10-05T19:00:00Z');

const area = (extra: Partial<DeliveryAreaRule>): DeliveryAreaRule => ({
  id: 'a',
  name: 'Área',
  kind: 'NEIGHBORHOOD',
  neighborhoods: [],
  city: 'São Paulo',
  radiusMeters: null,
  feeCents: 600,
  etaMinutes: 30,
  minimumOrderCents: null,
  freeAboveCents: null,
  pausedReason: null,
  pausedUntil: null,
  sortOrder: 0,
  ...extra,
});

const centro = area({
  id: 'centro',
  name: 'Centro',
  neighborhoods: ['Centro', 'Centro Histórico', 'Sé'],
});
const bela = area({
  id: 'bela',
  name: 'Bela Vista',
  neighborhoods: ['Bela Vista'],
  feeCents: 500,
  sortOrder: 1,
});
const r3 = area({
  id: 'r3',
  name: 'Até 3 km',
  kind: 'RADIUS',
  neighborhoods: [],
  radiusMeters: 3000,
  feeCents: 800,
  sortOrder: 2,
});
const r6 = area({
  id: 'r6',
  name: 'Até 6 km',
  kind: 'RADIUS',
  neighborhoods: [],
  radiusMeters: 6000,
  feeCents: 1200,
  sortOrder: 3,
});
const areas = [centro, bela, r3, r6];

describe('places', () => {
  it('normalizes accents, case, punctuation and spaces', () => {
    expect(normalizePlace('  Centro  Histórico ')).toBe('centro historico');
    expect(normalizePlace('São-José')).toBe('sao jose');
    expect(normalizePlace(null)).toBe('');
  });

  it('measures distances (Paulista → Sé ≈ 3 km)', () => {
    const se = { latitude: -23.5505, longitude: -46.6333 };
    const d = distanceMeters(store, se);
    expect(d).toBeGreaterThan(2_000);
    expect(d).toBeLessThan(3_000);
  });
});

describe('resolveDeliveryArea', () => {
  it('matches a neighborhood by any of its variations, without coordinates', () => {
    const result = resolveDeliveryArea(
      { neighborhood: 'centro historico', city: 'SAO PAULO' },
      areas,
      { store, now },
    );
    expect(result).toMatchObject({ ok: true, matchedBy: 'NEIGHBORHOOD', area: { id: 'centro' } });
  });

  it('checks the city of neighborhood areas', () => {
    const result = resolveDeliveryArea({ neighborhood: 'Centro', city: 'Campinas' }, [centro], {
      store,
      now,
    });
    expect(result).toMatchObject({ ok: false, reason: 'OUT_OF_AREA' });
  });

  it('uses the smallest radius covering the coordinates', () => {
    const near = { latitude: -23.57, longitude: -46.66 }; // ~1 km
    const far = { latitude: -23.6, longitude: -46.68 }; // ~4.8 km
    expect(
      resolveDeliveryArea(
        { neighborhood: 'Jardins', city: 'São Paulo', coordinates: near },
        areas,
        { store, now },
      ),
    ).toMatchObject({
      ok: true,
      matchedBy: 'RADIUS',
      area: { id: 'r3' },
    });
    expect(
      resolveDeliveryArea(
        { neighborhood: 'Vila Mariana', city: 'São Paulo', coordinates: far },
        areas,
        { store, now },
      ),
    ).toMatchObject({
      ok: true,
      area: { id: 'r6' },
    });
  });

  it('asks for a manual choice when only radii could match and there are no coordinates', () => {
    expect(
      resolveDeliveryArea({ neighborhood: 'Jardins', city: 'São Paulo' }, areas, { store, now }),
    ).toMatchObject({
      ok: false,
      reason: 'NEEDS_COORDINATES',
    });
  });

  it('is out of area beyond every radius', () => {
    const away = { latitude: -23.9, longitude: -46.3 };
    expect(
      resolveDeliveryArea({ neighborhood: 'Santos', city: 'Santos', coordinates: away }, areas, {
        store,
        now,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'OUT_OF_AREA',
      message: 'Endereço fora da área de entrega',
    });
  });

  it('refuses a paused area instead of falling into another one', () => {
    const paused = { ...centro, pausedReason: 'Chuva forte' };
    const result = resolveDeliveryArea(
      {
        neighborhood: 'Centro',
        city: 'São Paulo',
        coordinates: { latitude: -23.5505, longitude: -46.6333 },
      },
      [paused, r3, r6],
      { store, now },
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'PAUSED',
      message: 'Entrega temporariamente indisponível para Centro (Chuva forte)',
    });
  });

  it('a pause with an end time expires by itself', () => {
    expect(isAreaPaused({ pausedReason: 'Chuva', pausedUntil: '2026-10-05T18:00:00Z' }, now)).toBe(
      false,
    );
    expect(isAreaPaused({ pausedReason: 'Chuva', pausedUntil: '2026-10-05T20:00:00Z' }, now)).toBe(
      true,
    );
    expect(isAreaPaused({ pausedReason: 'Sem motoboy', pausedUntil: null }, now)).toBe(true);
  });
});

describe('deliveryQuote', () => {
  it('applies free delivery above the threshold and the minimum order', () => {
    const rule = { feeCents: 700, etaMinutes: 40, minimumOrderCents: 3000, freeAboveCents: 8000 };
    expect(deliveryQuote(rule, 2500, 0)).toEqual({
      feeCents: 700,
      areaFeeCents: 700,
      etaMinutes: 40,
      minimumOrderCents: 3000,
      belowMinimum: true,
      freeDelivery: false,
    });
    expect(deliveryQuote(rule, 8000, 0)).toMatchObject({
      feeCents: 0,
      freeDelivery: true,
      belowMinimum: false,
    });
  });

  it('falls back to the store minimum', () => {
    expect(
      deliveryQuote(
        { feeCents: 500, etaMinutes: 30, minimumOrderCents: null, freeAboveCents: null },
        1000,
        2000,
      ).belowMinimum,
    ).toBe(true);
  });

  it('classifies a manual fee', () => {
    expect(feeChange(700, 700)).toBe('SAME');
    expect(feeChange(700, 900)).toBe('INCREASE');
    expect(feeChange(700, 0)).toBe('REDUCE');
  });
});

describe('unmatchedNeighborhoods', () => {
  it('groups neighborhoods no area covers, most frequent first', () => {
    const result = unmatchedNeighborhoods(
      [
        { neighborhood: 'Consolação', city: 'São Paulo', at: '2026-10-01T10:00:00Z' },
        { neighborhood: 'consolacao ', city: 'são paulo', at: '2026-10-03T10:00:00Z' },
        { neighborhood: 'Centro Histórico', city: 'São Paulo', at: '2026-10-03T10:00:00Z' }, // covered
        { neighborhood: 'Liberdade', city: 'São Paulo', at: '2026-10-02T10:00:00Z' },
      ],
      areas,
    );
    expect(result).toEqual([
      {
        neighborhood: 'Consolação',
        city: 'São Paulo',
        occurrences: 2,
        lastSeenAt: '2026-10-03T10:00:00.000Z',
      },
      {
        neighborhood: 'Liberdade',
        city: 'São Paulo',
        occurrences: 1,
        lastSeenAt: '2026-10-02T10:00:00.000Z',
      },
    ]);
  });
});

describe('mapLinks', () => {
  it('uses coordinates when known', () => {
    expect(
      mapLinks({
        street: 'Av. Paulista',
        number: '1000',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        latitude: -23.56,
        longitude: -46.65,
      }),
    ).toEqual({
      google: 'https://www.google.com/maps/search/?api=1&query=-23.56,-46.65',
      waze: 'https://waze.com/ul?ll=-23.56,-46.65&navigate=yes',
    });
  });

  it('falls back to the address text', () => {
    const links = mapLinks({
      street: 'Rua A',
      number: '10',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      cep: '01001000',
    });
    expect(links.google).toContain(
      encodeURIComponent('Rua A, 10 - Centro, São Paulo - SP, 01001000'),
    );
    expect(links.waze).toContain('waze.com/ul?q=');
  });
});

describe('couriers', () => {
  it('status is computed from the open route and the active flag', () => {
    expect(courierStatus({ isActive: true, hasOpenRun: false })).toBe('AVAILABLE');
    expect(courierStatus({ isActive: true, hasOpenRun: true })).toBe('ON_ROUTE');
    expect(courierStatus({ isActive: false, hasOpenRun: false })).toBe('INACTIVE');
  });

  it('pays per delivery, a share of the fees and the daily once', () => {
    const rule = effectivePayRule(
      { perDeliveryCents: 300, feeShareBps: 5000, dailyCents: 4000 },
      { perDeliveryCents: null, feeShareBps: 10000, dailyCents: null },
    );
    expect(rule).toEqual({ perDeliveryCents: 300, feeShareBps: 10000, dailyCents: 4000 });
    expect(
      courierEarnings(rule, { deliveries: 3, deliveryFeesCents: 1800, includeDaily: true }),
    ).toEqual({
      perDeliveryCents: 900,
      feeShareCents: 1800,
      dailyCents: 4000,
      totalCents: 6700,
    });
    expect(
      courierEarnings(rule, { deliveries: 1, deliveryFeesCents: 600, includeDaily: false })
        .totalCents,
    ).toBe(900);
  });
});

describe('settlementSummary', () => {
  const stops = [
    { balanceCents: 4500, method: 'CASH' as const },
    { balanceCents: 3200, method: 'CREDIT_CARD' as const },
    { balanceCents: 2000, method: 'PIX' as const },
    { balanceCents: 0, method: 'ONLINE' as const },
  ];

  it('compares expected cash and card slips with the counted amounts', () => {
    const s = settlementSummary({
      stops,
      countedCashCents: 4000,
      countedCardCents: 3200,
      earningsCents: 2500,
      previousBalanceCents: 1000,
      payoutCents: 0,
      deductShortage: false,
    });
    expect(s).toMatchObject({
      expectedCashCents: 4500,
      expectedCardCents: 3200,
      otherCents: 2000,
      cashDifferenceCents: -500,
      cardDifferenceCents: 0,
      newBalanceCents: 3500, // the restaurant owes the courier
      courierOwesCents: 500, // the courier owes the restaurant
    });
  });

  it('pays now or accumulates; missing cash may be deducted from the balance', () => {
    const paid = settlementSummary({
      stops,
      countedCashCents: 4000,
      countedCardCents: 3200,
      earningsCents: 2500,
      previousBalanceCents: 1000,
      payoutCents: 3000,
      deductShortage: true,
    });
    expect(paid).toMatchObject({
      shortageDeductedCents: 500,
      newBalanceCents: 0,
      courierOwesCents: 0,
    });
  });

  it('a payout cannot exceed the balance', () => {
    expect(payoutError(3000, 3000)).toBeNull();
    expect(payoutError(3000, 3001)).toBe('Pagamento maior que o saldo do entregador (R$ 30,00)');
    expect(payoutError(3000, -1)).toBe('Valor inválido');
  });
});
