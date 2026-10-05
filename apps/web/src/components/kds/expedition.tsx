'use client';

import { type KdsExpeditionDto, type KdsExpeditionOrderDto, ORDER_TYPE_LABELS } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { cn } from '@app/ui/lib/utils';
import { Bike, Check, CircleDashed, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { ORDER_TYPE_BADGE, ORDER_TYPE_STRIPE, elapsed } from './ticket-card';

function ExpeditionCard({
  order,
  couriers,
  now,
  busy,
  onServe,
  onDispatch,
}: {
  order: KdsExpeditionOrderDto;
  couriers: KdsExpeditionDto['couriers'];
  now: number;
  busy: boolean;
  onServe: (roundIds: string[]) => void;
  onDispatch: (courierId: string) => void;
}) {
  const [courier, setCourier] = useState(order.courierId ?? '');
  const ready = order.rounds.filter((r) => r.complete);
  const delivery = order.type === 'DELIVERY';

  return (
    <article
      aria-label={`Expedição pedido ${order.number}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-t-8 bg-card shadow-sm',
        ORDER_TYPE_STRIPE[order.type],
        order.complete && 'ring-4 ring-success',
      )}
    >
      <header className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold">#{order.number}</p>
          <p className="truncate text-base font-medium">{order.title}</p>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-sm font-semibold',
              ORDER_TYPE_BADGE[order.type],
            )}
          >
            {ORDER_TYPE_LABELS[order.type]}
          </span>
        </div>
        {order.complete && (
          <span className="rounded-md bg-success px-2 py-1 text-base font-bold text-success-foreground">
            Pronto para sair
          </span>
        )}
      </header>
      <ul className="flex-1 space-y-2 border-t p-3">
        {order.rounds.map((round) => (
          <li key={round.roundId} className="space-y-1.5">
            <p className="flex justify-between text-sm text-muted-foreground">
              <span>{order.rounds.length > 1 ? `Rodada ${round.number}` : 'Itens'}</span>
              <span className="tabular">{elapsed(round.sentAt, now)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {round.sectors.map((s) => {
                const done = s.ready === s.total;
                return (
                  <span
                    key={s.sectorId}
                    className={cn(
                      'flex items-center gap-1 rounded-md border px-2 py-1 text-base font-semibold',
                      done ? 'border-success bg-success/15 text-success' : 'text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="size-4" /> : <CircleDashed className="size-4" />}
                    {s.name} {s.ready}/{s.total}
                  </span>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <footer className="border-t p-3">
        {delivery ? (
          <div className="flex flex-col gap-2">
            <Select value={courier} onValueChange={setCourier}>
              <SelectTrigger aria-label="Entregador" className="h-12 w-full text-base">
                <SelectValue placeholder="Entregador" />
              </SelectTrigger>
              <SelectContent className="dark">
                {couriers.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-base">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-12 text-base"
              disabled={busy || !order.complete || !courier}
              onClick={() => onDispatch(courier)}
            >
              <Bike /> Saiu para entrega
            </Button>
          </div>
        ) : (
          <Button
            className="h-12 w-full text-base"
            disabled={busy || ready.length === 0}
            onClick={() => onServe(ready.map((r) => r.roundId))}
          >
            <PackageCheck /> Entregue
            {ready.length > 0 && ready.length < order.rounds.length
              ? ` (rodada ${ready.map((r) => r.number).join(', ')})`
              : ''}
          </Button>
        )}
      </footer>
    </article>
  );
}

export function ExpeditionBoard({
  data,
  now,
  busy,
  onServe,
  onDispatch,
}: {
  data: KdsExpeditionDto;
  now: number;
  busy: boolean;
  onServe: (order: KdsExpeditionOrderDto, roundIds: string[]) => void;
  onDispatch: (order: KdsExpeditionOrderDto, courierId: string) => void;
}) {
  if (!data.orders.length) {
    return (
      <p className="p-10 text-center text-xl text-muted-foreground">Nada para expedir agora.</p>
    );
  }
  // Complete orders first (they are waiting at the counter).
  const orders = [...data.orders].sort(
    (a, b) => Number(b.complete) - Number(a.complete) || a.number - b.number,
  );
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
      {orders.map((order) => (
        <ExpeditionCard
          key={order.orderId}
          order={order}
          couriers={data.couriers}
          now={now}
          busy={busy}
          onServe={(ids) => onServe(order, ids)}
          onDispatch={(id) => onDispatch(order, id)}
        />
      ))}
    </div>
  );
}
