import { ORDER_STATUS_LABELS, type OrderStatus, type OrderType, deliveredLabel } from '@app/shared';
import {
  Bike,
  ChefHat,
  CircleCheckBig,
  CircleX,
  Hourglass,
  PackageCheck,
  ThumbsUp,
} from 'lucide-react';
import { cn } from '../lib/utils';

/** Theme token classes per order status (colors live in the theme, see globals.css). */
export const ORDER_STATUS_STYLES: Record<
  OrderStatus,
  { dot: string; badge: string; border: string }
> = {
  PENDING: {
    dot: 'bg-status-pending',
    badge: 'bg-status-pending/15 text-status-pending',
    border: 'border-l-status-pending',
  },
  ACCEPTED: {
    dot: 'bg-status-accepted',
    badge: 'bg-status-accepted/15 text-status-accepted',
    border: 'border-l-status-accepted',
  },
  PREPARING: {
    dot: 'bg-status-preparing',
    badge: 'bg-status-preparing/15 text-status-preparing',
    border: 'border-l-status-preparing',
  },
  READY: {
    dot: 'bg-status-ready',
    badge: 'bg-status-ready/15 text-status-ready',
    border: 'border-l-status-ready',
  },
  DISPATCHED: {
    dot: 'bg-status-dispatched',
    badge: 'bg-status-dispatched/15 text-status-dispatched',
    border: 'border-l-status-dispatched',
  },
  DELIVERED: {
    dot: 'bg-status-delivered',
    badge: 'bg-status-delivered/15 text-status-delivered',
    border: 'border-l-status-delivered',
  },
  CANCELED: {
    dot: 'bg-status-canceled',
    badge: 'bg-status-canceled/15 text-status-canceled',
    border: 'border-l-status-canceled',
  },
};

/** One icon per status: the badge never depends on color alone. */
export const ORDER_STATUS_ICONS = {
  PENDING: Hourglass,
  ACCEPTED: ThumbsUp,
  PREPARING: ChefHat,
  READY: PackageCheck,
  DISPATCHED: Bike,
  DELIVERED: CircleCheckBig,
  CANCELED: CircleX,
} as const;

/** "Entregue" / "Retirado" / "Concluído" depend on the order type. */
export function orderStatusLabel(status: OrderStatus, type: OrderType): string {
  return status === 'DELIVERED' ? deliveredLabel(type) : ORDER_STATUS_LABELS[status];
}

/** Order status: icon, text and the status color. */
export function OrderStatusBadge({
  status,
  type,
  className,
}: {
  status: OrderStatus;
  type: OrderType;
  className?: string;
}) {
  const Icon = ORDER_STATUS_ICONS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap',
        ORDER_STATUS_STYLES[status].badge,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {orderStatusLabel(status, type)}
    </span>
  );
}
