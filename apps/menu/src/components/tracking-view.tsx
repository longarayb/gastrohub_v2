'use client';

import {
  PAYMENT_METHOD_LABELS,
  type PublicTrackingDto,
  REALTIME_EVENTS,
  formatBRL,
  formatPhone,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { Check, CircleX, Clock, Copy, Phone } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { API_ORIGIN, clientApi } from '@/lib/api';

const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** Static PIX QR as SVG (dark modules on light, which scanners need). */
function PixQr({ value }: { value: string }) {
  const path = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let y = 0; y < qr.modules.size; y++) {
      for (let x = 0; x < qr.modules.size; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    }
    return { d, size: qr.modules.size };
  }, [value]);
  const view = path.size + 4;
  return (
    <svg
      viewBox={`-2 -2 ${view} ${view}`}
      role="img"
      aria-label="QR Code do PIX"
      className="mx-auto size-56 bg-white text-black"
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="currentColor" />
    </svg>
  );
}

/**
 * Tracking page of one order: status timeline in realtime (public channel of this order only,
 * with a polling fallback), estimated time, items and, for PIX, the QR after acceptance.
 */
export function TrackingView({
  slug,
  token,
  initial,
}: {
  slug: string;
  token: string;
  initial: PublicTrackingDto;
}) {
  const [order, setOrder] = useState(initial);
  const [busy, setBusy] = useState(false);
  const url = `/public/${slug}/orders/${token}`;

  const refresh = useCallback(() => {
    clientApi<PublicTrackingDto>(url)
      .then(setOrder)
      .catch(() => undefined);
  }, [url]);

  const active = !['DELIVERED', 'CANCELED'].includes(order.status);
  useEffect(() => {
    if (!active) return;
    const socket = io(`${API_ORIGIN}/tracking`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelayMax: 15_000,
    });
    socket.on(REALTIME_EVENTS.TRACKING_UPDATED, refresh);
    socket.on('connect', refresh);
    // Weak mobile networks: a slow poll as a safety net, and on returning to the page.
    const poll = setInterval(refresh, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [active, token, refresh]);

  async function reportPix() {
    setBusy(true);
    try {
      setOrder(await clientApi<PublicTrackingDto>(`${url}/pix-reported`, { method: 'POST' }));
      toast.success('Obrigado! O restaurante vai conferir o pagamento.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível avisar');
    } finally {
      setBusy(false);
    }
  }

  const current = order.steps.find((s) => s.current);
  return (
    <main className="mx-auto max-w-xl space-y-5 p-4">
      <header className="space-y-1">
        <Link
          href={`/${slug}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {order.store.name}
        </Link>
        <h1 className="text-2xl font-bold">Pedido #{order.number}</h1>
        {order.canceled ? (
          <p className="flex items-center gap-2 font-medium text-destructive" role="status">
            <CircleX className="size-5" aria-hidden /> Pedido não aceito: {order.canceled.message}
          </p>
        ) : (
          <p className="text-lg font-medium" role="status">
            {order.status === 'DELIVERED'
              ? order.type === 'DELIVERY'
                ? 'Pedido entregue. Bom apetite!'
                : 'Pedido retirado. Bom apetite!'
              : current?.label}
          </p>
        )}
        {order.estimatedAt && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-4" aria-hidden />
            {order.type === 'DELIVERY' ? 'Previsão de entrega' : 'Pronto para retirar'} por volta
            das {time(order.estimatedAt)}
          </p>
        )}
      </header>

      {!order.canceled && (
        <ol className="space-y-3 rounded-xl border p-4" aria-label="Andamento do pedido">
          {order.steps.map((s) => (
            <li key={s.key} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2',
                  s.done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30',
                  s.current && 'animate-pulse',
                )}
              >
                {s.done && <Check className="size-4" aria-hidden />}
              </span>
              <span
                className={cn(
                  'flex-1',
                  !s.done && 'text-muted-foreground',
                  s.current && 'font-semibold',
                )}
              >
                {s.label}
              </span>
              {s.at && <span className="tabular text-sm text-muted-foreground">{time(s.at)}</span>}
            </li>
          ))}
        </ol>
      )}

      {order.pix && !order.paid && (
        <section
          className="space-y-3 rounded-xl border p-4 text-center"
          aria-label="Pagamento com PIX"
        >
          <h2 className="font-semibold">Pague com PIX · {formatBRL(order.pix.amountCents)}</h2>
          <PixQr value={order.pix.brCode} />
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              void navigator.clipboard
                .writeText(order.pix!.brCode)
                .then(() => toast.success('Código PIX copiado'))
            }
          >
            <Copy /> Copiar código PIX
          </Button>
          {order.pixReportedAt ? (
            <p className="text-sm text-success">
              Você avisou que pagou às {time(order.pixReportedAt)}. O restaurante vai conferir.
            </p>
          ) : (
            <Button className="w-full" loading={busy} onClick={() => void reportPix()}>
              Já paguei
            </Button>
          )}
        </section>
      )}

      <section className="space-y-2 rounded-xl border p-4 text-sm" aria-label="Resumo do pedido">
        <ul className="space-y-2">
          {order.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="tabular w-6 font-medium">{item.quantity}×</span>
              <span className="flex-1">
                {item.name}
                {item.details && (
                  <span className="block text-muted-foreground">{item.details}</span>
                )}
              </span>
              <span className="tabular">{formatBRL(item.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t pt-2">
          {order.discountCents > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Descontos</dt>
              <dd className="tabular">− {formatBRL(order.discountCents)}</dd>
            </div>
          )}
          {order.type === 'DELIVERY' && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Entrega{order.neighborhood ? ` · ${order.neighborhood}` : ''}
              </dt>
              <dd className="tabular">
                {order.deliveryFeeCents ? formatBRL(order.deliveryFeeCents) : 'Grátis'}
              </dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{formatBRL(order.totalCents)}</dd>
          </div>
          {order.paymentMethod && (
            <p className="text-muted-foreground">
              Pagamento {order.type === 'DELIVERY' ? 'na entrega' : 'na retirada'}:{' '}
              {PAYMENT_METHOD_LABELS[order.paymentMethod]}
              {order.changeForCents ? ` · troco para ${formatBRL(order.changeForCents)}` : ''}
              {order.paid ? ' · pago' : ''}
            </p>
          )}
        </dl>
      </section>

      {order.store.phone && (
        <Button asChild variant="outline" className="w-full">
          <a href={`tel:+55${order.store.phone}`}>
            <Phone /> Falar com o restaurante · {formatPhone(order.store.phone)}
          </a>
        </Button>
      )}
      <Button asChild variant="ghost" className="w-full">
        <Link href={`/${slug}`}>Voltar ao cardápio</Link>
      </Button>
    </main>
  );
}
