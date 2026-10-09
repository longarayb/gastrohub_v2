'use client';

import { type DiscountData, type OrderDetailDto, discountAmount, formatBRL } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { useEffect, useId, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';

/** Discount as value (cents) or percentage (basis points), with an R$ / % toggle. */
export function DiscountInput({
  value,
  onChange,
  id,
}: {
  value: DiscountData;
  onChange: (value: DiscountData) => void;
  id?: string;
}) {
  return (
    <div className="flex gap-2">
      <div
        className="inline-flex rounded-md border p-0.5"
        role="group"
        aria-label="Tipo de desconto"
      >
        {(['VALUE', 'PERCENT'] as const).map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={value.type === type}
            className={cn(
              'min-w-11 rounded-md px-2.5 text-sm font-bold',
              value.type === type ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            )}
            onClick={() => type !== value.type && onChange({ type, value: 0 })}
          >
            {type === 'VALUE' ? 'R$' : '%'}
          </button>
        ))}
      </div>
      {value.type === 'VALUE' ? (
        <MoneyInput
          id={id}
          value={value.value}
          onChange={(v) => onChange({ ...value, value: v })}
        />
      ) : (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={0.5}
          className="tabular text-right"
          value={value.value / 100}
          onChange={(e) =>
            onChange({ ...value, value: Math.round(Number(e.target.value || 0) * 100) })
          }
        />
      )}
    </div>
  );
}

/** Order-level discount (applied after item discounts, before the coupon). */
export function OrderDiscountDialog({
  order,
  open,
  onOpenChange,
  onSubmit,
}: {
  order: OrderDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (discount: DiscountData | null, reason: string | null) => Promise<unknown>;
}) {
  const valueId = useId();
  const reasonId = useId();
  const [discount, setDiscount] = useState<DiscountData>({ type: 'VALUE', value: 0 });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDiscount(
      order.orderDiscountType
        ? { type: order.orderDiscountType, value: order.orderDiscountValue ?? 0 }
        : { type: 'VALUE', value: 0 },
    );
    setReason(order.orderDiscountReason ?? '');
    setError(undefined);
  }, [open, order]);

  const preview = discountAmount(order.subtotalCents, discount);

  async function save(next: DiscountData | null) {
    if (next && next.value > 0 && reason.trim().length < 3) return setError('Informe o motivo');
    if (next?.type === 'PERCENT' && next.value > 10_000) return setError('Desconto acima de 100%');
    setBusy(true);
    try {
      await onSubmit(next && next.value > 0 ? next : null, next ? reason.trim() : null);
      onOpenChange(false);
    } catch {
      // Error already shown.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(discount);
          }}
        >
          <DialogHeader>
            <DialogTitle>Desconto no pedido</DialogTitle>
            <DialogDescription>
              Aplicado sobre o subtotal de {formatBRL(order.subtotalCents)}, antes do cupom e da
              taxa de serviço.
            </DialogDescription>
          </DialogHeader>
          <Field label="Desconto" htmlFor={valueId} hint={`Equivale a ${formatBRL(preview)}`}>
            <DiscountInput id={valueId} value={discount} onChange={setDiscount} />
          </Field>
          <Field label="Motivo" error={error} htmlFor={reasonId}>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={200}
              aria-invalid={!!error}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <DialogFooter>
            {order.orderDiscountType && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
                Remover desconto
              </Button>
            )}
            <Button type="submit" loading={busy}>
              Aplicar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
