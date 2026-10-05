'use client';

import {
  BRAND,
  CASH_MOVEMENT_TYPE_LABELS,
  CASH_REGISTER_METHODS,
  type CashMovementType,
  type CashSessionDetailDto,
  type CashSessionDto,
  type OrderSummaryDto,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  Permission,
  formatBRL,
  formatDateTime,
  formatTime,
  isFinalStatus,
  toBusinessDate,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@app/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  Printer,
  Search,
  Unlock,
  Wallet,
} from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';
import { ReasonDialog } from '@/components/orders/common';
import { EmptyState, Page } from '@/components/page';
import { CashReport } from '@/components/pos/cash-report';
import { Kbd, PrintPortal } from '@/components/pos/common';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  addCashMovement,
  cashKeys,
  closeCashSession,
  openCashSession,
  reopenCashSession,
  useCashSession,
  useCashSessions,
  useCurrentCash,
  useReceivables,
} from '@/lib/cash';
import { useHotkeys } from '@/lib/hotkeys';
import { orderTitle, useOrder, useOrderBoard } from '@/lib/orders';
import { useCurrentStore } from '@/lib/stores';

const signed = (cents: number) => (cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents));
const differenceClass = (cents: number) =>
  cents < 0 ? 'text-destructive' : cents > 0 ? 'text-success' : 'text-muted-foreground';

function useRefreshCash() {
  const queryClient = useQueryClient();
  return (session?: CashSessionDetailDto) => {
    if (session) queryClient.setQueryData(cashKeys.detail(session.id), session);
    return queryClient.invalidateQueries({ queryKey: cashKeys.all });
  };
}

// ---------------------------------------------------------------------------

function OpenCashCard() {
  const refresh = useRefreshCash();
  const id = useId();
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await refresh(await openCashSession(opening));
      toast.success('Caixa aberto');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={open}>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Abrir caixa</CardTitle>
          <CardDescription>
            Informe o troco inicial na gaveta. Pagamentos em dinheiro, PIX e cartão entram neste
            caixa até o fechamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Troco inicial" htmlFor={id}>
            <MoneyInput id={id} value={opening} onChange={setOpening} autoFocus />
          </Field>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" loading={busy}>
            <Unlock /> Abrir caixa
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function MovementDialog({
  type,
  onOpenChange,
}: {
  type: CashMovementType | null;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshCash();
  const amountId = useId();
  const reasonId = useId();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) return;
    if (amount <= 0) return setError('Informe o valor');
    if (reason.trim().length < 3) return setError('Informe o motivo');
    setBusy(true);
    try {
      await refresh(await addCashMovement({ type, amountCents: amount, reason: reason.trim() }));
      toast.success(`${CASH_MOVEMENT_TYPE_LABELS[type]} registrado`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!type} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {type && (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{CASH_MOVEMENT_TYPE_LABELS[type]}</DialogTitle>
              <DialogDescription>
                {type === 'WITHDRAWAL'
                  ? 'Retirada de dinheiro da gaveta (depósito, cofre, pagamento de fornecedor).'
                  : 'Entrada de dinheiro na gaveta (reforço de troco).'}
              </DialogDescription>
            </DialogHeader>
            <Field label="Valor" htmlFor={amountId}>
              <MoneyInput
                id={amountId}
                value={amount}
                autoFocus
                onChange={(v) => {
                  setAmount(v);
                  setError(undefined);
                }}
              />
            </Field>
            <Field label="Motivo" htmlFor={reasonId} error={error}>
              <Textarea
                id={reasonId}
                value={reason}
                maxLength={300}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(undefined);
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="submit" loading={busy}>
                Registrar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Closing count. In blind mode the expected amounts only appear after confirming. */
function CloseCashDialog({
  session,
  open,
  onOpenChange,
  onClosed,
}: {
  session: CashSessionDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: (session: CashSessionDetailDto) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefreshCash();
  const [counts, setCounts] = useState<Partial<Record<PaymentMethod, number>>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const expected = session.totals
    ? Object.fromEntries(session.totals.methods.map((m) => [m.method, m.expectedCents]))
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const closed = await closeCashSession(session.id, {
        expectedVersion: session.version,
        counts: CASH_REGISTER_METHODS.map((method) => ({
          method,
          countedCents: counts[method] ?? 0,
        })).filter((c) => c.method === 'CASH' || c.countedCents > 0),
        notes: notes.trim() || null,
      });
      await refresh(closed);
      onClosed(closed);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: cashKeys.all });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Fechar caixa</DialogTitle>
            <DialogDescription>
              {expected
                ? 'Conte a gaveta e os comprovantes e informe os valores de cada forma.'
                : 'Fechamento cego: conte a gaveta e os comprovantes e informe os valores. A diferença aparece depois de confirmar.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {CASH_REGISTER_METHODS.map((method, i) => (
              <Field
                key={method}
                label={PAYMENT_METHOD_LABELS[method]}
                hint={expected ? `Esperado: ${formatBRL(expected[method] ?? 0)}` : undefined}
              >
                <MoneyInput
                  aria-label={`Contado em ${PAYMENT_METHOD_LABELS[method]}`}
                  value={counts[method] ?? 0}
                  autoFocus={i === 0}
                  onChange={(v) => setCounts((c) => ({ ...c, [method]: v }))}
                />
              </Field>
            ))}
            <Field label="Observações (opcional)">
              <Textarea
                aria-label="Observações"
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" loading={busy}>
              <Lock /> Confirmar fechamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClosingResultDialog({
  session,
  onOpenChange,
  onPrint,
}: {
  session: CashSessionDetailDto | null;
  onOpenChange: (open: boolean) => void;
  onPrint: (session: CashSessionDetailDto) => void;
}) {
  return (
    <Dialog open={!!session} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {session && (
          <>
            <DialogHeader>
              <DialogTitle>Caixa fechado</DialogTitle>
              <DialogDescription>
                Diferença total:{' '}
                <span
                  className={cn('font-semibold', differenceClass(session.differenceCents ?? 0))}
                >
                  {signed(session.differenceCents ?? 0)}
                </span>
              </DialogDescription>
            </DialogHeader>
            <CountTable session={session} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onPrint(session)}>
                <Printer /> Imprimir relatório
              </Button>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CountTable({ session }: { session: CashSessionDto }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-medium">Forma</th>
          <th className="py-1 text-right font-medium">Esperado</th>
          <th className="py-1 text-right font-medium">Contado</th>
          <th className="py-1 text-right font-medium">Diferença</th>
        </tr>
      </thead>
      <tbody className="tabular divide-y">
        {session.counts.map((c) => (
          <tr key={c.method}>
            <td className="py-1.5">{PAYMENT_METHOD_LABELS[c.method]}</td>
            <td className="py-1.5 text-right">{formatBRL(c.expectedCents)}</td>
            <td className="py-1.5 text-right">{formatBRL(c.countedCents)}</td>
            <td className={cn('py-1.5 text-right font-medium', differenceClass(c.differenceCents))}>
              {signed(c.differenceCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------

/** F2: find an open order or table and receive (F4). */
function ReceivePanel({
  inputRef,
  onReceive,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onReceive: (orderId: string) => void;
}) {
  const { data: board } = useOrderBoard();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const results = (board ?? [])
    .filter((o) => !isFinalStatus(o.status) && o.paymentStatus !== 'PAID')
    .filter(
      (o) =>
        !term ||
        String(o.number) === term ||
        o.publicCode.toLowerCase() === term ||
        orderTitle(o).toLowerCase().includes(term) ||
        o.tableNames.some((t) => t.toLowerCase() === term),
    )
    .slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Receber <Kbd>F2</Kbd>
        </CardTitle>
        <CardDescription>Busque pelo número do pedido, mesa ou cliente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            placeholder="Nº do pedido, mesa ou cliente"
            aria-label="Buscar pedido ou mesa"
            className="pl-8"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) onReceive(results[0].id);
            }}
          />
        </div>
        <ul className="divide-y rounded-md border">
          {results.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">Nenhuma conta em aberto.</li>
          )}
          {results.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 p-2.5 text-left text-sm hover:bg-accent"
                onClick={() => onReceive(o.id)}
              >
                <span className="w-12 font-semibold">#{o.number}</span>
                <span className="flex-1 truncate">{orderTitle(o)}</span>
                <span className="tabular">{formatBRL(o.totalCents - o.paidCents)}</span>
                {i === 0 && term && <Kbd>Enter</Kbd>}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReceivablesCard({ onReceive }: { onReceive: (orderId: string) => void }) {
  const { data: receivables } = useReceivables();
  if (!receivables?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery a receber</CardTitle>
        <CardDescription>
          Entregues com saldo em aberto: receba quando o entregador acertar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border">
          {receivables.map((o: OrderSummaryDto) => (
            <li key={o.id} className="flex items-center gap-3 p-2.5 text-sm">
              <span className="w-12 font-semibold">#{o.number}</span>
              <span className="flex-1 truncate">
                {orderTitle(o)}
                {o.courierName ? ` · ${o.courierName}` : ''}
              </span>
              <span className="tabular">{formatBRL(o.totalCents - o.paidCents)}</span>
              <Button size="sm" variant="outline" onClick={() => onReceive(o.id)}>
                Receber
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SessionSummary({ session }: { session: CashSessionDetailDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo</CardTitle>
        <CardDescription>
          Aberto às {formatTime(session.openedAt)} · troco inicial {formatBRL(session.openingCents)}{' '}
          · {session.paymentCount} pagamento(s)
          {session.reopenedAt ? ` · reaberto por ${session.reopenedByName}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {session.totals ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {session.totals.methods
              .filter((m) => m.method === 'CASH' || m.receivedCents > 0 || m.refundedCents > 0)
              .map((m) => (
                <div key={m.method} className="rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">
                    {PAYMENT_METHOD_LABELS[m.method]}
                  </dt>
                  <dd className="tabular text-lg font-semibold">{formatBRL(m.expectedCents)}</dd>
                  {m.refundedCents > 0 && (
                    <dd className="text-xs text-muted-foreground">
                      estornos {formatBRL(m.refundedCents)}
                    </dd>
                  )}
                </div>
              ))}
          </dl>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Fechamento cego: os valores esperados ficam ocultos até você informar a contagem.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MovementsCard({ session }: { session: CashSessionDetailDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Movimentações</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border text-sm">
          <li className="flex justify-between p-2.5">
            <span>Troco inicial · {formatTime(session.openedAt)}</span>
            <span className="tabular">{formatBRL(session.openingCents)}</span>
          </li>
          {session.movements.map((m) => (
            <li key={m.id} className="flex justify-between gap-3 p-2.5">
              <span className="min-w-0 truncate">
                {CASH_MOVEMENT_TYPE_LABELS[m.type]} · {formatTime(m.createdAt)} · {m.reason}
              </span>
              <span className="tabular shrink-0">
                {m.type === 'WITHDRAWAL' ? '− ' : '+ '}
                {formatBRL(m.amountCents)}
              </span>
            </li>
          ))}
          {session.payments.map((p) => (
            <li key={`${p.kind}-${p.id}`} className="flex justify-between gap-3 p-2.5">
              <span className="min-w-0 truncate">
                {p.kind === 'refunded' ? 'Estorno' : PAYMENT_METHOD_LABELS[p.method]} · pedido #
                {p.orderNumber} · {formatTime(p.at)}
                {p.kind === 'refunded' ? ` · ${PAYMENT_METHOD_LABELS[p.method]}` : ''}
              </span>
              <span className="tabular shrink-0">
                {p.kind === 'refunded' ? '− ' : '+ '}
                {formatBRL(p.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Registers of a day (managers: everyone's), with report and reopening. */
function SessionsCard({ onPrint }: { onPrint: (id: string) => void }) {
  const { can } = useAuth();
  const refresh = useRefreshCash();
  const [date, setDate] = useState(() => toBusinessDate());
  const { data: sessions, isLoading } = useCashSessions(date);
  const [reopening, setReopening] = useState<CashSessionDto | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Caixas do dia</CardTitle>
          <CardDescription>
            {can(Permission.CASH_MANAGE) ? 'Todos os operadores' : 'Os seus caixas'}
          </CardDescription>
        </div>
        <Input
          type="date"
          value={date}
          aria-label="Dia"
          className="w-40"
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : !sessions?.length ? (
          <p className="text-sm text-muted-foreground">Nenhum caixa neste dia.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-2.5">
                <span className="min-w-32 flex-1 font-medium">{s.operatorName}</span>
                <span className="text-muted-foreground">
                  {formatTime(s.openedAt)}
                  {s.closedAt ? ` – ${formatTime(s.closedAt)}` : ''}
                </span>
                {s.status === 'OPEN' ? (
                  <Badge variant="secondary">Aberto</Badge>
                ) : (
                  <span
                    className={cn('tabular font-medium', differenceClass(s.differenceCents ?? 0))}
                  >
                    {signed(s.differenceCents ?? 0)}
                  </span>
                )}
                <Button size="sm" variant="ghost" onClick={() => onPrint(s.id)}>
                  <Printer /> Relatório
                </Button>
                {s.status === 'CLOSED' && can(Permission.CASH_MANAGE) && (
                  <Button size="sm" variant="outline" onClick={() => setReopening(s)}>
                    Reabrir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ReasonDialog
        open={!!reopening}
        onOpenChange={(o) => !o && setReopening(null)}
        title={`Reabrir o caixa de ${reopening?.operatorName}?`}
        description="A contagem anterior fica na auditoria. O operador volta a receber neste caixa."
        confirmLabel="Reabrir caixa"
        onConfirm={async (reason) => {
          try {
            await refresh(await reopenCashSession(reopening!, reason));
            toast.success('Caixa reaberto');
          } catch (error) {
            toast.error(errorMessage(error));
            throw error;
          }
        }}
      />
    </Card>
  );
}

/** Prints the report of any register (loads its detail first). */
function ReportPrinter({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const { data: session } = useCashSession(sessionId);
  const store = useCurrentStore();
  if (!session || !store.data) return null;
  return (
    <PrintPortal onDone={onDone}>
      <CashReport storeName={store.data.tradeName || BRAND.name} session={session} />
    </PrintPortal>
  );
}

// ---------------------------------------------------------------------------

export default function CashPage() {
  const { data, isLoading } = useCurrentCash();
  const searchRef = useRef<HTMLInputElement>(null);
  const [movement, setMovement] = useState<CashMovementType | null>(null);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<CashSessionDetailDto | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const paying = useOrder(payingId);
  const session = data?.session ?? null;
  const donePrinting = useCallback(() => setPrinting(null), []);
  const anyDialog = !!movement || closing || !!closed || !!payingId;

  useHotkeys(
    {
      F2: () => searchRef.current?.focus(),
      F9: () => session && setMovement('WITHDRAWAL'),
    },
    !anyDialog,
  );

  return (
    <Page
      title="Caixa"
      description={
        session
          ? `Caixa de ${session.operatorName} · aberto em ${formatDateTime(session.openedAt)}`
          : 'Abertura, recebimentos, sangria e fechamento'
      }
      actions={
        session && (
          <>
            <Button variant="outline" onClick={() => setMovement('SUPPLY')}>
              <ArrowDownToLine /> Suprimento
            </Button>
            <Button variant="outline" onClick={() => setMovement('WITHDRAWAL')}>
              <ArrowUpFromLine /> Sangria <Kbd>F9</Kbd>
            </Button>
            <Button variant="outline" onClick={() => setPrinting(session.id)}>
              <Printer /> Parcial
            </Button>
            <Button onClick={() => setClosing(true)}>
              <Lock /> Fechar caixa
            </Button>
          </>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !session ? (
        <div className="space-y-6">
          <EmptyState
            icon={Wallet}
            title="Seu caixa está fechado"
            description="Abra o caixa para receber pagamentos. Pedidos pagos online (apps) não precisam de caixa."
          />
          <OpenCashCard />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <ReceivePanel inputRef={searchRef} onReceive={setPayingId} />
            <ReceivablesCard onReceive={setPayingId} />
          </div>
          <div className="space-y-6">
            <SessionSummary session={session} />
            <MovementsCard session={session} />
          </div>
        </div>
      )}
      <SessionsCard onPrint={setPrinting} />

      <MovementDialog type={movement} onOpenChange={(o) => !o && setMovement(null)} />
      {session && (
        <CloseCashDialog
          key={session.version}
          session={session}
          open={closing}
          onOpenChange={setClosing}
          onClosed={setClosed}
        />
      )}
      <ClosingResultDialog
        session={closed}
        onOpenChange={(o) => !o && setClosed(null)}
        onPrint={(s) => setPrinting(s.id)}
      />
      {paying.data && (
        <PaymentDialog
          order={paying.data}
          open={!!payingId}
          onOpenChange={(o) => !o && setPayingId(null)}
        />
      )}
      {printing && <ReportPrinter sessionId={printing} onDone={donePrinting} />}
    </Page>
  );
}
