/** Order types, sources and status rules (single source of truth for API and UI). */

import type { SalesChannel } from './menu-availability.js';

export const OrderType = { DINE_IN: 'DINE_IN', TAKEOUT: 'TAKEOUT', DELIVERY: 'DELIVERY' } as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];
export const ORDER_TYPES = Object.values(OrderType);

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  DINE_IN: 'Mesa',
  TAKEOUT: 'Balcão/Retirada',
  DELIVERY: 'Delivery',
};

export const OrderSource = {
  POS: 'POS',
  DIGITAL_MENU: 'DIGITAL_MENU',
  WAITER_APP: 'WAITER_APP',
  IFOOD: 'IFOOD',
  NINETY_NINE_FOOD: 'NINETY_NINE_FOOD',
  AIQFOME: 'AIQFOME',
  OPEN_DELIVERY: 'OPEN_DELIVERY',
  OTHER: 'OTHER',
} as const;
export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];
export const ORDER_SOURCES = Object.values(OrderSource);

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  POS: 'PDV',
  DIGITAL_MENU: 'Cardápio digital',
  WAITER_APP: 'App do garçom',
  IFOOD: 'iFood',
  NINETY_NINE_FOOD: '99Food',
  AIQFOME: 'Aiqfome',
  OPEN_DELIVERY: 'Open Delivery',
  OTHER: 'Outro',
};

export const OrderStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  CANCELED: 'CANCELED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUSES = Object.values(OrderStatus);

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  ACCEPTED: 'Aceito',
  PREPARING: 'Em preparo',
  READY: 'Pronto',
  DISPATCHED: 'Saiu para entrega',
  DELIVERED: 'Concluído',
  CANCELED: 'Cancelado',
};

/** Label of DELIVERED depends on the order type. */
export function deliveredLabel(type: OrderType): string {
  return type === 'DELIVERY' ? 'Entregue' : type === 'TAKEOUT' ? 'Retirado' : 'Conta fechada';
}

const S = OrderStatus;

/**
 * Allowed forward transitions per order type (CANCELED is handled separately).
 * Dine-in orders are table tabs: a new round may move READY back to PREPARING.
 */
const TRANSITIONS: Record<OrderType, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  DELIVERY: {
    PENDING: [S.ACCEPTED],
    ACCEPTED: [S.PREPARING],
    PREPARING: [S.READY],
    READY: [S.DISPATCHED],
    DISPATCHED: [S.DELIVERED],
  },
  TAKEOUT: {
    PENDING: [S.ACCEPTED],
    ACCEPTED: [S.PREPARING],
    PREPARING: [S.READY],
    READY: [S.DELIVERED],
  },
  DINE_IN: {
    PENDING: [S.ACCEPTED],
    ACCEPTED: [S.PREPARING, S.DELIVERED],
    PREPARING: [S.READY],
    READY: [S.PREPARING, S.DELIVERED],
  },
};

export const FINAL_STATUSES: readonly OrderStatus[] = [S.DELIVERED, S.CANCELED];

export const isFinalStatus = (status: OrderStatus): boolean => FINAL_STATUSES.includes(status);

/** Statuses reachable from `from` (excluding cancellation). */
export function nextStatuses(type: OrderType, from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[type][from] ?? [];
}

/** Main "advance" action of the kanban (first forward transition). */
export function primaryNextStatus(type: OrderType, from: OrderStatus): OrderStatus | null {
  const next = nextStatuses(type, from);
  // Dine-in READY: the natural next step is closing the tab, not going back to PREPARING.
  if (type === 'DINE_IN' && from === 'READY') return S.DELIVERED;
  return next[0] ?? null;
}

export function canTransition(type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  if (to === S.CANCELED) return !isFinalStatus(from);
  return nextStatuses(type, from).includes(to);
}

/** pt-BR reason why a transition is not allowed, or null when it is. */
export function transitionError(
  type: OrderType,
  from: OrderStatus,
  to: OrderStatus,
): string | null {
  if (from === to) return `O pedido já está "${ORDER_STATUS_LABELS[to]}"`;
  if (isFinalStatus(from)) return 'Este pedido já foi finalizado';
  if (canTransition(type, from, to)) return null;
  if (to === S.DISPATCHED && type !== 'DELIVERY')
    return 'Somente pedidos de delivery saem para entrega';
  return `Não é possível mudar de "${ORDER_STATUS_LABELS[from]}" para "${ORDER_STATUS_LABELS[to]}"`;
}

/**
 * Status of a new order: orders typed by staff start ACCEPTED; orders from the digital menu
 * and marketplaces start PENDING unless the store auto-accepts them.
 */
export function initialOrderStatus(source: OrderSource, autoAccept = false): OrderStatus {
  return source === 'POS' || source === 'WAITER_APP' || autoAccept ? S.ACCEPTED : S.PENDING;
}

/** Sales channel used to check menu availability for an order. */
export function salesChannelFor(type: OrderType, source: OrderSource): SalesChannel {
  if (source === 'DIGITAL_MENU') return 'DIGITAL_MENU';
  if (type === 'DINE_IN') return 'DINE_IN';
  if (type === 'DELIVERY') return 'DELIVERY';
  return 'COUNTER';
}

// ---------------------------------------------------------------------------
// Items

export const OrderItemStatus = {
  /** In a round not yet sent to the kitchen; can be removed freely. */
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'SERVED',
  CANCELED: 'CANCELED',
} as const;
export type OrderItemStatus = (typeof OrderItemStatus)[keyof typeof OrderItemStatus];
export const ORDER_ITEM_STATUSES = Object.values(OrderItemStatus);

export const ORDER_ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  DRAFT: 'Não enviado',
  QUEUED: 'Na fila',
  PREPARING: 'Preparando',
  READY: 'Pronto',
  SERVED: 'Entregue',
  CANCELED: 'Cancelado',
};

const ITEM_TRANSITIONS: Partial<Record<OrderItemStatus, OrderItemStatus[]>> = {
  DRAFT: ['QUEUED'],
  QUEUED: ['PREPARING', 'READY'],
  PREPARING: ['READY'],
  READY: ['SERVED'],
};

export function canTransitionItem(from: OrderItemStatus, to: OrderItemStatus): boolean {
  if (to === 'CANCELED') return from !== 'CANCELED' && from !== 'SERVED';
  return ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

/** An item already sent to the kitchen needs permission, reason and audit to be canceled. */
export const isSentItem = (status: OrderItemStatus): boolean =>
  status !== 'DRAFT' && status !== 'CANCELED';
