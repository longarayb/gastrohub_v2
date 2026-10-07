'use client';

import {
  DELIVERY_FAILURE_LABELS,
  type OrderDetailDto,
  PAYMENT_METHOD_LABELS,
  formatBRL,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { ExternalLink, Navigation } from 'lucide-react';
import { formatClock } from '@/components/orders/common';
import { formatDistance } from '@/lib/delivery';
import { DeliveryFailureBadge } from './failure';

const SOURCE_LABELS = {
  AUTO: 'pelo endereço',
  MANUAL: 'escolhida pelo operador',
  NONE: 'sem área',
} as const;

/** Delivery block of the order detail: area, time, maps, attempts. */
export function OrderDeliverySection({ order }: { order: OrderDetailDto }) {
  const d = order.delivery;
  if (!d) return null;
  const feeChanged = d.suggestedFeeCents != null && d.suggestedFeeCents !== order.deliveryFeeCents;
  return (
    <section className="space-y-2 text-sm" aria-label="Entrega">
      <h3 className="font-medium">Entrega</h3>
      {order.deliveryFailure && <DeliveryFailureBadge failure={order.deliveryFailure} />}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Área</dt>
        <dd className="text-foreground">
          {d.areaName ?? 'Sem área'}{' '}
          <span className="text-muted-foreground">({SOURCE_LABELS[d.areaSource]})</span>
        </dd>
        {d.etaMinutes != null && (
          <>
            <dt>Previsão</dt>
            <dd className="text-foreground">
              {d.etaMinutes} min
              {d.distanceMeters != null ? ` · ${formatDistance(d.distanceMeters)}` : ''}
            </dd>
          </>
        )}
        {feeChanged && (
          <>
            <dt>Taxa</dt>
            <dd className="text-foreground">
              {formatBRL(order.deliveryFeeCents)} (sugerida {formatBRL(d.suggestedFeeCents!)})
              {d.feeChangeReason ? ` · ${d.feeChangeReason}` : ''}
            </dd>
          </>
        )}
      </dl>
      {d.links && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={d.links.google} target="_blank" rel="noreferrer">
              <ExternalLink /> Google Maps
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={d.links.waze} target="_blank" rel="noreferrer">
              <Navigation /> Waze
            </a>
          </Button>
        </div>
      )}
      {d.stops.length > 0 && (
        <ol className="space-y-1 border-l pl-3" aria-label="Tentativas de entrega">
          {[...d.stops].reverse().map((s, i) => (
            <li key={s.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {i + 1}ª saída · {s.courierName}
              </span>{' '}
              às {formatClock(s.dispatchedAt)}
              {s.deliveredAt && ` · entregue às ${formatClock(s.deliveredAt)}`}
              {s.failedAt &&
                ` · não entregue (${s.failureReason ? DELIVERY_FAILURE_LABELS[s.failureReason] : ''}${s.failureNote ? `: ${s.failureNote}` : ''})`}
              {s.collectedMethod &&
                ` · cliente pagou ${PAYMENT_METHOD_LABELS[s.collectedMethod]}${s.collectedCents != null ? ` ${formatBRL(s.collectedCents)}` : ''}${s.changeCents ? ` (troco ${formatBRL(s.changeCents)})` : ''}`}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
