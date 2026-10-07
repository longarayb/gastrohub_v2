'use client';

import {
  type AddressInput,
  type DeliveryQuote,
  type DeliveryQuoteDto,
  type DeliveryQuoteInput,
  deliveryQuote,
  formatBRL,
  onlyDigits,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { Spinner } from '@app/ui/components/misc';
import { cn } from '@app/ui/lib/utils';
import { CircleAlert, MapPin } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';
import { quoteDelivery } from '@/lib/delivery';

/** What the composer sends: manual area, typed fee (null = the area fee) and its reason. */
export interface DeliveryChoice {
  areaId: string | null;
  feeCents: number | null;
  reason: string;
}

export const EMPTY_DELIVERY_CHOICE: DeliveryChoice = { areaId: null, feeCents: null, reason: '' };

const isComplete = (a: AddressInput) =>
  onlyDigits(a.cep ?? '').length === 8 &&
  !!a.street?.trim() &&
  !!a.number?.trim() &&
  !!a.neighborhood?.trim() &&
  !!a.city?.trim() &&
  (a.state ?? '').trim().length === 2;

/**
 * Fee of the delivery for the composer: resolves the area of the address (neighborhood or
 * radius) as it is typed; when it cannot, the operator picks the area. The fee can be changed
 * (a lower fee needs a reason; the API checks the permission and audits any change).
 */
export function useDeliveryQuote(
  address: AddressInput,
  customerAddressId: string | null,
  enabled: boolean,
) {
  const [quote, setQuote] = useState<DeliveryQuoteDto | null>(null);
  const [loading, setLoading] = useState(false);
  const complete = enabled && isComplete(address);
  // The address as a string: the quote reruns only when it really changes.
  const key = complete ? JSON.stringify(address) : '';

  useEffect(() => {
    if (!key) {
      setQuote(null);
      return;
    }
    let canceled = false;
    // Wait for the typing to settle (the geocoder allows one request per second).
    const timer = setTimeout(() => {
      setLoading(true);
      // The subtotal does not change the area: fee and minimum are recomputed locally.
      quoteDelivery({
        address: JSON.parse(key) as DeliveryQuoteInput['address'],
        subtotalCents: 0,
        customerAddressId: customerAddressId ?? undefined,
      })
        .then((q) => !canceled && setQuote(q))
        .catch(() => !canceled && setQuote(null))
        .finally(() => !canceled && setLoading(false));
    }, 600);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [key, customerAddressId]);

  return { quote, loading, complete };
}

/** Fee and time of the area for this subtotal (manual area or the resolved one). */
export function effectiveQuote(
  quote: DeliveryQuoteDto | null,
  choice: DeliveryChoice,
  subtotalCents: number,
): { areaName: string; quote: DeliveryQuote } | null {
  if (!quote || quote.reason === 'NO_AREAS') return null;
  const manual = choice.areaId ? quote.areas.find((a) => a.id === choice.areaId) : null;
  const rule = manual ?? (quote.area ? quote.areas.find((a) => a.id === quote.area!.id) : null);
  if (!rule) return null;
  return {
    areaName: rule.name,
    quote: deliveryQuote(rule, subtotalCents, quote.storeMinimumCents),
  };
}

export function DeliveryQuoteField({
  state,
  subtotalCents,
  choice,
  onChange,
  canReduce,
  errors,
}: {
  state: ReturnType<typeof useDeliveryQuote>;
  subtotalCents: number;
  choice: DeliveryChoice;
  onChange: (choice: DeliveryChoice) => void;
  /** orders:discount — a lower fee needs it (the API checks it too). */
  canReduce: boolean;
  errors: Record<string, string>;
}) {
  const ids = { fee: useId(), reason: useId(), area: useId() };
  const [editing, setEditing] = useState(false);
  const { quote, loading, complete } = state;
  const current = effectiveQuote(quote, choice, subtotalCents);
  const noAreas = quote?.reason === 'NO_AREAS';
  const suggested = current?.quote.feeCents ?? 0;
  const fee = choice.feeCents ?? suggested;
  const lower = !noAreas && choice.feeCents != null && choice.feeCents < suggested;

  if (!complete) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4" aria-hidden /> Complete o endereço para calcular a taxa de
        entrega.
      </p>
    );
  }
  if (loading && !quote) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Calculando a taxa de entrega...
      </p>
    );
  }

  // The store has no delivery areas: the fee is typed by hand, as before.
  if (noAreas || !quote) {
    return (
      <Field label="Taxa de entrega" htmlFor={ids.fee} error={errors.deliveryFeeCents}>
        <MoneyInput
          id={ids.fee}
          value={choice.feeCents ?? 0}
          onChange={(v) => onChange({ ...choice, feeCents: v })}
        />
      </Field>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Taxa de entrega">
      {quote.area && !choice.areaId ? (
        <p className="text-sm">
          <MapPin className="mr-1 inline size-4 text-muted-foreground" aria-hidden />
          Área <span className="font-medium">{quote.area.name}</span>
          {current && ` · ${current.quote.etaMinutes} min`}
        </p>
      ) : (
        <div className="space-y-2">
          {quote.message && !choice.areaId && (
            <p className="flex items-start gap-1.5 text-sm text-warning-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {quote.message}
            </p>
          )}
          <Field label="Área de entrega" htmlFor={ids.area} error={errors.deliveryAreaId}>
            <Select
              value={choice.areaId ?? ''}
              onValueChange={(v) => onChange({ ...choice, areaId: v || null })}
            >
              <SelectTrigger id={ids.area} className="w-full">
                <SelectValue placeholder="Escolha a área" />
              </SelectTrigger>
              <SelectContent>
                {quote.areas.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.paused}>
                    {a.name} · {formatBRL(a.feeCents)} · {a.etaMinutes} min
                    {a.paused ? ' (suspensa)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {current && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Taxa{' '}
              <span
                className={cn(
                  'tabular font-medium',
                  choice.feeCents != null && 'text-muted-foreground line-through',
                )}
              >
                {current.quote.freeDelivery ? 'grátis' : formatBRL(suggested)}
              </span>
              {choice.feeCents != null && (
                <span className="tabular ml-1 font-medium">{formatBRL(fee)}</span>
              )}
            </span>
            {!editing && choice.feeCents == null ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Alterar taxa
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  onChange({ ...choice, feeCents: null, reason: '' });
                }}
              >
                Usar a taxa da área
              </Button>
            )}
          </div>
          {current.quote.belowMinimum && (
            <p className="flex items-start gap-1.5 text-sm text-warning-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              Abaixo do pedido mínimo da área ({formatBRL(current.quote.minimumOrderCents)})
            </p>
          )}
          {(editing || choice.feeCents != null) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nova taxa" htmlFor={ids.fee} error={errors.deliveryFeeCents}>
                <MoneyInput
                  id={ids.fee}
                  value={fee}
                  onChange={(v) => onChange({ ...choice, feeCents: v })}
                />
              </Field>
              <Field
                label={lower ? 'Motivo da redução' : 'Motivo (opcional)'}
                htmlFor={ids.reason}
                error={errors.deliveryFeeReason}
                hint={
                  lower && !canReduce ? 'Reduzir a taxa exige permissão de desconto' : undefined
                }
              >
                <Input
                  id={ids.reason}
                  value={choice.reason}
                  maxLength={200}
                  onChange={(e) => onChange({ ...choice, reason: e.target.value })}
                />
              </Field>
            </div>
          )}
        </>
      )}
    </section>
  );
}
