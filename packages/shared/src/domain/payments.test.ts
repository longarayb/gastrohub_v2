import { describe, expect, it } from 'vitest';
import {
  acceptsCardDetails,
  closeError,
  isReceivable,
  paymentSummary,
  preparePayment,
  requiresPaymentToClose,
  usesCashRegister,
} from './payments.js';

describe('paymentSummary', () => {
  it('counts only confirmed payments', () => {
    expect(
      paymentSummary(10_000, [
        { amountCents: 3_000, status: 'CONFIRMED' },
        { amountCents: 5_000, status: 'REFUNDED' },
      ]),
    ).toEqual({ paidCents: 3_000, balanceCents: 7_000, status: 'PARTIAL' });
  });

  it('is unpaid without payments and paid at zero balance', () => {
    expect(paymentSummary(10_000, []).status).toBe('UNPAID');
    expect(paymentSummary(10_000, [{ amountCents: 10_000, status: 'CONFIRMED' }])).toEqual({
      paidCents: 10_000,
      balanceCents: 0,
      status: 'PAID',
    });
  });

  it('keeps an empty order unpaid but with nothing to receive', () => {
    expect(paymentSummary(0, [])).toEqual({ paidCents: 0, balanceCents: 0, status: 'UNPAID' });
    expect(closeError('DINE_IN', paymentSummary(0, []))).toBeNull();
  });
});

describe('preparePayment', () => {
  it('gives change only in cash', () => {
    expect(
      preparePayment(7_250, { method: 'CASH', amountCents: 7_250, receivedCents: 10_000 }),
    ).toEqual({
      ok: true,
      payment: { amountCents: 7_250, receivedCents: 10_000, changeCents: 2_750 },
    });
  });

  it('defaults the received cash to the amount', () => {
    expect(preparePayment(5_000, { method: 'CASH', amountCents: 2_000 })).toEqual({
      ok: true,
      payment: { amountCents: 2_000, receivedCents: 2_000, changeCents: 0 },
    });
  });

  it('accepts partial payments in any method', () => {
    expect(preparePayment(10_000, { method: 'PIX', amountCents: 3_334 })).toEqual({
      ok: true,
      payment: { amountCents: 3_334, receivedCents: null, changeCents: null },
    });
  });

  it('never applies more than the balance', () => {
    const card = preparePayment(5_000, { method: 'CREDIT_CARD', amountCents: 5_001 });
    expect(card).toEqual({ ok: false, message: 'Valor acima do saldo da conta (R$ 50,00)' });
    const cash = preparePayment(5_000, { method: 'CASH', amountCents: 6_000 });
    expect(cash.ok).toBe(false);
    if (!cash.ok) expect(cash.message).toMatch(/valor recebido/);
  });

  it('rejects change outside cash, received below the amount and empty amounts', () => {
    expect(
      preparePayment(5_000, { method: 'DEBIT_CARD', amountCents: 5_000, receivedCents: 6_000 }),
    ).toEqual({ ok: false, message: 'Troco só em pagamentos em dinheiro' });
    expect(
      preparePayment(5_000, { method: 'CASH', amountCents: 5_000, receivedCents: 4_000 }).ok,
    ).toBe(false);
    expect(preparePayment(5_000, { method: 'PIX', amountCents: 0 }).ok).toBe(false);
    expect(preparePayment(5_000, { method: 'PIX', amountCents: 10.5 }).ok).toBe(false);
  });

  it('refuses payments on a paid tab', () => {
    expect(preparePayment(0, { method: 'PIX', amountCents: 100 })).toEqual({
      ok: false,
      message: 'Esta conta já está paga',
    });
  });
});

describe('methods', () => {
  it('keeps online/marketplace payments out of the cash register', () => {
    expect(usesCashRegister('ONLINE')).toBe(false);
    expect(usesCashRegister('CASH')).toBe(true);
    expect(usesCashRegister('PIX')).toBe(true);
  });

  it('accepts card details only for card payments', () => {
    expect(acceptsCardDetails('CREDIT_CARD')).toBe(true);
    expect(acceptsCardDetails('DEBIT_CARD')).toBe(true);
    expect(acceptsCardDetails('MEAL_VOUCHER')).toBe(true);
    expect(acceptsCardDetails('PIX')).toBe(false);
    expect(acceptsCardDetails('CASH')).toBe(false);
  });
});

describe('closing', () => {
  const open = paymentSummary(5_000, [{ amountCents: 2_000, status: 'CONFIRMED' }]);
  const paid = paymentSummary(5_000, [{ amountCents: 5_000, status: 'CONFIRMED' }]);

  it('requires a zero balance on dine-in and takeout', () => {
    expect(requiresPaymentToClose('DINE_IN')).toBe(true);
    expect(requiresPaymentToClose('TAKEOUT')).toBe(true);
    expect(closeError('DINE_IN', open)).toBe('Falta receber R$ 30,00 para fechar a conta');
    expect(closeError('TAKEOUT', paid)).toBeNull();
  });

  it('lets delivery be delivered with a balance to receive', () => {
    expect(closeError('DELIVERY', open)).toBeNull();
    expect(isReceivable('DELIVERY', 'DELIVERED', 'PARTIAL')).toBe(true);
    expect(isReceivable('DELIVERY', 'DELIVERED', 'PAID')).toBe(false);
    expect(isReceivable('DELIVERY', 'DISPATCHED', 'UNPAID')).toBe(false);
    expect(isReceivable('TAKEOUT', 'DELIVERED', 'UNPAID')).toBe(false);
  });
});
