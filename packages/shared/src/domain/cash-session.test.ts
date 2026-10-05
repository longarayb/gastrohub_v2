import { describe, expect, it } from 'vitest';
import {
  CASH_REGISTER_METHODS,
  cashRefundError,
  cashSessionCount,
  cashSessionTotals,
  withdrawalError,
} from './cash-session.js';

const session = cashSessionTotals({
  openingCents: 20_000,
  movements: [
    { type: 'SUPPLY', amountCents: 5_000 },
    { type: 'WITHDRAWAL', amountCents: 10_000 },
  ],
  received: [
    { method: 'CASH', amountCents: 7_250 },
    { method: 'CASH', amountCents: 3_000 },
    { method: 'PIX', amountCents: 4_500 },
    { method: 'CREDIT_CARD', amountCents: 12_000 },
  ],
  refunded: [{ method: 'CASH', amountCents: 3_000 }],
});

const method = (m: string) => session.methods.find((x) => x.method === m)!;

describe('cashSessionTotals', () => {
  it('computes expected cash from float, supplies, withdrawals, payments and refunds', () => {
    // 200 + 50 − 100 + 72,50 + 30 − 30 = 222,50
    expect(session.expectedCashCents).toBe(22_250);
    expect(method('CASH')).toEqual({
      method: 'CASH',
      receivedCents: 10_250,
      refundedCents: 3_000,
      expectedCents: 22_250,
    });
    expect(session.suppliesCents).toBe(5_000);
    expect(session.withdrawalsCents).toBe(10_000);
  });

  it('expects the received amount for other methods', () => {
    expect(method('PIX').expectedCents).toBe(4_500);
    expect(method('CREDIT_CARD').expectedCents).toBe(12_000);
    expect(method('DEBIT_CARD').expectedCents).toBe(0);
    expect(session.expectedCents).toBe(22_250 + 4_500 + 12_000);
  });

  it('never includes online/marketplace payments', () => {
    expect(CASH_REGISTER_METHODS).not.toContain('ONLINE');
    expect(session.methods.map((m) => m.method)).not.toContain('ONLINE');
  });
});

describe('cashSessionCount', () => {
  it('records the difference per method (negative = missing)', () => {
    const count = cashSessionCount(session, { CASH: 22_000, PIX: 4_500, CREDIT_CARD: 12_100 });
    expect(count.lines).toEqual([
      { method: 'CASH', expectedCents: 22_250, countedCents: 22_000, differenceCents: -250 },
      { method: 'PIX', expectedCents: 4_500, countedCents: 4_500, differenceCents: 0 },
      { method: 'CREDIT_CARD', expectedCents: 12_000, countedCents: 12_100, differenceCents: 100 },
    ]);
    expect(count.differenceCents).toBe(-150);
    expect(count.expectedCents).toBe(38_750);
    expect(count.countedCents).toBe(38_600);
  });

  it('counts missing methods as zero and always lists cash', () => {
    const empty = cashSessionTotals({ openingCents: 0, movements: [], received: [], refunded: [] });
    expect(cashSessionCount(empty, {}).lines).toEqual([
      { method: 'CASH', expectedCents: 0, countedCents: 0, differenceCents: 0 },
    ]);
    expect(cashSessionCount(session, {}).lines.find((l) => l.method === 'PIX')).toEqual({
      method: 'PIX',
      expectedCents: 4_500,
      countedCents: 0,
      differenceCents: -4_500,
    });
  });

  it('lists a method that was only counted (surplus)', () => {
    const empty = cashSessionTotals({ openingCents: 0, movements: [], received: [], refunded: [] });
    expect(cashSessionCount(empty, { MEAL_VOUCHER: 1_000 }).differenceCents).toBe(1_000);
  });
});

describe('withdrawals and refunds', () => {
  it('cannot take more cash than the drawer has', () => {
    expect(withdrawalError(22_250, 22_250)).toBeNull();
    expect(withdrawalError(22_250, 22_251)).toBe(
      'Sangria maior que o dinheiro no caixa (R$ 222,50)',
    );
    expect(cashRefundError(1_000, 2_000)).toMatch(/estorno/);
    expect(cashRefundError(1_000, 1_000)).toBeNull();
  });
});
