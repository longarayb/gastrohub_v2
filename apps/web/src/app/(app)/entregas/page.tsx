'use client';

import {
  type CourierAppDto,
  type CourierAppStopDto,
  DELIVERY_FAILURE_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  formatPhone,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Bike, Check, ExternalLink, Navigation, Phone, RotateCcw, Store } from 'lucide-react';
import { useState } from 'react';
import { CollectionDialog } from '@/components/delivery/collection-dialog';
import { DeliveryFailureDialog } from '@/components/delivery/failure';
import { formatClock } from '@/components/orders/common';
import { EmptyState, Page } from '@/components/page';
import { errorMessage } from '@/lib/api';
import {
  courierDeliver,
  courierFail,
  courierReturn,
  courierSetCollection,
  deliveryKeys,
  useCourierRoute,
} from '@/lib/delivery';

type Dialog =
  | { kind: 'deliver'; stop: CourierAppStopDto }
  | { kind: 'correct'; stop: CourierAppStopDto }
  | { kind: 'fail'; stop: CourierAppStopDto }
  | null;

const STATUS_TEXT = { PENDING: 'A entregar', DELIVERED: 'Entregue', FAILED: 'Não entregue' };

function StopCard({
  stop,
  busy,
  onDeliver,
  onCorrect,
  onFail,
}: {
  stop: CourierAppStopDto;
  busy: boolean;
  onDeliver: () => void;
  onCorrect: () => void;
  onFail: () => void;
}) {
  const a = stop.address;
  const pending = stop.status === 'PENDING';
  return (
    <article
      aria-label={`Entrega do pedido ${stop.orderNumber}`}
      className={cn('space-y-3 rounded-xl border bg-card p-4 shadow-xs', !pending && 'opacity-80')}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xl font-bold">#{stop.orderNumber}</p>
          <p className="font-medium">{stop.customerName ?? 'Cliente'}</p>
        </div>
        <span
          className={cn(
            'rounded-md px-2 py-1 text-sm font-semibold',
            stop.status === 'DELIVERED' && 'bg-success/15 text-success',
            stop.status === 'FAILED' && 'bg-destructive/10 text-destructive',
            pending && 'bg-status-dispatched/15 text-status-dispatched',
          )}
        >
          {STATUS_TEXT[stop.status]}
        </span>
      </header>

      {a && (
        <p className="text-base">
          {a.street}, {a.number}
          {a.complement ? ` — ${a.complement}` : ''}
          <br />
          <span className="text-muted-foreground">
            {a.neighborhood} · {a.city}
          </span>
          {a.reference && (
            <span className="block text-sm text-muted-foreground">Ref.: {a.reference}</span>
          )}
        </p>
      )}
      {stop.notes && <p className="rounded-md bg-muted p-2 text-sm">Obs.: {stop.notes}</p>}

      {pending && (
        <p className="text-base">
          {stop.chargeCents > 0 ? (
            <>
              Cobrar <span className="tabular font-semibold">{formatBRL(stop.chargeCents)}</span>
              {stop.expectedPaymentMethod &&
                ` · ${PAYMENT_METHOD_LABELS[stop.expectedPaymentMethod]}`}
              {stop.changeForCents != null && stop.changeForCents > stop.chargeCents && (
                <span className="block text-sm text-muted-foreground">
                  Troco para {formatBRL(stop.changeForCents)} (levar{' '}
                  {formatBRL(stop.changeForCents - stop.chargeCents)})
                </span>
              )}
            </>
          ) : (
            <span className="font-medium text-success">Já pago</span>
          )}
        </p>
      )}
      {stop.status === 'DELIVERED' && stop.collectedMethod && (
        <p className="text-sm text-muted-foreground">
          Recebido: {PAYMENT_METHOD_LABELS[stop.collectedMethod]}
          {stop.collectedCents != null && ` ${formatBRL(stop.collectedCents)}`}
          {stop.changeCents ? ` · troco ${formatBRL(stop.changeCents)}` : ''}
        </p>
      )}
      {stop.status === 'FAILED' && stop.failureReason && (
        <p className="text-sm text-destructive">{DELIVERY_FAILURE_LABELS[stop.failureReason]}</p>
      )}

      {pending && (
        <div className="grid grid-cols-2 gap-2">
          {stop.links && (
            <>
              <Button asChild variant="outline" size="lg">
                <a href={stop.links.google} target="_blank" rel="noreferrer">
                  <ExternalLink /> Google Maps
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href={stop.links.waze} target="_blank" rel="noreferrer">
                  <Navigation /> Waze
                </a>
              </Button>
            </>
          )}
          {stop.customerPhone && (
            <Button asChild variant="outline" size="lg" className="col-span-2">
              <a href={`tel:+55${stop.customerPhone}`}>
                <Phone /> Ligar {formatPhone(stop.customerPhone)}
              </a>
            </Button>
          )}
          <Button size="xl" className="col-span-2" loading={busy} onClick={onDeliver}>
            <Check /> Entregue
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="col-span-2"
            disabled={busy}
            onClick={onFail}
          >
            Não entregue
          </Button>
        </div>
      )}
      {stop.status === 'DELIVERED' && stop.collectedMethod && (
        <Button variant="ghost" size="sm" onClick={onCorrect}>
          Corrigir pagamento
        </Button>
      )}
    </article>
  );
}

/**
 * Courier app (phone): the deliveries of the signed-in courier's open route only (LGPD).
 * Delivered with how the customer paid, not delivered with a reason, and the return.
 */
export default function CourierRoutePage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useCourierRoute();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<CourierAppDto>, success?: string) {
    setBusy(key);
    try {
      queryClient.setQueryData(deliveryKeys.me, await fn());
      if (success) toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.me });
      throw error;
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Skeleton className="m-4 h-64" />;

  if (!data?.courier) {
    return (
      <Page title="Minhas entregas">
        <EmptyState
          icon={Bike}
          title="Seu usuário não está vinculado a um entregador"
          description="Peça ao gerente para vincular seu usuário na tela Entregadores."
        />
      </Page>
    );
  }

  const stops = data.run?.stops ?? [];
  const pending = stops.filter((s) => s.status === 'PENDING').length;

  return (
    <Page
      title="Minhas entregas"
      description={
        data.run
          ? `${data.courier.name} · saiu às ${formatClock(data.run.departedAt)} · ${pending} a entregar`
          : data.courier.name
      }
      className="max-w-xl"
    >
      {!data.run ? (
        <EmptyState
          icon={Store}
          title="Nenhuma entrega em andamento"
          description="Quando a loja registrar sua saída, as entregas aparecem aqui."
          action={
            <Button
              variant="outline"
              onClick={() => void queryClient.invalidateQueries({ queryKey: deliveryKeys.me })}
            >
              <RotateCcw /> Atualizar
            </Button>
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {/* Pending first, in route order. */}
            {[...stops]
              .sort((a, b) => Number(a.status !== 'PENDING') - Number(b.status !== 'PENDING'))
              .map((stop) => (
                <StopCard
                  key={stop.stopId}
                  stop={stop}
                  busy={busy === stop.stopId}
                  onDeliver={() =>
                    stop.chargeCents > 0
                      ? setDialog({ kind: 'deliver', stop })
                      : void run(
                          stop.stopId,
                          () => courierDeliver(stop.stopId, null),
                          `Pedido #${stop.orderNumber} entregue`,
                        ).catch(() => undefined)
                  }
                  onCorrect={() => setDialog({ kind: 'correct', stop })}
                  onFail={() => setDialog({ kind: 'fail', stop })}
                />
              ))}
          </div>
          <Button
            size="xl"
            variant={pending ? 'outline' : 'default'}
            className="w-full"
            disabled={pending > 0}
            loading={busy === 'return'}
            onClick={() =>
              void run('return', courierReturn, 'Volta registrada. Faça o acerto no caixa.').catch(
                () => undefined,
              )
            }
          >
            <Store /> Voltei para a loja
          </Button>
          {pending > 0 && (
            <p className="text-center text-sm text-muted-foreground">
              Marque todas as entregas como entregues ou não entregues para registrar a volta.
            </p>
          )}
        </>
      )}

      <CollectionDialog
        open={dialog?.kind === 'deliver' || dialog?.kind === 'correct'}
        onOpenChange={(v) => !v && setDialog(null)}
        title={
          dialog?.kind === 'correct'
            ? `Corrigir pagamento · #${dialog.stop.orderNumber}`
            : `Entregue · #${dialog?.stop.orderNumber ?? ''}`
        }
        chargeCents={
          dialog?.kind === 'correct'
            ? (dialog.stop.collectedCents ?? 0)
            : (dialog?.stop.chargeCents ?? 0)
        }
        initial={{
          method:
            dialog?.kind === 'correct'
              ? dialog.stop.collectedMethod
              : (dialog?.stop.expectedPaymentMethod ?? null),
          receivedCents:
            dialog?.kind === 'correct'
              ? dialog.stop.receivedCents
              : (dialog?.stop.changeForCents ?? null),
        }}
        confirmLabel={dialog?.kind === 'correct' ? 'Salvar' : 'Confirmar entrega'}
        onConfirm={(collection) => {
          const stop = dialog!.stop;
          return dialog!.kind === 'correct'
            ? run(
                stop.stopId,
                () => courierSetCollection(stop.stopId, collection),
                'Pagamento corrigido',
              )
            : run(
                stop.stopId,
                () => courierDeliver(stop.stopId, collection),
                `Pedido #${stop.orderNumber} entregue`,
              );
        }}
      />
      <DeliveryFailureDialog
        open={dialog?.kind === 'fail'}
        onOpenChange={(v) => !v && setDialog(null)}
        title={`Pedido #${dialog?.stop.orderNumber ?? ''} não entregue`}
        onConfirm={(input) => {
          const stop = dialog!.stop;
          return run(
            stop.stopId,
            () => courierFail(stop.stopId, input),
            'Registrado. Leve o pedido de volta para a loja.',
          );
        }}
      />
    </Page>
  );
}
