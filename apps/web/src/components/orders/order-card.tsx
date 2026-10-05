'use client';

import {
  ORDER_SOURCE_LABELS,
  type OrderSummaryDto,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  primaryNextStatus,
  requiresPaymentToClose,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { cn } from '@app/ui/lib/utils';
import { Bike, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { STATUS_STYLES, orderTitle } from '@/lib/orders';
import { elapsedLabel } from './common';
import { statusActionLabel } from './order-detail-sheet';

export const ORDER_TYPE_ICONS = {
  DINE_IN: UtensilsCrossed,
  TAKEOUT: ShoppingBag,
  DELIVERY: Bike,
} as const;

export function OrderCard({
  order,
  now,
  highlight,
  canAdvance,
  advancing,
  onOpen,
  onAdvance,
}: {
  order: OrderSummaryDto;
  now: Date;
  /** New order nobody opened yet. */
  highlight?: boolean;
  canAdvance: boolean;
  advancing: boolean;
  onOpen: () => void;
  onAdvance: () => void;
}) {
  const Icon = ORDER_TYPE_ICONS[order.type];
  const next = primaryNextStatus(order.type, order.status);
  const since = order.status === 'READY' && order.readyAt ? order.readyAt : order.createdAt;
  const mustPay =
    next === 'DELIVERED' &&
    requiresPaymentToClose(order.type) &&
    order.totalCents > order.paidCents;

  return (
    <article
      className={cn(
        'rounded-lg border border-l-4 bg-card text-card-foreground shadow-xs transition-shadow hover:shadow-md',
        STATUS_STYLES[order.status].border,
        highlight && 'ring-2 ring-status-pending',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full space-y-1.5 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Pedido ${order.number}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-semibold">
            <Icon className="size-4 text-muted-foreground" aria-hidden />#{order.number}
          </span>
          <span className="tabular text-xs text-muted-foreground">{elapsedLabel(since, now)}</span>
        </div>
        <p className="truncate text-sm">{orderTitle(order)}</p>
        {order.type === 'DELIVERY' && (order.neighborhood || order.courierName) && (
          <p className="truncate text-xs text-muted-foreground">
            {[order.neighborhood, order.courierName && `Entregador: ${order.courierName}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {order.itemCount} {order.itemCount === 1 ? 'item' : 'itens'}
            {order.source !== 'POS' ? ` · ${ORDER_SOURCE_LABELS[order.source]}` : ''}
          </span>
          <span className="tabular text-sm font-medium text-foreground">
            {formatBRL(order.totalCents)}
          </span>
        </div>
        {order.expectedPaymentMethod && (
          <p className="text-xs text-muted-foreground">
            {PAYMENT_METHOD_LABELS[order.expectedPaymentMethod]}
          </p>
        )}
        {order.draftItemCount > 0 && (
          <p className="text-xs font-medium text-warning-foreground">
            <span className="rounded bg-warning px-1.5 py-0.5">
              {order.draftItemCount} não {order.draftItemCount === 1 ? 'enviado' : 'enviados'}
            </span>
          </p>
        )}
      </button>
      {canAdvance && next && (
        <div className="border-t p-2">
          <Button
            size="sm"
            variant={order.status === 'PENDING' ? 'default' : 'secondary'}
            className="w-full"
            loading={advancing}
            onClick={onAdvance}
          >
            {mustPay ? 'Receber' : statusActionLabel(order.type, next)}
          </Button>
        </div>
      )}
    </article>
  );
}
