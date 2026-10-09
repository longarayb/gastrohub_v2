/**
 * What the kanban card shows about time and money (D039). Pure functions: the API fills the
 * order summary with them and the panel only formats.
 */
import { estimatedTime } from './digital-menu.js';
import type { OrderStatus, OrderType } from './order-status.js';
import type { PaymentStatus } from './payments.js';

/** "Prazo em X min" from this many minutes before the deadline. */
export const DEADLINE_WARNING_MINUTES = 5;

/**
 * Deadline of an order, using the estimate it already has (null when it has none):
 *  - takeout: `estimatedReadyAt` (creation + takeout time of the unit), until it is READY;
 *  - delivery: the area time counted from acceptance (the same estimate the customer sees on
 *    the tracking page), until it is delivered.
 * Dine-in orders and deliveries without an area time have no deadline.
 */
export function orderDeadline(order: {
  type: OrderType;
  status: OrderStatus;
  createdAt: string;
  acceptedAt: string | null;
  estimatedReadyAt: string | null;
  deliveryEtaMinutes: number | null;
}): string | null {
  if (order.status === 'DELIVERED' || order.status === 'CANCELED') return null;
  if (order.type === 'TAKEOUT') {
    return order.status === 'READY' ? null : order.estimatedReadyAt;
  }
  if (order.type === 'DELIVERY' && order.deliveryEtaMinutes != null) {
    return estimatedTime({
      type: order.type,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt,
      etaMinutes: order.deliveryEtaMinutes,
    });
  }
  return null;
}

export type DeadlineState =
  { level: 'warning'; minutes: number } | { level: 'late'; minutes: number } | null;

/**
 * Attention when `DEADLINE_WARNING_MINUTES` or less are left ("prazo em 4 min"), critical once
 * it passed ("atrasado 6 min", at least 1 minute); nothing before that.
 */
export function deadlineState(deadlineAt: string | null, now: Date): DeadlineState {
  if (!deadlineAt) return null;
  const leftMs = new Date(deadlineAt).getTime() - now.getTime();
  if (leftMs < 0) return { level: 'late', minutes: Math.max(1, Math.floor(-leftMs / 60_000)) };
  const minutes = Math.ceil(leftMs / 60_000);
  return minutes <= DEADLINE_WARNING_MINUTES ? { level: 'warning', minutes } : null;
}

/**
 * Open balance of an order ("A receber R$ X"). While the order is open, a refund reopens the
 * debt (confirmed payments only). Once delivered, the D038 rule: total minus everything ever
 * paid, refunded payments included (a refund of a finished order is money back, not a debt).
 * Canceled orders owe nothing.
 */
export function openBalanceCents(order: {
  status: OrderStatus;
  totalCents: number;
  payments: readonly { amountCents: number; status: PaymentStatus }[];
}): number {
  if (order.status === 'CANCELED') return 0;
  const counted =
    order.status === 'DELIVERED'
      ? order.payments.filter((p) => p.status === 'CONFIRMED' || p.status === 'REFUNDED')
      : order.payments.filter((p) => p.status === 'CONFIRMED');
  const paid = counted.reduce((sum, p) => sum + p.amountCents, 0);
  return Math.max(order.totalCents - paid, 0);
}

/** Stages where an open balance is worth flagging: the order is done, money should be in. */
const BALANCE_STAGES: readonly OrderStatus[] = ['READY', 'DISPATCHED', 'DELIVERED'];

/**
 * Whether the card shows "A receber R$ X" (D039): with an open balance, from "Pronto" on
 * (ready, dispatched, delivered), or at any stage when it was partly paid. An order in
 * progress with no payment at all does not show it (most tabs and deliveries pay at the end).
 */
export function showsBalanceFlag(order: {
  status: OrderStatus;
  balanceCents: number;
  paidCents: number;
}): boolean {
  if (order.balanceCents <= 0) return false;
  return BALANCE_STAGES.includes(order.status) || order.paidCents > 0;
}
