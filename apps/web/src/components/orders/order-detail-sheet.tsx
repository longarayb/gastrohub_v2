'use client';

import {
  ORDER_ITEM_STATUS_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
  ORDER_SOURCE_LABELS,
  ORDER_TYPE_LABELS,
  type OrderDetailDto,
  type OrderItemDto,
  type OrderStatus,
  type OrderType,
  PAYMENT_METHOD_LABELS,
  Permission,
  formatBRL,
  formatPhone,
  isFinalStatus,
  nextStatuses,
  primaryNextStatus,
  requiresPaymentToClose,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Separator, Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@app/ui/components/sheet';
import { cn } from '@app/ui/lib/utils';
import {
  ArrowLeftRight,
  Ban,
  Percent,
  Plus,
  Printer,
  Send,
  Split,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DispatchDialog } from '@/components/delivery/dispatch-dialog';
import { DeliveryFailureDialog } from '@/components/delivery/failure';
import { OrderDeliverySection } from '@/components/delivery/order-delivery-section';
import { PixReportedBadge, RejectOrderDialog } from '@/components/digital-menu/order-badges';
import { Kbd } from '@/components/pos/common';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { PreBillDialog } from '@/components/pos/pre-bill';
import { OrderPrintSection } from '@/components/printing/order-print';
import { MoveItemsDialog, TransferTabDialog } from '@/components/pos/table-actions';
import { useAuth } from '@/lib/auth';
import { reportDeliveryFailure } from '@/lib/delivery';
import { useHotkeys } from '@/lib/hotkeys';
import {
  assignCourier,
  cancelOrderItem,
  changeOrderStatus,
  orderTitle,
  rejectOrder,
  removeDraftItem,
  sendOrderRound,
  setOrderDiscount,
  setServiceFee,
  useCouriers,
  useOrder,
  useTables,
} from '@/lib/orders';
import {
  ItemDescription,
  ReasonDialog,
  StatusBadge,
  formatClock,
  statusLabel,
  useOrderAction,
} from './common';
import { OrderDiscountDialog } from './order-discount-dialog';

/** Label of the button that moves an order to `to`. */
export function statusActionLabel(type: OrderType, to: OrderStatus): string {
  switch (to) {
    case 'ACCEPTED':
      return 'Aceitar';
    case 'PREPARING':
      return 'Iniciar preparo';
    case 'READY':
      return 'Marcar como pronto';
    case 'DISPATCHED':
      return 'Saiu para entrega';
    case 'DELIVERED':
      return type === 'DELIVERY'
        ? 'Confirmar entrega'
        : type === 'TAKEOUT'
          ? 'Confirmar retirada'
          : 'Fechar conta';
    default:
      return statusLabel(to, type);
  }
}

function TotalRow({
  label,
  value,
  negative,
  strong,
  action,
}: {
  label: string;
  value: number;
  negative?: boolean;
  strong?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2', strong && 'text-base font-semibold')}
    >
      <span className="flex items-center gap-1">
        {label}
        {action}
      </span>
      <span className="tabular">
        {negative && value > 0 ? '− ' : ''}
        {formatBRL(value)}
      </span>
    </div>
  );
}

type Prompt =
  | { kind: 'cancel-order' }
  | { kind: 'cancel-item'; item: OrderItemDto }
  | { kind: 'waive-fee' }
  | null;

type Panel = 'pay' | 'pre-bill' | 'move-items' | 'transfer' | null;

export function OrderDetailSheet({
  orderId,
  onOpenChange,
  autoPay,
}: {
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Open the payment dialog right away (closing an unpaid order from the board). */
  autoPay?: boolean;
}) {
  const { can } = useAuth();
  const { data: order, isLoading } = useOrder(orderId);
  const run = useOrderAction();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const couriers = useCouriers(!!order && order.type === 'DELIVERY');
  const tables = useTables();

  useEffect(() => {
    setPanel(autoPay && orderId ? 'pay' : null);
  }, [orderId, autoPay]);

  async function act(fn: () => Promise<OrderDetailDto>, success?: string) {
    setBusy(true);
    try {
      return await run(fn, success);
    } finally {
      setBusy(false);
    }
  }

  const final = order ? isFinalStatus(order.status) : true;
  const canStatus = can(Permission.ORDERS_UPDATE_STATUS);
  const canCreate = can(Permission.ORDERS_CREATE);
  const canCancel = can(Permission.ORDERS_CANCEL);
  const canDiscount = can(Permission.ORDERS_DISCOUNT);
  const canReceive = can(Permission.CASH_OPERATE);
  const canTables = can(Permission.TABLES_OPERATE);
  const isTab = !!order && order.type === 'DINE_IN' && !!order.tableSessionId && !final;
  const table = isTab
    ? (tables.data?.find((t) => t.session?.id === order!.tableSessionId) ?? null)
    : null;
  // Dine-in and takeout only close with a zero balance: closing means receiving first.
  const mustPay = !!order && !final && requiresPaymentToClose(order.type) && order.balanceCents > 0;
  const canPay = !!order && order.status !== 'CANCELED' && order.balanceCents > 0 && canReceive;

  useHotkeys(
    {
      F4: () => canPay && setPanel('pay'),
      F8: () => table && setPanel('pre-bill'),
    },
    !!orderId && !panel && !prompt && !discountOpen && !dispatchOpen && !failureOpen && !rejectOpen,
  );

  const primary = order ? primaryNextStatus(order.type, order.status) : null;
  const others = order ? nextStatuses(order.type, order.status).filter((s) => s !== primary) : [];
  const drafts = order?.items.filter((i) => i.status === 'DRAFT') ?? [];
  const rounds = order
    ? order.rounds
        .map((r) => ({ ...r, items: order.items.filter((i) => i.roundId === r.id) }))
        .filter((r) => r.items.length)
    : [];

  return (
    <Sheet open={!!orderId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {isLoading || !order ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">Pedido</SheetTitle>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-xl">#{order.number}</SheetTitle>
                <StatusBadge status={order.status} type={order.type} />
                <Badge variant="outline">{ORDER_TYPE_LABELS[order.type]}</Badge>
                {order.source !== 'POS' && (
                  <Badge variant="secondary">{ORDER_SOURCE_LABELS[order.source]}</Badge>
                )}
              </div>
              <SheetDescription>
                {orderTitle(order)} · aberto às {formatClock(order.createdAt)}
                {order.externalDisplayId ? ` · ${order.externalDisplayId}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 p-4">
              {/* Status actions */}
              {!final && (canStatus || canCancel) && (
                <div className="flex flex-wrap gap-2">
                  {canStatus && primary === 'DELIVERED' && mustPay ? (
                    <Button disabled={!canReceive} onClick={() => setPanel('pay')}>
                      <Wallet /> Receber e {order.type === 'TAKEOUT' ? 'entregar' : 'fechar'}
                      <Kbd className="bg-primary-foreground/20 text-primary-foreground">F4</Kbd>
                    </Button>
                  ) : (
                    canStatus &&
                    primary && (
                      <Button
                        loading={busy}
                        onClick={() =>
                          primary === 'DISPATCHED' && !order.courierId
                            ? setDispatchOpen(true)
                            : void act(() => changeOrderStatus(order, primary)).catch(
                                () => undefined,
                              )
                        }
                      >
                        {order.deliveryFailure
                          ? 'Reenviar'
                          : statusActionLabel(order.type, primary)}
                      </Button>
                    )
                  )}
                  {canStatus &&
                    others
                      .filter((s) => !(s === 'DELIVERED' && mustPay))
                      .map((s) => (
                        <Button
                          key={s}
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(() => changeOrderStatus(order, s)).catch(() => undefined)
                          }
                        >
                          {statusActionLabel(order.type, s)}
                        </Button>
                      ))}
                  {canStatus && order.status === 'DISPATCHED' && (
                    <Button variant="outline" disabled={busy} onClick={() => setFailureOpen(true)}>
                      Não entregue
                    </Button>
                  )}
                  {canCancel && order.source === 'DIGITAL_MENU' && (
                    <Button
                      variant="outline"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => setRejectOpen(true)}
                    >
                      <Ban /> Recusar
                    </Button>
                  )}
                  {canCancel && order.source !== 'DIGITAL_MENU' && (
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => setPrompt({ kind: 'cancel-order' })}
                    >
                      <Ban /> Cancelar pedido
                    </Button>
                  )}
                </div>
              )}
              {order.status === 'CANCELED' && order.cancelReason && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  Cancelado: {order.cancelReason}
                  {order.rejection && (
                    <span className="mt-1 block text-foreground">
                      O cliente vê: “{order.rejection.customerMessage}”
                    </span>
                  )}
                </p>
              )}
              {order.pixReportedAt && order.paymentStatus !== 'PAID' && !final && (
                <PixReportedBadge className="text-sm" />
              )}

              {/* Customer / delivery */}
              {(order.customerName || order.deliveryAddress) && (
                <section className="space-y-1 text-sm">
                  <h3 className="font-medium">Cliente</h3>
                  {order.customerName && (
                    <p>
                      {order.customerName}
                      {order.customerPhone ? ` · ${formatPhone(order.customerPhone)}` : ''}
                    </p>
                  )}
                  {order.deliveryAddress && (
                    <p className="text-muted-foreground">
                      {order.deliveryAddress.street}, {order.deliveryAddress.number}
                      {order.deliveryAddress.complement
                        ? ` — ${order.deliveryAddress.complement}`
                        : ''}
                      <br />
                      {order.deliveryAddress.neighborhood} · {order.deliveryAddress.city}/
                      {order.deliveryAddress.state}
                      {order.deliveryAddress.reference
                        ? ` · Ref.: ${order.deliveryAddress.reference}`
                        : ''}
                    </p>
                  )}
                </section>
              )}
              <OrderDeliverySection order={order} />
              {order.type === 'DELIVERY' && (
                <section className="space-y-1.5 text-sm">
                  <h3 className="font-medium">Entregador</h3>
                  <Select
                    value={order.courierId ?? 'none'}
                    disabled={final || !canStatus || busy}
                    onValueChange={(v) =>
                      void act(
                        () => assignCourier(order, v === 'none' ? null : v),
                        'Entregador atualizado',
                      ).catch(() => undefined)
                    }
                  >
                    <SelectTrigger aria-label="Entregador" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem entregador</SelectItem>
                      {couriers.data
                        ?.filter((c) => c.isActive || c.id === order.courierId)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </section>
              )}
              {order.notes && (
                <p className="rounded-md bg-muted p-3 text-sm">
                  <span className="font-medium">Observação:</span> {order.notes}
                </p>
              )}

              {/* Items by round */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">Itens</h3>
                  {order.type === 'DINE_IN' && !final && canCreate && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/pedidos/novo?pedido=${order.id}` as never}>
                        <Plus /> Adicionar itens
                      </Link>
                    </Button>
                  )}
                </div>
                {rounds.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum item lançado.</p>
                )}
                {rounds.map((round) => (
                  <div key={round.id} className="space-y-2">
                    {rounds.length > 1 || order.type === 'DINE_IN' ? (
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        Rodada {round.number}
                        {round.sentAt
                          ? ` · enviada às ${formatClock(round.sentAt)}`
                          : ' · não enviada'}
                      </p>
                    ) : null}
                    <ul className="divide-y rounded-md border">
                      {round.items.map((item) => {
                        const canceled = item.status === 'CANCELED';
                        return (
                          <li key={item.id} className="flex gap-3 p-3">
                            <span className="tabular w-6 shrink-0 text-sm font-medium">
                              {item.quantity}×
                            </span>
                            <div className="min-w-0 flex-1 space-y-1">
                              <p
                                className={cn(
                                  'text-sm font-medium',
                                  canceled && 'text-muted-foreground line-through',
                                )}
                              >
                                {item.name}
                              </p>
                              <ItemDescription item={item} />
                              <p className="text-xs text-muted-foreground">
                                {ORDER_ITEM_STATUS_LABELS[item.status]}
                                {item.cancelReason ? ` — ${item.cancelReason}` : ''}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className={cn('tabular text-sm', canceled && 'line-through')}>
                                {formatBRL(item.totalCents)}
                              </span>
                              {!final && item.status === 'DRAFT' && canCreate && (
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Remover ${item.name}`}
                                  disabled={busy}
                                  onClick={() =>
                                    void act(() => removeDraftItem(order, item.id)).catch(
                                      () => undefined,
                                    )
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              )}
                              {!final &&
                                canCancel &&
                                !['DRAFT', 'CANCELED', 'SERVED'].includes(item.status) && (
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`Cancelar ${item.name}`}
                                    disabled={busy}
                                    onClick={() => setPrompt({ kind: 'cancel-item', item })}
                                  >
                                    <X />
                                  </Button>
                                )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {drafts.length > 0 && !final && canCreate && (
                  <Button
                    className="w-full"
                    loading={busy}
                    onClick={() =>
                      void act(() => sendOrderRound(order), 'Itens enviados para a produção').catch(
                        () => undefined,
                      )
                    }
                  >
                    <Send /> Enviar {drafts.length} {drafts.length === 1 ? 'item' : 'itens'} para a
                    produção
                  </Button>
                )}
              </section>

              {/* Totals */}
              <section className="space-y-1.5 text-sm">
                <TotalRow label="Subtotal" value={order.subtotalCents + order.itemDiscountCents} />
                {order.itemDiscountCents > 0 && (
                  <TotalRow label="Descontos nos itens" value={order.itemDiscountCents} negative />
                )}
                <TotalRow
                  label="Desconto no pedido"
                  value={order.orderDiscountCents}
                  negative
                  action={
                    !final &&
                    canDiscount && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Alterar desconto"
                        onClick={() => setDiscountOpen(true)}
                      >
                        <Percent />
                      </Button>
                    )
                  }
                />
                {order.couponCode && (
                  <TotalRow
                    label={`Cupom ${order.couponCode}`}
                    value={order.couponDiscountCents}
                    negative
                  />
                )}
                {(order.serviceFeeBps > 0 || order.serviceFeeWaived) && (
                  <TotalRow
                    label={
                      order.serviceFeeWaived
                        ? 'Taxa de serviço (retirada)'
                        : `Taxa de serviço (${order.serviceFeeBps / 100}%)`
                    }
                    value={order.serviceFeeCents}
                    action={
                      !final &&
                      canDiscount && (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto px-1"
                          disabled={busy}
                          onClick={() =>
                            order.serviceFeeWaived
                              ? void act(
                                  () => setServiceFee(order, false, null),
                                  'Taxa de serviço restaurada',
                                ).catch(() => undefined)
                              : setPrompt({ kind: 'waive-fee' })
                          }
                        >
                          {order.serviceFeeWaived ? 'restaurar' : 'retirar'}
                        </Button>
                      )
                    }
                  />
                )}
                {order.type === 'DELIVERY' && (
                  <TotalRow label="Taxa de entrega" value={order.deliveryFeeCents} />
                )}
                <Separator />
                <TotalRow label="Total" value={order.totalCents} strong />
                {order.expectedPaymentMethod && (
                  <p className="text-muted-foreground">
                    Pagamento: {PAYMENT_METHOD_LABELS[order.expectedPaymentMethod]}
                    {order.changeForCents ? ` · troco para ${formatBRL(order.changeForCents)}` : ''}
                  </p>
                )}
                {order.promoSavingsCents > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Promoções economizaram {formatBRL(order.promoSavingsCents)}.
                  </p>
                )}
              </section>

              {/* Payment */}
              {order.status !== 'CANCELED' && (
                <section className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">Pagamento</h3>
                    <Badge variant={order.paymentStatus === 'PAID' ? 'secondary' : 'outline'}>
                      {ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
                    </Badge>
                  </div>
                  <TotalRow label="Pago" value={order.paidCents} />
                  <TotalRow label="Saldo" value={order.balanceCents} strong />
                  {order.payments.length > 0 && (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {order.payments.map((p) => (
                        <li
                          key={p.id}
                          className={cn(
                            'flex justify-between',
                            p.status === 'REFUNDED' && 'line-through',
                          )}
                        >
                          <span>
                            {PAYMENT_METHOD_LABELS[p.method]} · {formatClock(p.createdAt)}
                          </span>
                          <span className="tabular">{formatBRL(p.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(canPay || (order.payments.length > 0 && canReceive)) && (
                      <Button size="sm" variant="outline" onClick={() => setPanel('pay')}>
                        <Wallet /> {canPay ? 'Receber' : 'Pagamentos'} <Kbd>F4</Kbd>
                      </Button>
                    )}
                    {table && (
                      <Button size="sm" variant="outline" onClick={() => setPanel('pre-bill')}>
                        <Printer /> Pré-conta <Kbd>F8</Kbd>
                      </Button>
                    )}
                    {isTab && canTables && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setPanel('move-items')}>
                          <Split /> Dividir por itens
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPanel('transfer')}>
                          <ArrowLeftRight /> Transferir mesa
                        </Button>
                      </>
                    )}
                  </div>
                </section>
              )}

              <OrderPrintSection order={order} />

              {/* History */}
              <section className="space-y-2 text-sm">
                <h3 className="font-medium">Histórico</h3>
                <ol className="space-y-1.5">
                  {order.history.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular text-muted-foreground">
                        {formatClock(h.createdAt)}
                      </span>
                      <span>
                        {statusLabel(h.toStatus, order.type)}
                        {h.userName ? ` · ${h.userName}` : ''}
                        {h.reason ? ` — ${h.reason}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <DispatchDialog
              open={dispatchOpen}
              initialIds={[order.id]}
              onOpenChange={setDispatchOpen}
            />
            <RejectOrderDialog
              open={rejectOpen}
              onOpenChange={setRejectOpen}
              title={`Recusar o pedido #${order.number}?`}
              onConfirm={(input) =>
                act(() => rejectOrder(order, input), 'Pedido recusado').then(() =>
                  onOpenChange(false),
                )
              }
            />
            <DeliveryFailureDialog
              open={failureOpen}
              onOpenChange={setFailureOpen}
              title={`Pedido #${order.number} não entregue`}
              onConfirm={(input) =>
                act(() => reportDeliveryFailure(order.id, input), 'Pedido voltou para a loja')
              }
            />
            <ReasonDialog
              open={prompt?.kind === 'cancel-order'}
              onOpenChange={(open) => !open && setPrompt(null)}
              title={`Cancelar o pedido #${order.number}?`}
              description="O cancelamento fica registrado na auditoria com o seu usuário."
              confirmLabel="Cancelar pedido"
              destructive
              onConfirm={(reason) =>
                act(() => changeOrderStatus(order, 'CANCELED', reason), 'Pedido cancelado')
              }
            />
            <ReasonDialog
              open={prompt?.kind === 'cancel-item'}
              onOpenChange={(open) => !open && setPrompt(null)}
              title={prompt?.kind === 'cancel-item' ? `Cancelar ${prompt.item.name}?` : ''}
              description="O item já foi enviado para a produção. O cancelamento fica na auditoria."
              confirmLabel="Cancelar item"
              destructive
              onConfirm={(reason) =>
                prompt?.kind === 'cancel-item'
                  ? act(() => cancelOrderItem(order, prompt.item.id, reason), 'Item cancelado')
                  : Promise.resolve()
              }
            />
            <ReasonDialog
              open={prompt?.kind === 'waive-fee'}
              onOpenChange={(open) => !open && setPrompt(null)}
              title="Retirar a taxa de serviço?"
              description="Use quando o cliente pedir. Fica registrado na auditoria."
              confirmLabel="Retirar taxa"
              onConfirm={(reason) =>
                act(() => setServiceFee(order, true, reason), 'Taxa de serviço retirada')
              }
            />
            <OrderDiscountDialog
              order={order}
              open={discountOpen}
              onOpenChange={setDiscountOpen}
              onSubmit={(discount, reason) =>
                act(() => setOrderDiscount(order, discount, reason), 'Desconto atualizado')
              }
            />
            <PaymentDialog
              order={order}
              open={panel === 'pay'}
              onOpenChange={(o) => !o && setPanel(null)}
            />
            {panel === 'pre-bill' && table && (
              <PreBillDialog table={table} open onOpenChange={(o) => !o && setPanel(null)} />
            )}
            {panel === 'move-items' && (
              <MoveItemsDialog order={order} open onOpenChange={(o) => !o && setPanel(null)} />
            )}
            {panel === 'transfer' && (
              <TransferTabDialog order={order} open onOpenChange={(o) => !o && setPanel(null)} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
