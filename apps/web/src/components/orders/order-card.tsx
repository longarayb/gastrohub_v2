'use client';

import {
  ORDER_SOURCE_LABELS,
  ORDER_TYPE_LABELS,
  type OrderSummaryDto,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  primaryNextStatus,
  requiresPaymentToClose,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { cn } from '@app/ui/lib/utils';
import { Bike, Clock, ShoppingBag, UtensilsCrossed, Wallet } from 'lucide-react';
import { DeliveryFailureBadge } from '@/components/delivery/failure';
import { PixReportedBadge } from '@/components/digital-menu/order-badges';
import { STATUS_STYLES, orderTitle } from '@/lib/orders';
import { CardFlag, elapsedLabel } from './common';
import { statusActionLabel } from './order-detail-sheet';

export const ORDER_TYPE_ICONS = {
  DINE_IN: UtensilsCrossed,
  TAKEOUT: ShoppingBag,
  DELIVERY: Bike,
} as const;

/**
 * Kanban card (D039 lists everything it shows). Built for hours of use: number and time big,
 * total tabular, alerts as flags with icon and text (never color alone), 44 px action.
 */
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
        // `relative` keeps the sr-only text inside the scrolling column (no page overflow).
        'relative rounded-lg border border-l-4 bg-card text-card-foreground transition-colors',
        STATUS_STYLES[order.status].border,
        highlight && 'ring-2 ring-status-pending ring-offset-2 ring-offset-track',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full space-y-2 rounded-t-lg p-3 text-left hover:bg-accent/40 focus-visible:-outline-offset-3"
        aria-label={`Pedido ${order.number}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              className="size-5 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="sr-only">{ORDER_TYPE_LABELS[order.type]}</span>
            <span className="text-xl leading-none font-extrabold">#{order.number}</span>
            {highlight && (
              <span className="rounded-md bg-warning px-1.5 py-0.5 text-xs font-extrabold text-warning-foreground uppercase">
                Novo
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-base font-bold">
            <Clock className="size-4 text-muted-foreground" aria-hidden />
            {elapsedLabel(since, now)}
          </span>
        </div>
        <p className="truncate text-base font-semibold">{orderTitle(order)}</p>
        {order.type === 'DELIVERY' && (order.neighborhood || order.courierName) && (
          <p className="truncate text-sm text-muted-foreground">
            {[order.neighborhood, order.courierName && `Entregador: ${order.courierName}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-muted-foreground">
            {order.itemCount} {order.itemCount === 1 ? 'item' : 'itens'}
            {order.source !== 'POS' ? ` · ${ORDER_SOURCE_LABELS[order.source]}` : ''}
          </span>
          <span className="shrink-0 text-base font-bold">{formatBRL(order.totalCents)}</span>
        </div>
        {order.expectedPaymentMethod && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Wallet className="size-4 shrink-0" aria-hidden />
            {PAYMENT_METHOD_LABELS[order.expectedPaymentMethod]}
          </p>
        )}
        {order.deliveryFailure && <DeliveryFailureBadge failure={order.deliveryFailure} />}
        {order.pixReportedAt && order.paymentStatus !== 'PAID' && <PixReportedBadge />}
        {order.draftItemCount > 0 && (
          <CardFlag tone="attention">
            {order.draftItemCount} não {order.draftItemCount === 1 ? 'enviado' : 'enviados'}
          </CardFlag>
        )}
      </button>
      {canAdvance && next && (
        <div className="border-t p-2">
          <Button
            variant={order.status === 'PENDING' ? 'default' : 'secondary'}
            className="w-full"
            loading={advancing}
            onClick={onAdvance}
          >
            {mustPay
              ? 'Receber'
              : order.deliveryFailure
                ? 'Reenviar'
                : statusActionLabel(order.type, next)}
          </Button>
        </div>
      )}
    </article>
  );
}
