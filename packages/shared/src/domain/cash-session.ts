/**
 * Cash register session ("caixa") of one operator (docs/DECISOES.md D024). Pure, cents only.
 *
 * Expected amount per payment method = payments received in this session − refunds made in
 * this session. Cash also adds the opening float and supplies ("suprimento") and subtracts
 * withdrawals ("sangria"). Cash payments enter net of change. A refund always leaves the
 * register that is open when it happens, so a closed register never changes.
 */

import { PAYMENT_METHODS, type PaymentMethod } from '../orders/payment-methods.js';
import { formatBRL } from '../utils/money.js';
import { usesCashRegister } from './payments.js';

export const CASH_MOVEMENT_TYPES = ['SUPPLY', 'WITHDRAWAL'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];
export const CASH_MOVEMENT_TYPE_LABELS: Record<CashMovementType, string> = {
  SUPPLY: 'Suprimento',
  WITHDRAWAL: 'Sangria',
};

export type CashSessionStatus = 'OPEN' | 'CLOSED';

/** Methods counted in a cash register (online/marketplace payments are not). */
export const CASH_REGISTER_METHODS: readonly PaymentMethod[] = PAYMENT_METHODS.filter((m) =>
  usesCashRegister(m),
);

export interface CashSessionInput {
  openingCents: number;
  movements: readonly { type: CashMovementType; amountCents: number }[];
  /** Payments received in this session (whatever their current status). */
  received: readonly { method: PaymentMethod; amountCents: number }[];
  /** Payments refunded in this session (the money left this register). */
  refunded: readonly { method: PaymentMethod; amountCents: number }[];
}

export interface CashMethodTotals {
  method: PaymentMethod;
  receivedCents: number;
  refundedCents: number;
  /** For cash: opening + supplies − withdrawals + received − refunded. */
  expectedCents: number;
}

export interface CashSessionTotals {
  openingCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  methods: CashMethodTotals[];
  /** Cash that should be in the drawer now. */
  expectedCashCents: number;
  expectedCents: number;
}

const sum = (values: readonly { amountCents: number }[]) =>
  values.reduce((total, v) => total + v.amountCents, 0);

export function cashSessionTotals(input: CashSessionInput): CashSessionTotals {
  const suppliesCents = sum(input.movements.filter((m) => m.type === 'SUPPLY'));
  const withdrawalsCents = sum(input.movements.filter((m) => m.type === 'WITHDRAWAL'));
  const methods = CASH_REGISTER_METHODS.map((method) => {
    const receivedCents = sum(input.received.filter((p) => p.method === method));
    const refundedCents = sum(input.refunded.filter((p) => p.method === method));
    const base = method === 'CASH' ? input.openingCents + suppliesCents - withdrawalsCents : 0;
    return {
      method,
      receivedCents,
      refundedCents,
      expectedCents: base + receivedCents - refundedCents,
    };
  });
  return {
    openingCents: input.openingCents,
    suppliesCents,
    withdrawalsCents,
    methods,
    expectedCashCents: methods.find((m) => m.method === 'CASH')!.expectedCents,
    expectedCents: methods.reduce((total, m) => total + m.expectedCents, 0),
  };
}

export interface CashCountLine {
  method: PaymentMethod;
  expectedCents: number;
  countedCents: number;
  /** counted − expected: negative = missing, positive = surplus. */
  differenceCents: number;
}

export interface CashCount {
  lines: CashCountLine[];
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
}

/**
 * Closing count: one line per method that had movement or was counted (cash always).
 * Methods not informed count as zero.
 */
export function cashSessionCount(
  totals: CashSessionTotals,
  counted: Partial<Record<PaymentMethod, number>>,
): CashCount {
  const lines = totals.methods
    .filter(
      (m) =>
        m.method === 'CASH' ||
        m.receivedCents > 0 ||
        m.refundedCents > 0 ||
        (counted[m.method] ?? 0) !== 0,
    )
    .map((m) => {
      const countedCents = counted[m.method] ?? 0;
      return {
        method: m.method,
        expectedCents: m.expectedCents,
        countedCents,
        differenceCents: countedCents - m.expectedCents,
      };
    });
  const expectedCents = lines.reduce((t, l) => t + l.expectedCents, 0);
  const countedCents = lines.reduce((t, l) => t + l.countedCents, 0);
  return { lines, expectedCents, countedCents, differenceCents: countedCents - expectedCents };
}

/** A withdrawal cannot take more cash than the drawer should have. */
export function withdrawalError(expectedCashCents: number, amountCents: number): string | null {
  if (amountCents > expectedCashCents) {
    return `Sangria maior que o dinheiro no caixa (${formatBRL(Math.max(expectedCashCents, 0))})`;
  }
  return null;
}

/** A cash refund cannot take more cash than the drawer should have either. */
export function cashRefundError(expectedCashCents: number, amountCents: number): string | null {
  if (amountCents > expectedCashCents) {
    return `Não há dinheiro suficiente neste caixa para o estorno (${formatBRL(Math.max(expectedCashCents, 0))})`;
  }
  return null;
}
