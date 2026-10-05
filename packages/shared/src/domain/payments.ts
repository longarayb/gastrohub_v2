/**
 * Payments of an order (docs/DECISOES.md D023). Pure, integer cents only.
 *
 * - An order may have several payments; a partial payment leaves the tab open.
 * - The amount applied to the order never exceeds the balance. Only cash may be handed over
 *   in excess: the difference is the change (`receivedCents − amountCents`).
 * - Refunded payments no longer count as paid.
 * - Dine-in and takeout orders only close with a zero balance; delivery orders may be marked
 *   delivered with an open balance ("a receber") until the courier settles.
 */

import { formatBRL } from '../utils/money.js';
import type { OrderType } from './order-status.js';
import type { PaymentMethod } from '../orders/schemas.js';

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  REFUNDED: 'Estornado',
};

export type OrderPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export const ORDER_PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  UNPAID: 'A pagar',
  PARTIAL: 'Pago em parte',
  PAID: 'Pago',
};

/**
 * Payments made outside the system (marketplaces such as iFood, and the digital menu's online
 * payment in the future) settle the order without a cash register and never enter the
 * register's expected amounts.
 */
export function usesCashRegister(method: PaymentMethod): boolean {
  return method !== 'ONLINE';
}

/** Card brand and authorization code (NSU) are kept for reconciliation with the terminal. */
export function acceptsCardDetails(method: PaymentMethod): boolean {
  return method === 'CREDIT_CARD' || method === 'DEBIT_CARD' || method === 'MEAL_VOUCHER';
}

export const CARD_BRANDS = [
  'VISA',
  'MASTERCARD',
  'ELO',
  'AMEX',
  'HIPERCARD',
  'SODEXO',
  'TICKET',
  'VR',
  'ALELO',
  'OTHER',
] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];
export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  ELO: 'Elo',
  AMEX: 'American Express',
  HIPERCARD: 'Hipercard',
  SODEXO: 'Sodexo (Pluxee)',
  TICKET: 'Ticket',
  VR: 'VR',
  ALELO: 'Alelo',
  OTHER: 'Outra',
};

export interface PaymentRecord {
  amountCents: number;
  status: PaymentStatus;
}

export interface PaymentSummary {
  paidCents: number;
  /** What is still owed (never negative: payments never exceed the total). */
  balanceCents: number;
  status: OrderPaymentStatus;
}

/** Paid amount, balance and payment status of an order from its payments. */
export function paymentSummary(
  totalCents: number,
  payments: readonly PaymentRecord[],
): PaymentSummary {
  const paidCents = payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.amountCents, 0);
  const balanceCents = Math.max(totalCents - paidCents, 0);
  const status: OrderPaymentStatus =
    balanceCents === 0 ? 'PAID' : paidCents > 0 ? 'PARTIAL' : 'UNPAID';
  return { paidCents, balanceCents, status };
}

export interface PaymentRequest {
  method: PaymentMethod;
  /** Amount applied to the order. */
  amountCents: number;
  /** Cash handed over by the customer (cash only; defaults to the amount). */
  receivedCents?: number | null;
}

export interface PreparedPayment {
  amountCents: number;
  receivedCents: number | null;
  changeCents: number | null;
}

export type PaymentCheck = { ok: true; payment: PreparedPayment } | { ok: false; message: string };

/** Validates a payment against the order balance and computes the change (cash). */
export function preparePayment(balanceCents: number, request: PaymentRequest): PaymentCheck {
  const { method, amountCents } = request;
  if (balanceCents <= 0) return { ok: false, message: 'Esta conta já está paga' };
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, message: 'Informe o valor do pagamento' };
  }
  if (amountCents > balanceCents) {
    return {
      ok: false,
      message:
        method === 'CASH'
          ? `Valor acima do saldo (${formatBRL(balanceCents)}). Para dar troco, informe o valor recebido.`
          : `Valor acima do saldo da conta (${formatBRL(balanceCents)})`,
    };
  }
  if (method !== 'CASH') {
    if (request.receivedCents != null && request.receivedCents !== amountCents) {
      return { ok: false, message: 'Troco só em pagamentos em dinheiro' };
    }
    return { ok: true, payment: { amountCents, receivedCents: null, changeCents: null } };
  }
  const receivedCents = request.receivedCents ?? amountCents;
  if (!Number.isInteger(receivedCents) || receivedCents < amountCents) {
    return { ok: false, message: 'O valor recebido é menor que o valor do pagamento' };
  }
  return {
    ok: true,
    payment: { amountCents, receivedCents, changeCents: receivedCents - amountCents },
  };
}

/** Whether an order of this type needs a zero balance to be finished. */
export function requiresPaymentToClose(type: OrderType): boolean {
  return type !== 'DELIVERY';
}

/** pt-BR reason why the order cannot be finished yet, or null. */
export function closeError(type: OrderType, summary: PaymentSummary): string | null {
  if (!requiresPaymentToClose(type) || summary.balanceCents === 0) return null;
  return `Falta receber ${formatBRL(summary.balanceCents)} para fechar a conta`;
}

/** A delivery order finished with an open balance: the courier still has to settle it. */
export function isReceivable(
  type: OrderType,
  status: string,
  paymentStatus: OrderPaymentStatus,
): boolean {
  return type === 'DELIVERY' && status === 'DELIVERED' && paymentStatus !== 'PAID';
}
