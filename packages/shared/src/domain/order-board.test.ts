import { describe, expect, it } from 'vitest';
import { deadlineState, openBalanceCents, orderDeadline } from './order-board.js';

const base = {
  createdAt: '2026-10-08T19:00:00.000Z',
  acceptedAt: '2026-10-08T19:02:00.000Z',
  estimatedReadyAt: '2026-10-08T19:20:00.000Z',
  deliveryEtaMinutes: 40,
};

describe('orderDeadline', () => {
  it('takeout: the estimated ready time, until it is ready', () => {
    expect(orderDeadline({ ...base, type: 'TAKEOUT', status: 'PREPARING' })).toBe(
      '2026-10-08T19:20:00.000Z',
    );
    expect(orderDeadline({ ...base, type: 'TAKEOUT', status: 'READY' })).toBeNull();
  });

  it('delivery: the area time from acceptance (as the customer sees), until delivered', () => {
    expect(orderDeadline({ ...base, type: 'DELIVERY', status: 'DISPATCHED' })).toBe(
      '2026-10-08T19:42:00.000Z',
    );
    expect(orderDeadline({ ...base, type: 'DELIVERY', status: 'PENDING', acceptedAt: null })).toBe(
      '2026-10-08T19:40:00.000Z',
    );
    expect(orderDeadline({ ...base, type: 'DELIVERY', status: 'DELIVERED' })).toBeNull();
    expect(
      orderDeadline({ ...base, type: 'DELIVERY', status: 'READY', deliveryEtaMinutes: null }),
    ).toBeNull();
  });

  it('dine-in and finished orders have no deadline', () => {
    expect(orderDeadline({ ...base, type: 'DINE_IN', status: 'PREPARING' })).toBeNull();
    expect(orderDeadline({ ...base, type: 'TAKEOUT', status: 'CANCELED' })).toBeNull();
  });
});

describe('deadlineState', () => {
  const deadline = '2026-10-08T19:20:00.000Z';
  const at = (time: string) => new Date(`2026-10-08T${time}Z`);

  it('nothing while more than 5 minutes are left', () => {
    expect(deadlineState(deadline, at('19:14:00'))).toBeNull();
    expect(deadlineState(null, at('19:30:00'))).toBeNull();
  });

  it('attention with 5 minutes or less', () => {
    expect(deadlineState(deadline, at('19:15:00'))).toEqual({ level: 'warning', minutes: 5 });
    expect(deadlineState(deadline, at('19:19:30'))).toEqual({ level: 'warning', minutes: 1 });
  });

  it('critical once passed, at least 1 minute', () => {
    expect(deadlineState(deadline, at('19:20:10'))).toEqual({ level: 'late', minutes: 1 });
    expect(deadlineState(deadline, at('19:26:30'))).toEqual({ level: 'late', minutes: 6 });
  });
});

describe('openBalanceCents', () => {
  const confirmed = { amountCents: 3000, status: 'CONFIRMED' as const };
  const refunded = { amountCents: 3000, status: 'REFUNDED' as const };

  it('open order: total minus confirmed payments (a refund reopens the debt)', () => {
    expect(openBalanceCents({ status: 'READY', totalCents: 5000, payments: [confirmed] })).toBe(
      2000,
    );
    expect(openBalanceCents({ status: 'READY', totalCents: 5000, payments: [refunded] })).toBe(
      5000,
    );
  });

  it('delivered: refunds do not reopen the debt (D038)', () => {
    expect(openBalanceCents({ status: 'DELIVERED', totalCents: 3000, payments: [refunded] })).toBe(
      0,
    );
    expect(openBalanceCents({ status: 'DELIVERED', totalCents: 5000, payments: [] })).toBe(5000);
  });

  it('canceled orders and pending payments', () => {
    expect(openBalanceCents({ status: 'CANCELED', totalCents: 5000, payments: [] })).toBe(0);
    expect(
      openBalanceCents({
        status: 'PREPARING',
        totalCents: 5000,
        payments: [{ amountCents: 5000, status: 'PENDING' }],
      }),
    ).toBe(5000);
  });
});
