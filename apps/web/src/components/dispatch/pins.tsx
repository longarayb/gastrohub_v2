import { type DeadlineState, type DispatchStopStatus } from '@app/shared';
import { cn } from '@app/ui/lib/utils';
import { AlarmClock, AlarmClockOff, Bike, Check, Store, X } from 'lucide-react';

/**
 * Pin contents of the dispatch map. The deadline shows as the border color of the kanban
 * (`signal-*`) and an icon, never color alone; selected orders get a ring and their position
 * in the run.
 */
export function OrderPin({
  number,
  deadline,
  position,
  preparing,
}: {
  number: number;
  deadline: DeadlineState;
  /** 1-based position in the run being assembled. */
  position: number | null;
  preparing?: boolean;
}) {
  const Icon = deadline?.level === 'late' ? AlarmClockOff : AlarmClock;
  return (
    <span
      className={cn(
        'relative flex h-9 min-w-9 items-center justify-center gap-0.5 rounded-full border-[3px] bg-card px-2 text-sm font-extrabold text-foreground shadow-md',
        preparing
          ? 'border-dashed border-muted-foreground opacity-70'
          : deadline?.level === 'late'
            ? 'border-signal-critical'
            : deadline?.level === 'warning'
              ? 'border-signal-attention'
              : 'border-status-ready',
        position != null && 'ring-4 ring-primary',
      )}
    >
      {deadline && !preparing && (
        <Icon
          className={cn(
            'size-3.5',
            deadline.level === 'late' ? 'text-signal-critical' : 'text-signal-attention',
          )}
          aria-hidden
        />
      )}
      {number}
      {position != null && (
        <span className="absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
          {position}
        </span>
      )}
    </span>
  );
}

export function StorePin() {
  return (
    <span className="flex size-10 items-center justify-center rounded-lg border-2 border-card bg-foreground text-background shadow-md">
      <Store className="size-5" aria-hidden />
    </span>
  );
}

/** A stop of a run already on the road. */
export function StopPin({ number, status }: { number: number; status: DispatchStopStatus }) {
  return (
    <span
      className={cn(
        'flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full border-2 bg-card px-1.5 text-xs font-bold shadow',
        status === 'PENDING'
          ? 'border-status-dispatched text-foreground'
          : 'border-muted-foreground text-muted-foreground',
      )}
    >
      {status === 'DELIVERED' && <Check className="size-3" aria-hidden />}
      {status === 'FAILED' && <X className="size-3" aria-hidden />}
      {number}
    </span>
  );
}

export function CourierPin({ name, simulated }: { name: string; simulated: boolean }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className="flex size-9 items-center justify-center rounded-full border-[3px] border-status-dispatched bg-card shadow-md">
        <Bike className="size-5 text-foreground" aria-hidden />
      </span>
      <span className="rounded bg-card px-1.5 text-[11px] font-bold whitespace-nowrap text-foreground shadow">
        {name.split(' ')[0]}
        {simulated && ' · simulado'}
      </span>
    </span>
  );
}
