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
import {
  AlarmClock,
  Bike,
  Check,
  Clock,
  Flame,
  Play,
  ShoppingBag,
  Undo2,
  UtensilsCrossed,
  X,
} from 'lucide-react';

// Same icons as the orders kanban.
export const ORDER_TYPE_ICONS = {
  DINE_IN: UtensilsCrossed,
  TAKEOUT: ShoppingBag,
  DELIVERY: Bike,
} as const;

export const ORDER_TYPE_STRIPE: Record<OrderType, string> = {
  DINE_IN: 'border-t-order-dine-in',
  TAKEOUT: 'border-t-order-takeout',
  DELIVERY: 'border-t-order-delivery',
};
// Color only on the background: colored text on its own tint fails 4.5:1 (axe, phase D).
export const ORDER_TYPE_BADGE: Record<OrderType, string> = {
  DINE_IN: 'bg-order-dine-in/25 text-foreground',
  TAKEOUT: 'bg-order-takeout/25 text-foreground',
  DELIVERY: 'bg-order-delivery/25 text-foreground',
};
const TIMER_STYLE = {
  ok: 'text-foreground',
  warn: 'bg-warning text-warning-foreground',
  late: 'bg-destructive text-destructive-foreground animate-pulse',
} as const;
// The level also shows as an icon (never color alone).
const TIMER_ICON = { ok: Clock, warn: AlarmClock, late: Flame } as const;

/** "mm:ss" (or "h:mm:ss") since the ticket was sent (until `now`, or until it was done). */
export function elapsed(sentAt: string, now: number | string): string {
  const end = typeof now === 'string' ? new Date(now).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(sentAt).getTime()) / 1000));
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

  const TypeIcon = ORDER_TYPE_ICONS[ticket.orderType];
  const TimerIcon = TIMER_ICON[level];

  return (
    <article
      // No fading for done or canceled tickets: the column and the flags say it, and faded text
      // fails 4.5:1 (axe).
      aria-label={`Pedido ${ticket.orderNumber} rodada ${ticket.roundNumber}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-t-4 bg-card text-card-foreground',
        ORDER_TYPE_STRIPE[ticket.orderType],
        ticket.canceled && 'border-destructive',
      )}
    >
      <header className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-2xl leading-tight font-extrabold">
            <TypeIcon className="size-6 shrink-0 text-muted-foreground" aria-hidden />#
            {ticket.orderNumber}
          </p>
          <p className="truncate text-base font-semibold">{ticket.title}</p>
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
            'tabular flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xl font-extrabold',
            TIMER_STYLE[level],
          )}
          aria-label={ticket.doneAt ? 'Tempo de preparo' : 'Tempo desde o envio'}
        >
          <TimerIcon
            className={cn('size-5', level === 'ok' && 'text-muted-foreground')}
            aria-hidden
          />
          {/* A finished ticket shows how long it took (frozen), not a running clock. */}
          {elapsed(ticket.sentAt, ticket.doneAt ?? now)}
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
                className={cn(
                  'min-w-0 flex-1',
                  canceled && 'text-muted-foreground line-through decoration-2',
                )}
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
