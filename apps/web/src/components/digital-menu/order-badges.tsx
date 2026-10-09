'use client';

import {
  CUSTOMER_REJECTION_LABELS,
  CUSTOMER_REJECTION_REASONS,
  type CustomerRejectionReason,
  type RejectOrderInput,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { Textarea } from '@app/ui/components/textarea';
import { QrCode as QrIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Field } from '@/components/form';
import { CardFlag } from '@/components/orders/common';

/** The customer said they paid by PIX (digital menu): check it, do not charge again. */
export function PixReportedBadge({ className }: { className?: string }) {
  return (
    <CardFlag tone="attention" icon={QrIcon} className={className}>
      PIX informado pelo cliente · conferir
    </CardFlag>
  );
}

/**
 * Refuse a digital menu order: a ready reason the customer sees (or a text for "Outro"),
 * an internal note the customer never sees and, for pranks, blocking the phone.
 */
export function RejectOrderDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onConfirm: (input: Omit<RejectOrderInput, 'expectedVersion'>) => Promise<unknown>;
}) {
  const ids = { text: useId(), note: useId() };
  const [reason, setReason] = useState<CustomerRejectionReason | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason(null);
      setText('');
      setNote('');
      setBlock(false);
      setError(undefined);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError('Escolha o motivo que o cliente vai ver');
    if (reason === 'OTHER' && text.trim().length < 3) {
      return setError('Escreva o motivo que o cliente vai ver');
    }
    setBusy(true);
    try {
      await onConfirm({
        reason,
        reasonText: reason === 'OTHER' ? text.trim() : null,
        internalNote: note.trim() || null,
        blockPhone: block,
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
            <DialogDescription>
              O cliente vê o motivo na página de acompanhamento do pedido.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Motivo para o cliente" className="grid gap-2">
            {CUSTOMER_REJECTION_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                variant={reason === r ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => {
                  setReason(r);
                  setError(undefined);
                }}
              >
                {CUSTOMER_REJECTION_LABELS[r]}
              </Button>
            ))}
          </div>
          {reason === 'OTHER' && (
            <Field label="Motivo que o cliente vai ver" htmlFor={ids.text}>
              <Input
                id={ids.text}
                value={text}
                maxLength={200}
                autoFocus
                onChange={(e) => {
                  setText(e.target.value);
                  setError(undefined);
                }}
              />
            </Field>
          )}
          <Field
            label="Observação interna (opcional)"
            htmlFor={ids.note}
            hint="Só a equipe vê. Nunca aparece para o cliente."
          >
            <Textarea
              id={ids.note}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Label className="flex items-start gap-2 text-sm font-normal">
            <Checkbox
              className="mt-0.5"
              checked={block}
              onCheckedChange={(v) => setBlock(v === true)}
            />
            Bloquear este telefone no cardápio digital (pedido falso ou trote)
          </Label>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" loading={busy}>
              Recusar pedido
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
