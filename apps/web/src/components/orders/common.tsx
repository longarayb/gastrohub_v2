'use client';

import { type OrderDetailDto, type OrderItemDto, elapsedMinutes, formatBRL } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, HandCoins } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { ApiError, errorMessage } from '@/lib/api';
import { orderKeys } from '@/lib/orders';

// The status badge (icon, text and color) lives in @app/ui.
export {
  OrderStatusBadge as StatusBadge,
  orderStatusLabel as statusLabel,
} from '@app/ui/components/status-badge';

const FLAG_TONES = {
  critical: { bar: 'border-signal-critical', icon: 'text-signal-critical' },
  attention: { bar: 'border-signal-attention', icon: 'text-signal-attention' },
  info: { bar: 'border-accent-blue', icon: 'text-accent-blue' },
} as const;

/**
 * Line on cards (deadline, failed delivery, PIX to check, items not sent, open balance): icon
 * and text in full contrast on a muted chip, the tone only on the 4 px bar and the icon
 * (never color alone).
 */
export function CardFlag({
  tone,
  icon: Icon = CircleAlert,
  title,
  className,
  children,
}: {
  tone: keyof typeof FLAG_TONES;
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // A span (phrasing content): flags also live inside the card's button.
  return (
    <span
      title={title}
      className={cn(
        'flex items-start gap-1.5 rounded-md border-l-4 bg-muted px-2 py-1 text-sm font-semibold text-foreground',
        FLAG_TONES[tone].bar,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', FLAG_TONES[tone].icon)} />
      <span>{children}</span>
    </span>
  );
}

/** "A receber R$ X": open balance of the order (`balanceCents`, D039). */
export function BalanceFlag({ cents, className }: { cents: number; className?: string }) {
  return (
    <CardFlag tone="info" icon={HandCoins} className={className}>
      A receber {formatBRL(cents)}
    </CardFlag>
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

/** Runs an order mutation: updates the cache, refreshes lists and shows errors (409 included). */
export function useOrderAction() {
  const queryClient = useQueryClient();
  return async (run: () => Promise<OrderDetailDto>, success?: string) => {
    try {
      const order = await run();
      queryClient.setQueryData(orderKeys.detail(order.id), order);
      void queryClient.invalidateQueries({ queryKey: orderKeys.board });
      void queryClient.invalidateQueries({ queryKey: orderKeys.tables });
      if (success) toast.success(success);
      return order;
    } catch (error) {
      toast.error(errorMessage(error));
      // Someone else changed the order: show the current version.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      }
      throw error;
    }
  };
}

export function ItemDescription({ item }: { item: Pick<OrderItemDto, 'snapshot' | 'notes'> }) {
  const { snapshot } = item;
  const flavorCount = snapshot.flavors.length;
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {flavorCount > 0 &&
        snapshot.flavors.map((f) => (
          <p key={f.productId}>
            {flavorCount > 1 ? `${f.fraction.numerator}/${f.fraction.denominator} ` : ''}
            {f.name}
            {f.note ? ` (${f.note})` : ''}
          </p>
        ))}
      {snapshot.modifiers.map((m) => (
        <p key={`${m.groupId}-${m.optionId}`}>
          + {m.quantity > 1 ? `${m.quantity}× ` : ''}
          {m.name}
          {m.totalCents > 0 ? ` (${formatBRL(m.totalCents)})` : ''}
        </p>
      ))}
      {snapshot.note && <p className="italic">Obs.: {snapshot.note}</p>}
    </div>
  );
}
