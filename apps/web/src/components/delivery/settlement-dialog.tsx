'use client';

import {
  type CourierDetailDto,
  DELIVERY_FAILURE_LABELS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  formatBRL,
  payoutError,
  settlementSummary,
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
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';
import { formatClock } from '@/components/orders/common';
import { errorMessage } from '@/lib/api';
import { cashKeys } from '@/lib/cash';
import { deliveryKeys, settleCourier, useSettlementPreview } from '@/lib/delivery';
import { orderKeys } from '@/lib/orders';
import { printSettlement } from '@/lib/printing';

const METHODS: PaymentMethod[] = [
  'CASH',
  'PIX',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'MEAL_VOUCHER',
  'ONLINE',
];

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'bad' | 'good';
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={cn(!strong && 'text-muted-foreground')}>{label}</dt>
      <dd
        className={cn(
          'tabular',
          strong && 'font-semibold',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-success',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const signed = (cents: number) =>
  cents === 0 ? formatBRL(0) : `${cents > 0 ? '+' : '−'}${formatBRL(Math.abs(cents))}`;

/**
 * Courier settlement into the operator's open register (D031): what was collected becomes
 * payments of the orders; counted cash and card slips vs expected; pay now or accumulate.
 */
export function SettlementDialog({
  courier,
  onOpenChange,
}: {
  courier: CourierDetailDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!courier} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {courier && <SettlementForm courier={courier} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SettlementForm({ courier, onDone }: { courier: CourierDetailDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const preview = useSettlementPreview(courier.id);
  const ids = { cash: useId(), card: useId(), pay: useId(), notes: useId() };
  const [methods, setMethods] = useState<Record<string, PaymentMethod>>({});
  const [countedCash, setCountedCash] = useState<number | null>(null);
  const [countedCard, setCountedCard] = useState<number | null>(null);
  const [payNow, setPayNow] = useState(true);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [deduct, setDeduct] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (preview.isLoading || !preview.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Acerto · {courier.name}</DialogTitle>
        </DialogHeader>
        <Skeleton className="h-64" />
      </>
    );
  }

  const p = preview.data;
  const settleable = p.runs.filter((r) => r.pending === 0);
  const onRoute = p.runs.filter((r) => r.pending > 0);
  const stops = p.stops.map((s) => ({ ...s, method: methods[s.stopId] ?? s.method }));
  const charged = stops.filter((s) => s.status === 'DELIVERED' && s.balanceCents > 0);
  const base = settlementSummary({
    stops: charged,
    countedCashCents: 0,
    countedCardCents: 0,
    earningsCents: p.earnings.totalCents,
    previousBalanceCents: p.previousBalanceCents,
    payoutCents: 0,
    deductShortage: false,
  });
  const cash = countedCash ?? base.expectedCashCents;
  const card = countedCard ?? base.expectedCardCents;
  const beforePay = settlementSummary({
    stops: charged,
    countedCashCents: cash,
    countedCardCents: card,
    earningsCents: p.earnings.totalCents,
    previousBalanceCents: p.previousBalanceCents,
    payoutCents: 0,
    deductShortage: deduct,
  });
  const available = beforePay.newBalanceCents;
  const pay = payNow ? (payAmount ?? Math.max(available, 0)) : 0;
  const summary = settlementSummary({
    stops: charged,
    countedCashCents: cash,
    countedCardCents: card,
    earningsCents: p.earnings.totalCents,
    previousBalanceCents: p.previousBalanceCents,
    payoutCents: pay,
    deductShortage: deduct,
  });
  const payError = pay > 0 ? payoutError(available, pay) : null;

  async function submit() {
    setBusy(true);
    try {
      const result = await settleCourier({
        courierId: courier.id,
        runIds: settleable.map((r) => r.id),
        stops: charged.map((s) => ({ stopId: s.stopId, method: s.method })),
        countedCashCents: cash,
        countedCardCents: card,
        payNowCents: pay,
        deductShortage: deduct,
        notes: notes.trim() || null,
      });
      toast.success(
        `Acerto de ${courier.name} concluído · saldo ${formatBRL(result.newBalanceCents)}`,
        {
          // Paper receipt for the courier, on the cash printer (when there is a print agent).
          action: {
            label: 'Imprimir',
            onClick: () =>
              void printSettlement(result.id).then(
                () => toast.success('Acerto enviado para a impressora do caixa'),
                (error) => toast.error(errorMessage(error)),
              ),
          },
        },
      );
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    }
  }

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Acerto · {courier.name}</DialogTitle>
        <DialogDescription>
          O que o entregador recebeu entra no seu caixa como pagamento dos pedidos.
        </DialogDescription>
      </DialogHeader>

      {onRoute.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-warning/15 p-2 text-sm text-warning-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Saída das {formatClock(onRoute[0]!.departedAt)} ainda em rota (
          {onRoute.reduce((t, r) => t + r.pending, 0)} entrega(s) em aberto): fica para o próximo
          acerto.
        </p>
      )}
      {settleable.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada a acertar agora.</p>
      ) : (
        <>
          <section className="space-y-2" aria-label="Entregas">
            <h3 className="text-sm font-medium">
              Entregas ({settleable.length} {settleable.length === 1 ? 'saída' : 'saídas'})
            </h3>
            <ul className="divide-y rounded-md border text-sm">
              {stops.map((s) => (
                <li key={s.stopId} className="flex flex-wrap items-center gap-2 p-2.5">
                  <span className="w-12 font-medium">#{s.orderNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{s.customerName ?? 'Cliente'}</span>
                  {s.status === 'FAILED' ? (
                    <span className="text-xs text-destructive">
                      Não entregue
                      {s.failureReason ? ` · ${DELIVERY_FAILURE_LABELS[s.failureReason]}` : ''}
                    </span>
                  ) : s.balanceCents === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {s.orderStatus === 'CANCELED' ? 'Cancelado' : 'Já pago'}
                    </span>
                  ) : (
                    <>
                      <span className="tabular font-medium">{formatBRL(s.balanceCents)}</span>
                      <Select
                        value={s.method}
                        onValueChange={(v) =>
                          setMethods((m) => ({ ...m, [s.stopId]: v as PaymentMethod }))
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-40"
                          aria-label={`Forma de pagamento do pedido ${s.orderNumber}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {PAYMENT_METHOD_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!s.declared && (
                        <span className="w-full text-right text-xs text-muted-foreground">
                          não informado pelo entregador: confira
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Conferência</h3>
              <Field
                label={`Dinheiro (esperado ${formatBRL(summary.expectedCashCents)})`}
                htmlFor={ids.cash}
              >
                <MoneyInput id={ids.cash} value={cash} onChange={setCountedCash} />
              </Field>
              <Field
                label={`Comprovantes de cartão (esperado ${formatBRL(summary.expectedCardCents)})`}
                htmlFor={ids.card}
              >
                <MoneyInput id={ids.card} value={card} onChange={setCountedCard} />
              </Field>
              <dl className="space-y-1 text-sm">
                <Row
                  label="Diferença no dinheiro"
                  value={signed(summary.cashDifferenceCents)}
                  tone={summary.cashDifferenceCents < 0 ? 'bad' : undefined}
                />
                <Row
                  label="Diferença no cartão"
                  value={signed(summary.cardDifferenceCents)}
                  tone={summary.cardDifferenceCents < 0 ? 'bad' : undefined}
                />
                {summary.otherCents > 0 && (
                  <Row label="PIX e outros (sem contagem)" value={formatBRL(summary.otherCents)} />
                )}
              </dl>
              {summary.cashDifferenceCents < 0 && (
                <Label className="flex items-start gap-2 text-sm font-normal">
                  <Checkbox
                    className="mt-0.5"
                    checked={deduct}
                    onCheckedChange={(v) => setDeduct(v === true)}
                  />
                  Descontar a falta da remuneração do entregador
                </Label>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium">Remuneração</h3>
              <dl className="space-y-1 text-sm">
                <Row label="Por entrega" value={formatBRL(p.earnings.perDeliveryCents)} />
                <Row label="% da taxa de entrega" value={formatBRL(p.earnings.feeShareCents)} />
                <Row
                  label={p.includesDaily ? 'Diária (1º acerto do dia)' : 'Diária (já paga hoje)'}
                  value={formatBRL(p.earnings.dailyCents)}
                />
                <Row label="Saldo anterior" value={signed(p.previousBalanceCents)} />
                {summary.shortageDeductedCents > 0 && (
                  <Row
                    label="Falta descontada"
                    value={`−${formatBRL(summary.shortageDeductedCents)}`}
                  />
                )}
                <Row label="Disponível" value={formatBRL(available)} strong />
              </dl>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pagamento">
                <Button
                  type="button"
                  role="radio"
                  aria-checked={payNow}
                  variant={payNow ? 'default' : 'outline'}
                  onClick={() => setPayNow(true)}
                  disabled={available <= 0}
                >
                  Pagar agora
                </Button>
                <Button
                  type="button"
                  role="radio"
                  aria-checked={!payNow}
                  variant={!payNow ? 'default' : 'outline'}
                  onClick={() => setPayNow(false)}
                >
                  Acumular
                </Button>
              </div>
              {payNow && available > 0 && (
                <Field
                  label="Valor pago (sangria do caixa)"
                  htmlFor={ids.pay}
                  error={payError ?? undefined}
                >
                  <MoneyInput id={ids.pay} value={pay} onChange={setPayAmount} />
                </Field>
              )}
              <dl className="space-y-1 border-t pt-2 text-sm">
                <Row
                  label="Novo saldo do entregador"
                  value={formatBRL(summary.newBalanceCents)}
                  strong
                />
                {summary.courierOwesCents > 0 && (
                  <Row
                    label="Entregador deve à loja"
                    value={formatBRL(summary.courierOwesCents)}
                    tone="bad"
                  />
                )}
              </dl>
            </div>
          </section>

          <Field label="Observação (opcional)" htmlFor={ids.notes}>
            <Input
              id={ids.notes}
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Voltar
        </Button>
        <Button
          loading={busy}
          disabled={settleable.length === 0 || !!payError}
          onClick={() => void submit()}
        >
          Concluir acerto
        </Button>
      </DialogFooter>
    </div>
  );
}
