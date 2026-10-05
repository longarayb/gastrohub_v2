import { describe, expect, it } from 'vitest';
import {
  calculateLine,
  calculateOrderTotals,
  defaultServiceFeeBps,
  discountAmount,
  effectiveDeliveryFeeCents,
  effectiveServiceFeeBps,
} from './order-totals.js';

const line = (
  unit: number,
  quantity = 1,
  extra: Partial<Parameters<typeof calculateLine>[0]> = {},
) => ({
  unitChargedPriceCents: unit,
  quantity,
  ...extra,
});

describe('calculateLine', () => {
  it('applies value and percent discounts on the line gross', () => {
    expect(calculateLine(line(2990, 2))).toEqual({
      grossCents: 5980,
      discountCents: 0,
      totalCents: 5980,
    });
    expect(
      calculateLine(line(2990, 2, { discount: { type: 'VALUE', value: 500 } })).totalCents,
    ).toBe(5480);
    // 10% of 5980 = 598
    expect(
      calculateLine(line(2990, 2, { discount: { type: 'PERCENT', value: 1000 } })).discountCents,
    ).toBe(598);
  });

  it('never goes below zero', () => {
    expect(calculateLine(line(1000, 1, { discount: { type: 'VALUE', value: 5000 } }))).toEqual({
      grossCents: 1000,
      discountCents: 1000,
      totalCents: 0,
    });
  });

  it('rejects invalid input', () => {
    expect(() => calculateLine(line(1000, 0))).toThrow('Quantidade inválida');
    expect(() => calculateLine(line(10.5))).toThrow(RangeError);
    expect(() =>
      calculateLine(line(1000, 1, { discount: { type: 'PERCENT', value: 10_001 } })),
    ).toThrow('Desconto acima de 100%');
  });
});

describe('discountAmount rounding', () => {
  it('rounds half up when converting a percentage to cents', () => {
    expect(discountAmount(1005, { type: 'PERCENT', value: 1000 })).toBe(101); // 100.5 → 101
    expect(discountAmount(1004, { type: 'PERCENT', value: 1000 })).toBe(100); // 100.4 → 100
    expect(discountAmount(999, { type: 'PERCENT', value: 3333 })).toBe(333); // 332.97 → 333
  });
});

describe('calculateOrderTotals — order of discounts and fees', () => {
  it('item discounts → order discount → coupon → service fee on the result', () => {
    const totals = calculateOrderTotals({
      lines: [
        line(3000, 2, { discount: { type: 'VALUE', value: 1000 } }), // 6000 − 1000 = 5000
        line(2000, 1), // 2000
      ],
      orderDiscount: { type: 'PERCENT', value: 1000 }, // 10% of 7000 = 700
      coupon: { type: 'FIXED', value: 300 }, // on 6300
      serviceFeeBps: 1000, // 10% of 6000 = 600
      deliveryFeeCents: 0,
    });
    expect(totals).toMatchObject({
      itemsGrossCents: 8000,
      itemDiscountCents: 1000,
      subtotalCents: 7000,
      orderDiscountCents: 700,
      couponDiscountCents: 300,
      itemsNetCents: 6000,
      serviceFeeCents: 600,
      totalCents: 6600,
    });
  });

  it('percent coupon applies on what is left after the order discount', () => {
    const totals = calculateOrderTotals({
      lines: [line(10_000)],
      orderDiscount: { type: 'VALUE', value: 2000 },
      coupon: { type: 'PERCENT', value: 1000 }, // 10% of 8000
    });
    expect(totals.couponDiscountCents).toBe(800);
    expect(totals.totalCents).toBe(7200);
  });

  it('a coupon bigger than what is left zeroes the items but never goes negative', () => {
    const totals = calculateOrderTotals({
      lines: [line(1500)],
      orderDiscount: { type: 'VALUE', value: 500 },
      coupon: { type: 'FIXED', value: 5000 },
      serviceFeeBps: 1000,
      deliveryFeeCents: 700,
    });
    expect(totals).toMatchObject({
      subtotalCents: 1500,
      orderDiscountCents: 500,
      couponDiscountCents: 1000, // capped at the remaining 1000
      itemsNetCents: 0,
      serviceFeeCents: 0,
      deliveryFeeCents: 700, // discounts never reach the delivery fee
      totalCents: 700,
    });
  });

  it('an order discount bigger than the subtotal is capped', () => {
    const totals = calculateOrderTotals({
      lines: [line(1000)],
      orderDiscount: { type: 'VALUE', value: 9999 },
      coupon: { type: 'FIXED', value: 100 },
    });
    expect(totals.orderDiscountCents).toBe(1000);
    expect(totals.couponDiscountCents).toBe(0);
    expect(totals.totalCents).toBe(0);
  });

  it('every step stays non-negative even when all discounts exceed the values', () => {
    const totals = calculateOrderTotals({
      lines: [line(500, 1, { discount: { type: 'VALUE', value: 900 } })],
      orderDiscount: { type: 'PERCENT', value: 10_000 },
      coupon: { type: 'PERCENT', value: 10_000 },
      serviceFeeBps: 1000,
    });
    for (const value of Object.values(totals)) {
      if (typeof value === 'number') expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(totals.totalCents).toBe(0);
  });

  it('checks the coupon minimum on the subtotal and caps the coupon value', () => {
    const below = calculateOrderTotals({
      lines: [line(2000)],
      coupon: { type: 'PERCENT', value: 2000, minOrderCents: 3000 },
    });
    expect(below.couponDiscountCents).toBe(0);
    expect(below.couponMessage).toBe('Pedido abaixo do valor mínimo do cupom');

    const capped = calculateOrderTotals({
      lines: [line(20_000)],
      coupon: { type: 'PERCENT', value: 5000, maxDiscountCents: 1500 },
    });
    expect(capped.couponDiscountCents).toBe(1500);
  });

  it('service fee is never charged on the delivery fee', () => {
    const totals = calculateOrderTotals({
      lines: [line(4000)],
      serviceFeeBps: 1000,
      deliveryFeeCents: 800,
    });
    expect(totals.serviceFeeCents).toBe(400);
    expect(totals.totalCents).toBe(4000 + 400 + 800);
  });

  it('rounds the service fee half up once, on the net items value', () => {
    // 10% of 3335 = 333.5 → 334
    expect(calculateOrderTotals({ lines: [line(3335)], serviceFeeBps: 1000 }).serviceFeeCents).toBe(
      334,
    );
  });

  it('ignores canceled lines and reports promo savings', () => {
    const totals = calculateOrderTotals({
      lines: [line(2990, 2, { unitFullPriceCents: 3290 }), line(5000, 1, { canceled: true })],
    });
    expect(totals.subtotalCents).toBe(5980);
    expect(totals.promoSavingsCents).toBe(600);
    expect(totals.lines[1]).toEqual({ grossCents: 0, discountCents: 0, totalCents: 0 });
  });

  it('handles an empty order', () => {
    expect(calculateOrderTotals({ lines: [] }).totalCents).toBe(0);
  });
});

describe('fees per order type', () => {
  const config = { serviceFeeBps: 1000, serviceFeeOrderTypes: ['DINE_IN'] as const };

  it('applies the service fee only to the configured order types', () => {
    expect(defaultServiceFeeBps('DINE_IN', config)).toBe(1000);
    expect(defaultServiceFeeBps('DELIVERY', config)).toBe(0);
    expect(
      defaultServiceFeeBps('TAKEOUT', { ...config, serviceFeeOrderTypes: ['DINE_IN', 'TAKEOUT'] }),
    ).toBe(1000);
  });

  it('removes the service fee when waived', () => {
    expect(effectiveServiceFeeBps(1000, true)).toBe(0);
    expect(effectiveServiceFeeBps(1000, false)).toBe(1000);
  });

  it('only delivery orders carry a delivery fee', () => {
    expect(effectiveDeliveryFeeCents('DELIVERY', 700)).toBe(700);
    expect(effectiveDeliveryFeeCents('TAKEOUT', 700)).toBe(0);
  });
});
