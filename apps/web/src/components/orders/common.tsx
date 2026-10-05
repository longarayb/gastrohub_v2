'use client';

import {
  ORDER_STATUS_LABELS,
  type OrderStatus,
  type OrderType,
  deliveredLabel,
  elapsedMinutes,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { STATUS_STYLES } from '@/lib/orders';

export function statusLabel(status: OrderStatus, type: OrderType): string {
  return status === 'DELIVERED' ? deliveredLabel(type) : ORDER_STATUS_LABELS[status];
}

export function StatusBadge({
  status,
  type,
  className,
}: {
  status: OrderStatus;
  type: OrderType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_STYLES[status].badge,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', STATUS_STYLES[status].dot)} />
      {statusLabel(status, type)}
    </span>
  );
}

/** Current time, re-rendered every `intervalMs` (elapsed time on cards). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "agora", "12 min", "1 h 05" */
export function elapsedLabel(from: string, now: Date): string {
  const minutes = Math.max(0, elapsedMinutes(from, now));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

/** Asks for a mandatory reason (cancellations, removing the service fee). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  optional,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Reason not required (e.g. canceling an item that never reached the kitchen). */
  optional?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!optional && reason.trim().length < 3) return setError('Informe o motivo');
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch {
      // The caller already showed the error.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Field label={optional ? 'Motivo (opcional)' : 'Motivo'} error={error} htmlFor={id}>
            <Textarea
              id={id}
              value={reason}
              maxLength={300}
              autoFocus
              aria-invalid={!!error}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
