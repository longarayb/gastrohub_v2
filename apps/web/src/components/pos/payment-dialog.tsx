'use client';

import {
  CARD_BRANDS,
  CARD_BRAND_LABELS,
  type CardBrand,
  type OrderDetailDto,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type PaymentMethod,
  Permission,
  acceptsCardDetails,
  canTransition,
  formatBRL,
  preparePayment,
  requiresPaymentToClose,
  splitEvenly,
  usesCashRegister,
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
import { Input } from '@app/ui/components/input';
import { Separator, Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { cn } from '@app/ui/lib/utils';
import { Notice } from '@app/ui/components/notice';
import {
  Banknote,
  CheckCircle2,
  CircleEllipsis,
  Copy,
  CreditCard,
  QrCode as QrCodeIcon,
  Smartphone,
  Ticket,
  Undo2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';
import { ReasonDialog, formatClock, useOrderAction } from '@/components/orders/common';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { createPayment, refundPayment, useCurrentCash, usePixCharge } from '@/lib/cash';
import { useHotkeys } from '@/lib/hotkeys';
import { changeOrderStatus, orderTitle } from '@/lib/orders';
import { PixReportedBadge } from '@/components/digital-menu/order-badges';
import { Kbd, QrCode } from './common';

/** Methods in shortcut order (keys 1–7). */
const METHODS: PaymentMethod[] = [
  'CASH',
  'PIX',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'MEAL_VOUCHER',
  'ONLINE',
  'OTHER',
];
const METHOD_ICONS: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  PIX: QrCodeIcon,
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
  MEAL_VOUCHER: Ticket,
  ONLINE: Smartphone,
  OTHER: CircleEllipsis,
};
const SHORT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CREDIT_CARD: 'Crédito',
  DEBIT_CARD: 'Débito',
  MEAL_VOUCHER: 'Vale-refeição',
  ONLINE: 'Online / app',
  OTHER: 'Outro',
};

function PixPanel({ orderId, amountCents }: { orderId: string; amountCents: number }) {
  const { data, error, isLoading } = usePixCharge(orderId, amountCents, true);
  if (isLoading) return <Skeleton className="mx-auto size-44" />;
  if (error || !data) {
    return (
      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        {errorMessage(error)}. O PIX ainda pode ser confirmado manualmente.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border p-3">
      <QrCode value={data.brCode} className="size-44" />
      <p className="text-center text-xs text-muted-foreground">
        {data.merchantName} · {formatBRL(data.amountCents)} · identificador {data.txid}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void navigator.clipboard?.writeText(data.brCode)}
      >
        <Copy /> Copiar PIX copia e cola
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Confira o recebimento no app do banco antes de confirmar.
      </p>
    </div>
  );
}

export function PaymentDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useAuth();
  const run = useOrderAction();
  const cash = useCurrentCash(open && can(Permission.CASH_OPERATE));
  const amountId = useId();
  const receivedId = useId();
  const amountRef = useRef<HTMLInputElement>(null);

  const balance = order.balanceCents;
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState(balance);
  const [received, setReceived] = useState(balance);
  const [people, setPeople] = useState(1);
  const [brand, setBrand] = useState<CardBrand | ''>('');
  const [authorization, setAuthorization] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);

  // A new balance (payment made, order changed) restarts the form with the balance.
  useEffect(() => {
    if (!open) return;
    setAmount(balance);
    setReceived(balance);
    setBrand('');
    setAuthorization('');
    setExternalRef('');
  }, [open, balance]);
  useEffect(() => {
    if (open) setPeople(1);
  }, [open, order.id]);

  const shares = people > 1 && balance > 0 ? splitEvenly(balance, people) : [];
  const check = preparePayment(balance, {
    method,
    amountCents: amount,
    receivedCents: method === 'CASH' ? received : null,
  });
  const needsRegister = usesCashRegister(method);
  const registerOpen = !!cash.data?.session;
  const canClose =
    balance === 0 &&
    requiresPaymentToClose(order.type) &&
    canTransition(order.type, order.status, 'DELIVERED');

  function choose(m: PaymentMethod) {
    setMethod(m);
    setReceived(amount);
    requestAnimationFrame(() => amountRef.current?.focus());
  }

  useHotkeys(
    Object.fromEntries(METHODS.map((m, i) => [String(i + 1), () => choose(m)])),
    open && balance > 0,
  );

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!check.ok || (needsRegister && !registerOpen)) return;
    setBusy(true);
    try {
      await run(
        () =>
          createPayment(order, {
            method,
            amountCents: check.payment.amountCents,
            receivedCents: check.payment.receivedCents,
            cardBrand: acceptsCardDetails(method) && brand ? brand : null,
            authorizationCode: acceptsCardDetails(method) ? authorization || null : null,
            externalRef: method === 'ONLINE' ? externalRef || null : null,
          }),
        check.payment.changeCents
          ? `Pagamento registrado · troco ${formatBRL(check.payment.changeCents)}`
          : 'Pagamento registrado',
      );
    } catch {
      // Toast already shown.
    } finally {
      setBusy(false);
    }
  }

  async function closeTab() {
    setBusy(true);
    try {
      await run(() => changeOrderStatus(order, 'DELIVERED'), 'Conta fechada');
      onOpenChange(false);
    } catch {
      // Toast already shown.
    } finally {
      setBusy(false);
    }
  }

  const confirmed = order.payments.filter((p) => p.status === 'CONFIRMED');
  const refundTarget = order.payments.find((p) => p.id === refunding);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Receber · #{order.number} · {orderTitle(order)}
          </DialogTitle>
          <DialogDescription>
            Total {formatBRL(order.totalCents)} · pago {formatBRL(order.paidCents)} ·{' '}
            <span className="font-medium text-foreground">saldo {formatBRL(balance)}</span>
          </DialogDescription>
        </DialogHeader>
        {/* The three numbers the cashier checks, big (docs/DESIGN.md, operation screens). */}
        <dl className="grid grid-cols-3 gap-2" aria-hidden>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Total
            </dt>
            <dd className="text-lg font-extrabold">{formatBRL(order.totalCents)}</dd>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Pago
            </dt>
            <dd className="text-lg font-extrabold">{formatBRL(order.paidCents)}</dd>
          </div>
          <div className="rounded-lg border-l-4 border-accent-blue bg-muted p-3">
            <dt className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              A receber
            </dt>
            <dd className="text-2xl leading-tight font-extrabold">{formatBRL(balance)}</dd>
          </div>
        </dl>
        {order.pixReportedAt && balance > 0 && <PixReportedBadge className="text-sm" />}

        {balance === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md bg-success/10 p-4 text-center">
            <CheckCircle2 className="size-8 text-success" />
            <p className="font-medium">Conta paga</p>
            {canClose && can(Permission.ORDERS_UPDATE_STATUS) && (
              <Button loading={busy} onClick={() => void closeTab()} autoFocus>
                {order.type === 'TAKEOUT' ? 'Confirmar retirada' : 'Fechar conta'}
              </Button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              role="radiogroup"
              aria-label="Forma de pagamento"
            >
              {METHODS.map((m, i) => {
                const Icon = METHOD_ICONS[m];
                return (
                  <Button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    variant={method === m ? 'default' : 'outline'}
                    className="h-14 justify-between px-3"
                    onClick={() => choose(m)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="size-5 shrink-0" />
                      <span className="truncate">{SHORT_LABELS[m]}</span>
                    </span>
                    <Kbd
                      className={cn(
                        method === m && 'bg-primary-foreground/20 text-primary-foreground',
                      )}
                    >
                      {i + 1}
                    </Kbd>
                  </Button>
                );
              })}
            </div>

            {needsRegister && cash.data && !registerOpen && (
              <Notice tone="attention" role="alert">
                Abra o seu caixa para receber em {PAYMENT_METHOD_LABELS[method].toLowerCase()}.{' '}
                <Link href="/caixa" className="font-bold underline">
                  Ir para o caixa
                </Link>
              </Notice>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Valor deste pagamento" htmlFor={amountId}>
                <MoneyInput
                  id={amountId}
                  ref={amountRef}
                  value={amount}
                  autoFocus
                  onChange={(v) => {
                    setAmount(v);
                    if (method === 'CASH' && received < v) setReceived(v);
                  }}
                />
              </Field>
              {method === 'CASH' && (
                <Field
                  label="Valor recebido"
                  htmlFor={receivedId}
                  hint={
                    check.ok && check.payment.changeCents
                      ? `Troco: ${formatBRL(check.payment.changeCents)}`
                      : 'Sem troco'
                  }
                >
                  <MoneyInput id={receivedId} value={received} onChange={setReceived} />
                </Field>
              )}
              {acceptsCardDetails(method) && (
                <>
                  <Field label="Bandeira (opcional)">
                    <Select value={brand} onValueChange={(v) => setBrand(v as CardBrand)}>
                      <SelectTrigger aria-label="Bandeira" className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {CARD_BRANDS.map((b) => (
                          <SelectItem key={b} value={b}>
                            {CARD_BRAND_LABELS[b]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Autorização / NSU (opcional)">
                    <Input
                      value={authorization}
                      maxLength={30}
                      aria-label="Autorização / NSU"
                      onChange={(e) =>
                        setAuthorization(e.target.value.replace(/[^A-Za-z0-9-]/g, ''))
                      }
                    />
                  </Field>
                </>
              )}
              {method === 'ONLINE' && (
                <Field
                  label="Código no app (opcional)"
                  hint="Pedido já pago no iFood, cardápio online etc. Não entra no caixa."
                >
                  <Input
                    value={externalRef}
                    maxLength={100}
                    aria-label="Código no app"
                    onChange={(e) => setExternalRef(e.target.value)}
                  />
                </Field>
              )}
            </div>

            {method === 'CASH' && check.ok && (check.payment.changeCents ?? 0) > 0 && (
              <p
                className="flex items-baseline justify-between rounded-lg border-l-4 border-signal-positive bg-muted p-3"
                aria-hidden
              >
                <span className="font-bold">Troco</span>
                <span className="text-2xl font-extrabold text-signal-positive">
                  {formatBRL(check.payment.changeCents!)}
                </span>
              </p>
            )}

            {method === 'PIX' && check.ok && (
              <PixPanel orderId={order.id} amountCents={check.payment.amountCents} />
            )}

            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Users className="size-4 text-muted-foreground" />
                Dividir o saldo por igual entre
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={people}
                  aria-label="Número de pessoas"
                  className="w-20"
                  onChange={(e) =>
                    setPeople(Math.min(30, Math.max(1, Number(e.target.value) || 1)))
                  }
                />
                pessoas
              </label>
              {shares.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {shares.map((share, i) => (
                    <Button
                      key={i}
                      type="button"
                      size="sm"
                      variant={amount === share ? 'secondary' : 'outline'}
                      className="tabular"
                      onClick={() => {
                        setAmount(share);
                        setReceived(share);
                      }}
                    >
                      {formatBRL(share)}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {!check.ok && amount > 0 && (
              <p className="text-sm text-destructive" role="alert">
                {check.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Voltar <Kbd>Esc</Kbd>
              </Button>
              <Button
                type="submit"
                loading={busy}
                disabled={!check.ok || (needsRegister && !registerOpen)}
              >
                {method === 'PIX' ? 'Confirmar PIX recebido' : 'Registrar pagamento'}
                <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
              </Button>
            </DialogFooter>
          </form>
        )}

        {order.payments.length > 0 && (
          <section className="space-y-2">
            <Separator />
            <h3 className="text-sm font-medium">Pagamentos</h3>
            <ul className="divide-y rounded-md border text-sm">
              {order.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        p.status === 'REFUNDED' && 'text-muted-foreground line-through',
                      )}
                    >
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.cardBrand ? ` · ${CARD_BRAND_LABELS[p.cardBrand]}` : ''}
                      {p.changeCents ? ` · troco ${formatBRL(p.changeCents)}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatClock(p.createdAt)}
                      {p.createdByName ? ` · ${p.createdByName}` : ''}
                      {p.status === 'REFUNDED'
                        ? ` · ${PAYMENT_STATUS_LABELS.REFUNDED.toLowerCase()}: ${p.refundReason}`
                        : ''}
                    </p>
                  </div>
                  <span className="tabular">{formatBRL(p.amountCents)}</span>
                  {p.status === 'CONFIRMED' && can(Permission.PAYMENTS_REFUND) && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Estornar ${PAYMENT_METHOD_LABELS[p.method]} de ${formatBRL(p.amountCents)}`}
                      onClick={() => setRefunding(p.id)}
                    >
                      <Undo2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {confirmed.length > 1 && (
              <p className="text-right text-xs text-muted-foreground">
                {confirmed.length} pagamentos confirmados
              </p>
            )}
          </section>
        )}

        <ReasonDialog
          open={!!refundTarget}
          onOpenChange={(o) => !o && setRefunding(null)}
          title={
            refundTarget
              ? `Estornar ${PAYMENT_METHOD_LABELS[refundTarget.method]} de ${formatBRL(refundTarget.amountCents)}?`
              : ''
          }
          description="O valor sai do seu caixa aberto agora. Fica registrado na auditoria."
          confirmLabel="Estornar"
          destructive
          onConfirm={(reason) =>
            run(() => refundPayment(order, refundTarget!.id, reason), 'Pagamento estornado')
          }
        />
      </DialogContent>
    </Dialog>
  );
}
