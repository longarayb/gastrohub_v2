'use client';

import {
  DELIVERY_FAILURE_LABELS,
  DELIVERY_FAILURE_REASONS,
  type DeliveryFailureInput,
  type DeliveryFailureReason,
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
import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { formatClock } from '@/components/orders/common';

/** "Não entregue · Cliente ausente" on the board, the expedition and the order detail. */
export function DeliveryFailureBadge({
  failure,
  className,
}: {
  failure: { reason: DeliveryFailureReason; note: string | null; at: string };
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive',
        className,
      )}
      title={failure.note ?? undefined}
    >
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        Não entregue · {DELIVERY_FAILURE_LABELS[failure.reason]}
        {failure.note ? ` (${failure.note})` : ''} · {formatClock(failure.at)}
      </span>
    </p>
  );
}

/** "Não entregue": reason (big buttons, also on the phone) and an optional note. */
export function DeliveryFailureDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onConfirm: (input: DeliveryFailureInput) => Promise<unknown>;
}) {
  const id = useId();
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
      setError(undefined);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError('Escolha o motivo');
    if (reason === 'OTHER' && note.trim().length < 3) return setError('Descreva o motivo');
    setBusy(true);
    try {
      await onConfirm({ reason, note: note.trim() || null });
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
            <DialogDescription>
              O pedido volta para a loja. Depois é possível reenviar ou cancelar.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Motivo" className="grid grid-cols-2 gap-2">
            {DELIVERY_FAILURE_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                variant={reason === r ? 'default' : 'outline'}
                className="h-auto min-h-12 whitespace-normal"
                onClick={() => {
                  setReason(r);
                  setError(undefined);
                }}
              >
                {DELIVERY_FAILURE_LABELS[r]}
              </Button>
            ))}
          </div>
          <Field
            label={reason === 'OTHER' ? 'Descreva o motivo' : 'Observação (opcional)'}
            htmlFor={id}
            error={error}
          >
            <Textarea
              id={id}
              value={note}
              maxLength={200}
              onChange={(e) => {
                setNote(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" loading={busy}>
              Confirmar: não entregue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
