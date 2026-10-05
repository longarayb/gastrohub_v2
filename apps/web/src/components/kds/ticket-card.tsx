'use client';

import {
  type KdsSectorDto,
  type KdsTaskDto,
  type KdsTicketDto,
  ORDER_TYPE_LABELS,
  type OrderType,
  noteParts,
  timerLevel,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { cn } from '@app/ui/lib/utils';
import { Check, Flame, Play, Undo2, X } from 'lucide-react';

export const ORDER_TYPE_STRIPE: Record<OrderType, string> = {
  DINE_IN: 'border-t-order-dine-in',
  TAKEOUT: 'border-t-order-takeout',
  DELIVERY: 'border-t-order-delivery',
};
export const ORDER_TYPE_BADGE: Record<OrderType, string> = {
  DINE_IN: 'bg-order-dine-in/20 text-order-dine-in',
  TAKEOUT: 'bg-order-takeout/20 text-order-takeout',
  DELIVERY: 'bg-order-delivery/20 text-order-delivery',
};
const TIMER_STYLE = {
  ok: 'text-muted-foreground',
  warn: 'bg-warning text-warning-foreground',
  late: 'bg-destructive text-destructive-foreground animate-pulse',
} as const;

/** "mm:ss" (or "h:mm:ss") since the ticket was sent. */
export function elapsed(sentAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(sentAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function TaskLines({ task }: { task: KdsTaskDto }) {
  const d = task.details;
  return (
    <div className="space-y-1">
      {d.comboOf && <p className="text-sm text-muted-foreground">do {d.comboOf}</p>}
      {d.size && <p className="text-base font-medium">{d.size}</p>}
      {d.flavors.map((f) => (
        <p key={`${f.name}-${f.fraction}`} className="text-base">
          {f.fraction ? <span className="font-semibold">{f.fraction} </span> : null}
          {f.name}
        </p>
      ))}
      {d.modifiers
        .filter((m) => !m.removal)
        .map((m) => (
          <p key={m.name} className="text-base">
            + {m.quantity > 1 ? `${m.quantity}× ` : ''}
            {m.name}
          </p>
        ))}
      {d.removals.length > 0 && (
        <ul className="space-y-1" aria-label="Remoções">
          {d.removals.map((r) => (
            <li
              key={r}
              className="rounded-md bg-destructive/15 px-2 py-1 text-base font-bold tracking-wide text-destructive uppercase"
            >
              {r}
            </li>
          ))}
        </ul>
      )}
      {noteParts(d.note)
        .filter((p) => !p.removal)
        .map((p) => (
          <p key={p.text} className="rounded-md bg-warning/25 px-2 py-1 text-base font-semibold">
            Obs.: {p.text}
          </p>
        ))}
    </div>
  );
}

export interface TicketActions {
  busy: boolean;
  start: (taskIds: string[]) => void;
  ready: (taskIds: string[]) => void;
  recall: (taskId: string) => void;
}

export function TicketCard({
  ticket,
  sector,
  sectorName,
  now,
  actions,
  onDismiss,
}: {
  ticket: KdsTicketDto;
  sector: KdsSectorDto | undefined;
  /** Shown when the screen mixes several sectors. */
  sectorName?: string;
  now: number;
  actions: TicketActions;
  onDismiss?: () => void;
}) {
  const level =
    ticket.doneAt || ticket.canceled || !sector
      ? 'ok'
      : timerLevel(ticket.sentAt, new Date(now), sector);
  const queued = ticket.tasks.filter((t) => t.status === 'QUEUED').map((t) => t.id);
  const open = ticket.tasks
    .filter((t) => t.status === 'QUEUED' || t.status === 'PREPARING')
    .map((t) => t.id);

  return (
    <article
      aria-label={`Pedido ${ticket.orderNumber} rodada ${ticket.roundNumber}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-t-8 bg-card text-card-foreground shadow-sm',
        ORDER_TYPE_STRIPE[ticket.orderType],
        ticket.canceled && 'border-destructive opacity-80',
        ticket.doneAt && 'opacity-70',
      )}
    >
      <header className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="min-w-0">
          <p className="text-2xl leading-tight font-bold">#{ticket.orderNumber}</p>
          <p className="truncate text-base font-medium">{ticket.title}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 font-semibold',
                ORDER_TYPE_BADGE[ticket.orderType],
              )}
            >
              {ORDER_TYPE_LABELS[ticket.orderType]}
            </span>
            {ticket.roundNumber > 1 && <span>Rodada {ticket.roundNumber}</span>}
            {sectorName && <span>· {sectorName}</span>}
          </p>
        </div>
        <span
          className={cn(
            'tabular shrink-0 rounded-md px-2 py-1 text-xl font-bold',
            TIMER_STYLE[level],
          )}
          aria-label="Tempo desde o envio"
        >
          {level === 'late' && <Flame className="mr-1 inline size-5" aria-hidden />}
          {elapsed(ticket.sentAt, now)}
        </span>
      </header>

      {ticket.canceled && (
        <p className="mx-3 mb-2 rounded-md bg-destructive px-2 py-1 text-center text-base font-bold text-destructive-foreground uppercase">
          Pedido cancelado
        </p>
      )}

      <ul className="flex-1 divide-y border-t">
        {ticket.tasks.map((task) => {
          const canceled = task.status === 'CANCELED';
          return (
            <li
              key={task.id}
              className={cn('flex gap-3 p-3', task.status === 'READY' && 'bg-success/10')}
            >
              <div
                className={cn('min-w-0 flex-1', canceled && 'line-through decoration-2 opacity-60')}
              >
                <p className="text-xl leading-snug font-bold">
                  {task.quantity}× {task.name}
                </p>
                <TaskLines task={task} />
                {canceled && !ticket.canceled && (
                  <p className="mt-1 text-sm font-bold text-destructive uppercase no-underline">
                    Cancelado
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {task.status === 'QUEUED' && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 min-w-28 text-base"
                    disabled={actions.busy}
                    onClick={() => actions.start([task.id])}
                  >
                    <Play /> Iniciar
                  </Button>
                )}
                {(task.status === 'QUEUED' || task.status === 'PREPARING') && (
                  <Button
                    size="lg"
                    className="h-12 min-w-28 text-base"
                    disabled={actions.busy}
                    onClick={() => actions.ready([task.id])}
                  >
                    <Check /> Pronto
                  </Button>
                )}
                {task.status === 'READY' && (
                  <>
                    <span className="flex items-center gap-1 text-base font-semibold text-success">
                      <Check className="size-5" /> Pronto
                    </span>
                    {!task.served && (
                      <Button
                        variant="ghost"
                        className="h-10"
                        disabled={actions.busy}
                        onClick={() => actions.recall(task.id)}
                      >
                        <Undo2 /> Desfazer
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {(open.length > 1 || (ticket.canceled && onDismiss)) && (
        <footer className="grid grid-cols-2 gap-2 border-t p-3">
          {ticket.canceled ? (
            <Button variant="outline" className="col-span-2 h-12 text-base" onClick={onDismiss}>
              <X /> Ok, retirar da tela
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-12 text-base"
                disabled={actions.busy || queued.length === 0}
                onClick={() => actions.start(queued)}
              >
                <Play /> Iniciar tudo
              </Button>
              <Button
                className="h-12 text-base"
                disabled={actions.busy}
                onClick={() => actions.ready(open)}
              >
                <Check /> Tudo pronto
              </Button>
            </>
          )}
        </footer>
      )}
    </article>
  );
}
