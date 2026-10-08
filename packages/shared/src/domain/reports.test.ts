import { describe, expect, it } from 'vitest';
import { centsToCsv, toCsv } from '../utils/csv.js';
import { businessDateResolver, businessDayWindow, currentBusinessDay } from './business-day.js';
import { calculateOrderTotals } from './order-totals.js';
import {
  abcCurve,
  averageTicket,
  businessDayStart,
  byHour,
  compare,
  comparisonDates,
  durationStats,
  heatmap,
  percentile,
  reconcile,
  reportChannelOf,
  revenueOf,
  salesBreakdown,
  sameMomentOn,
} from './reports.js';

describe('sales breakdown', () => {
  it('matches the order totals composition (discounts, service and delivery fees apart)', () => {
    const t = calculateOrderTotals({
      lines: [
        { quantity: 2, unitChargedPriceCents: 3000, discount: { type: 'VALUE', value: 500 } },
        { quantity: 1, unitChargedPriceCents: 1500 },
        { quantity: 1, unitChargedPriceCents: 999, canceled: true },
      ],
      orderDiscount: { type: 'PERCENT', value: 1000 },
      serviceFeeBps: 1000,
      deliveryFeeCents: 700,
    });
    const order = {
      subtotalCents: t.subtotalCents,
      itemDiscountCents: t.itemDiscountCents,
      orderDiscountCents: t.orderDiscountCents,
      couponDiscountCents: t.couponDiscountCents,
      serviceFeeCents: t.serviceFeeCents,
      deliveryFeeCents: t.deliveryFeeCents,
      totalCents: t.totalCents,
    };
    const b = salesBreakdown([order, order]);
    expect(b.orders).toBe(2);
    expect(b.grossProductsCents).toBe(2 * 7500); // canceled item out
    expect(b.discountsCents).toBe(2 * (500 + t.orderDiscountCents));
    expect(b.netProductsCents + b.serviceFeeCents + b.deliveryFeeCents).toBe(b.totalCents);
    expect(revenueOf(b, 1000).revenueCents).toBe(b.totalCents - 1000);
    expect(averageTicket(b)).toEqual({
      totalCents: t.totalCents,
      productsCents: b.netProductsCents / 2,
    });
    expect(averageTicket(salesBreakdown([]))).toEqual({ totalCents: 0, productsCents: 0 });
  });

  it('reconciles revenue with what was received (exact identity)', () => {
    const r = reconcile({
      revenueCents: 10_000,
      receivableCents: 1_500,
      paidOnOtherDaysCents: 200,
      fromPreviousDaysCents: 800,
      forOpenOrdersCents: 300,
      canceledNetCents: 0,
      receivedCents: 9_400,
    });
    expect(r.differenceCents).toBe(0);
    expect(reconcile({ ...r, receivedCents: 9_500 }).differenceCents).toBe(100);
  });

  it('compares until the same moment of the business day', () => {
    const hours = [
      { weekday: 3, opensAt: '11:00' }, // Wednesday
      { weekday: 3, opensAt: '18:00' },
      { weekday: 2, opensAt: '18:00' }, // Tuesday: dinner only
    ];
    // Wednesday 2026-10-07 14:00 in São Paulo = 3 h after opening.
    const now = new Date('2026-10-07T17:00:00Z');
    expect(businessDayStart('2026-10-07', hours).toISOString()).toBe('2026-10-07T14:00:00.000Z');
    expect(sameMomentOn('2026-09-30', { date: '2026-10-07', now }, hours).toISOString()).toBe(
      '2026-09-30T17:00:00.000Z',
    );
    // Without hours the day starts at midnight.
    expect(businessDayStart('2026-10-06', []).toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });

  it('classifies the channel by source first, then by type', () => {
    expect(reportChannelOf('DELIVERY', 'DIGITAL_MENU')).toBe('DIGITAL_MENU');
    expect(reportChannelOf('DELIVERY', 'IFOOD')).toBe('MARKETPLACE');
    expect(reportChannelOf('DELIVERY', 'POS')).toBe('DELIVERY');
    expect(reportChannelOf('DINE_IN', 'WAITER_APP')).toBe('TABLE');
    expect(reportChannelOf('TAKEOUT', 'POS')).toBe('COUNTER');
  });
});

describe('comparisons', () => {
  it('knows when going up is good or bad', () => {
    expect(compare(120, 100)).toMatchObject({ delta: 20, deltaPct: 20, trend: 'better' });
    expect(compare(120, 100, 'down')).toMatchObject({ trend: 'worse' });
    expect(compare(80, 100, 'down')).toMatchObject({ deltaPct: -20, trend: 'better' });
    expect(compare(5, 0)).toMatchObject({ deltaPct: null, trend: 'better' });
    expect(compare(3, 3).trend).toBe('same');
  });

  it('compares with the same weekday of previous weeks', () => {
    expect(comparisonDates('2026-10-08', 'LAST_WEEK')).toEqual(['2026-10-01']);
    expect(comparisonDates('2026-10-08', 'AVG_4_WEEKS')).toEqual([
      '2026-10-01',
      '2026-09-24',
      '2026-09-17',
      '2026-09-10',
    ]);
  });
});

describe('ABC curve', () => {
  it('A until 80% (the item crossing it included), B until 95%, C after', () => {
    const rows = abcCurve(
      [
        { name: 'b', v: 3000 },
        { name: 'a', v: 5000 },
        { name: 'c', v: 1000 },
        { name: 'd', v: 600 },
        { name: 'e', v: 400 },
        { name: 'z', v: 0 },
      ],
      (i) => i.v,
    );
    expect(rows.map((r) => `${r.item.name}${r.abc}`)).toEqual(['aA', 'bA', 'cB', 'dB', 'eC', 'zC']);
    expect(rows.map((r) => r.cumulativePct)).toEqual([50, 80, 90, 96, 100, 100]);
    expect(rows[0]!.sharePct).toBe(50);
    expect(abcCurve([], () => 0)).toEqual([]);
  });
});

describe('time buckets', () => {
  it('uses the São Paulo hour and weekday', () => {
    // Saturday 2026-10-10 00:30 UTC = Friday 21:30 in São Paulo.
    const at = new Date('2026-10-10T00:30:00Z');
    const grid = heatmap([{ at, value: 2 }]);
    expect(grid[5]![21]).toBe(2);
    expect(
      byHour([
        { at, value: 1 },
        { at, value: 1 },
      ])[21],
    ).toBe(2);
  });

  it('summarizes durations with median, p90 and share over the limit', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(3); // 2.5 rounded
    expect(percentile([], 50)).toBeNull();
    const s = durationStats([300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000], 1200);
    expect(s).toMatchObject({ count: 10, medianSeconds: 1650, p90Seconds: 2730, overLimitPct: 60 });
  });
});

describe('CSV for Excel pt-BR', () => {
  it('uses ; and decimal comma, escapes quotes and blocks formulas', () => {
    const csv = toCsv(
      [
        { name: 'Pizza "grande"; calabresa', cents: 123456, pct: 12.5 },
        { name: '=HYPERLINK("x")', cents: -5, pct: 0 },
      ],
      [
        { header: 'Produto', value: (r) => r.name },
        { header: 'Faturamento (R$)', value: (r) => r.cents, format: 'cents' },
        { header: 'Participação (%)', value: (r) => r.pct, format: 'percent' },
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Produto;Faturamento (R$);Participação (%)',
      '"Pizza ""grande""; calabresa";1234,56;12,5',
      '"\'=HYPERLINK(""x"")";-0,05;0',
      '',
    ]);
    expect(centsToCsv(0)).toBe('0,00');
  });
});

describe('business date of many instants', () => {
  it('matches currentBusinessDay, night shifts included', () => {
    const hours = [
      { weekday: 5, opensAt: '18:00', closesAt: '02:00' }, // Friday night
      { weekday: 6, opensAt: '11:00', closesAt: '15:00' },
      { weekday: 1, opensAt: '11:00', closesAt: '15:00' },
    ];
    const resolve = businessDateResolver(hours);
    const start = Date.parse('2026-10-08T00:00:00Z');
    for (let m = 0; m < 6 * 24 * 60; m += 37) {
      const at = new Date(start + m * 60_000);
      expect(resolve(at)).toBe(currentBusinessDay(hours, at).date);
    }
    // Saturday 01:30 in São Paulo belongs to Friday.
    expect(resolve(new Date('2026-10-10T04:30:00Z'))).toBe('2026-10-09');
    expect(businessDateResolver([])(new Date('2026-10-10T04:30:00Z'))).toBe('2026-10-10');
  });

  it('turns a period into the exact window of instants', () => {
    const hours = [
      { weekday: 5, opensAt: '18:00', closesAt: '02:00' },
      { weekday: 6, opensAt: '11:00', closesAt: '15:00' },
      { weekday: 1, opensAt: '11:00', closesAt: '15:00' },
    ];
    const resolve = businessDateResolver(hours);
    const window = businessDayWindow('2026-10-09', '2026-10-10', hours)!;
    const start = Date.parse('2026-10-06T00:00:00Z');
    for (let m = 0; m < 10 * 24 * 60; m += 23) {
      const at = new Date(start + m * 60_000);
      const date = resolve(at);
      const inside = at > window.gt && at <= window.lte;
      expect(inside).toBe(date >= '2026-10-09' && date <= '2026-10-10');
    }
    expect(businessDayWindow('2026-10-07', '2026-10-08', hours)).toBeNull(); // Wed–Thu closed
    const all = businessDayWindow('2026-10-09', '2026-10-09', [])!;
    expect(all.lte.getTime() - all.gt.getTime()).toBe(86_400_000);
  });
});
