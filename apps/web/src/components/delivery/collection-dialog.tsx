'use client';

import {
  type CollectionInput,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  formatBRL,
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
import { useId, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';

/** What a courier can receive at the door (the restaurant's card machine, D030). */
const DOOR_METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'MEAL_VOUCHER'];

/** "Como o cliente pagou": method, amount and, in cash, what was handed over (change). */
export function CollectionDialog({
  open,
  onOpenChange,
  title,
  chargeCents,
  initial,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  chargeCents: number;
  initial: { method: PaymentMethod | null; receivedCents: number | null };
  confirmLabel: string;
  onConfirm: (collection: CollectionInput) => Promise<unknown>;
}) {
  const ids = { amount: useId(), received: useId() };
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState(chargeCents);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Reset when (re)opening, with what the customer said when ordering.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMethod(initial.method && DOOR_METHODS.includes(initial.method) ? initial.method : null);
      setAmount(chargeCents);
      setReceived(initial.receivedCents ?? chargeCents);
      setError(undefined);
    }
  }

  const cash = method === 'CASH';
  const change = cash ? received - amount : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!method) return setError('Escolha como o cliente pagou');
    if (cash && received < amount) return setError('O valor recebido é menor que o cobrado');
    setBusy(true);
    try {
      await onConfirm({
        method,
        amountCents: amount,
        receivedCents: cash ? received : null,
        note: null,
      });
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
            <DialogDescription>A cobrar: {formatBRL(chargeCents)}</DialogDescription>
          </DialogHeader>
          <div
            role="radiogroup"
            aria-label="Como o cliente pagou"
            className="grid grid-cols-2 gap-2"
          >
            {DOOR_METHODS.map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                variant={method === m ? 'default' : 'outline'}
                className="h-12"
                onClick={() => {
                  setMethod(m);
                  setError(undefined);
                }}
              >
                {PAYMENT_METHOD_LABELS[m]}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor cobrado" htmlFor={ids.amount}>
              <MoneyInput id={ids.amount} value={amount} onChange={setAmount} />
            </Field>
            {cash && (
              <Field
                label="Recebido"
                htmlFor={ids.received}
                hint={change > 0 ? `Troco: ${formatBRL(change)}` : undefined}
              >
                <MoneyInput id={ids.received} value={received} onChange={setReceived} />
              </Field>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" loading={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
