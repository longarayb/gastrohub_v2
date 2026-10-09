'use client';

import {
  ORDER_TYPE_LABELS,
  type OrderSummaryDto,
  type OrderType,
  Permission,
  isFinalStatus,
  onlyDigits,
  primaryNextStatus,
  requiresPaymentToClose,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import { Skeleton, Tabs, TabsList, TabsTrigger } from '@app/ui/components/misc';
import { cn } from '@app/ui/lib/utils';
import { BellOff, BellRing, Bike, ChevronDown, Plus, Search, Wifi, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DispatchDialog } from '@/components/delivery/dispatch-dialog';
import { BalanceFlag, StatusBadge, statusLabel, useNow } from '@/components/orders/common';
import { OrderCard } from '@/components/orders/order-card';
import { useOrderAction } from '@/components/orders/common';
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet';
import { Page } from '@/components/page';
import { useAuth } from '@/lib/auth';
import { useOrderAlert } from '@/lib/order-alert';
import {
  BOARD_COLUMNS,
  STATUS_STYLES,
  changeOrderStatus,
  matchesType,
  orderTitle,
  useOrderBoard,
} from '@/lib/orders';
import { useRealtime } from '@/lib/realtime';

function matchesSearch(o: OrderSummaryDto, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  const digits = onlyDigits(term);
  return (
    String(o.number) === term.replace('#', '') ||
    o.publicCode.toLowerCase() === term ||
    orderTitle(o).toLowerCase().includes(term) ||
    (digits.length >= 4 && !!o.customerPhone?.includes(digits))
  );
}

function ConnectionIndicator() {
  const { status } = useRealtime();
  const online = status === 'online';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-semibold',
        online ? 'text-signal-positive' : 'text-signal-attention',
      )}
      role="status"
      title={online ? 'Recebendo pedidos em tempo real' : 'Reconectando...'}
    >
      {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
      {online ? 'Tempo real' : status === 'connecting' ? 'Conectando...' : 'Sem conexão'}
    </span>
  );
}

export default function OrdersPage() {
  const { can } = useAuth();
  const now = useNow();
  const { data: orders, isLoading } = useOrderBoard();
  const run = useOrderAction();
  const [type, setType] = useState<OrderType | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [payOnOpen, setPayOnOpen] = useState(false);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  /** Orders checked in the "Saída para entrega" dialog (null = closed). */
  const [dispatchIds, setDispatchIds] = useState<string[] | null>(null);

  const pendingIds = useMemo(
    () => (orders ?? []).filter((o) => o.status === 'PENDING').map((o) => o.id),
    [orders],
  );
  const alert = useOrderAlert(pendingIds);

  const visible = (orders ?? []).filter((o) => matchesType(o, type) && matchesSearch(o, q));
  const columns = BOARD_COLUMNS.filter(
    (s) => s !== 'DISPATCHED' || type === 'ALL' || type === 'DELIVERY',
  );
  const finished = visible.filter((o) => isFinalStatus(o.status));
  const canAdvance = can(Permission.ORDERS_UPDATE_STATUS);

  function open(id: string, pay = false) {
    alert.markSeen(id);
    setPayOnOpen(pay);
    setOpenId(id);
  }

  async function advance(order: OrderSummaryDto) {
    const next = primaryNextStatus(order.type, order.status);
    if (!next) return;
    // Dine-in and takeout only close paid: receive first (a tab also deserves a look).
    if (next === 'DELIVERED' && requiresPaymentToClose(order.type)) {
      const unpaid = order.totalCents > order.paidCents;
      if (unpaid || order.type === 'DINE_IN') return open(order.id, unpaid);
    }
    // A delivery leaves with a courier: choose it (and other orders of the same route).
    if (next === 'DISPATCHED' && !order.courierName) return setDispatchIds([order.id]);
    alert.markSeen(order.id);
    setAdvancing(order.id);
    try {
      await run(() => changeOrderStatus(order, next));
    } catch {
      // Toast already shown.
    } finally {
      setAdvancing(null);
    }
  }

  return (
    <Page
      title="Pedidos"
      dated
      className="max-w-none"
      actions={
        <>
          <ConnectionIndicator />
          {alert.soundOn ? (
            <Button variant="outline" onClick={alert.disable}>
              <BellRing /> Som ativado
            </Button>
          ) : (
            <Button
              variant={alert.needsGesture || alert.unseenCount ? 'default' : 'outline'}
              onClick={alert.enable}
            >
              <BellOff /> Ativar som de novos pedidos
            </Button>
          )}
          {can(Permission.ORDERS_CREATE) && (
            <Button asChild>
              <Link href={'/pedidos/novo' as never}>
                <Plus /> Novo pedido
              </Link>
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={type} onValueChange={(v) => setType(v as OrderType | 'ALL')}>
          <TabsList>
            <TabsTrigger value="ALL">Todos</TabsTrigger>
            {(['DINE_IN', 'TAKEOUT', 'DELIVERY'] as const).map((t) => (
              <TabsTrigger key={t} value={t}>
                {ORDER_TYPE_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-10"
            placeholder="Número, cliente, telefone ou mesa"
            aria-label="Buscar pedido"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* Columns snap one by one on the phone; the page itself never scrolls sideways. */}
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:snap-none md:px-0">
        {columns.map((status) => {
          const items = visible
            .filter((o) => o.status === status)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return (
            <section
              key={status}
              aria-label={statusLabel(status, 'DELIVERY')}
              className="flex w-kanban-column max-w-[85vw] shrink-0 snap-start flex-col gap-2 overflow-hidden rounded-card bg-track p-2 pt-0"
            >
              <div className={cn('-mx-2 h-1', STATUS_STYLES[status].dot)} aria-hidden />
              <header className="flex min-h-11 items-center justify-between gap-2 px-1 pt-1">
                <h2 className="text-base font-extrabold">
                  {status === 'DISPATCHED' ? 'Saiu para entrega' : statusLabel(status, 'DELIVERY')}
                </h2>
                <span className="flex items-center gap-2">
                  {status === 'READY' && canAdvance && items.some((o) => o.type === 'DELIVERY') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDispatchIds([])}
                      title="Saída para entrega com vários pedidos"
                    >
                      <Bike /> Saída
                    </Button>
                  )}
                  <span
                    className="min-w-8 rounded-full bg-card px-2 py-0.5 text-center text-sm font-extrabold"
                    aria-label={`${items.length} ${items.length === 1 ? 'pedido' : 'pedidos'}`}
                  >
                    {items.length}
                  </span>
                </span>
              </header>
              {isLoading ? (
                <Skeleton className="h-36 bg-card" />
              ) : items.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">Nenhum pedido</p>
              ) : (
                items.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    now={now}
                    highlight={alert.unseen.includes(o.id)}
                    canAdvance={canAdvance}
                    advancing={advancing === o.id}
                    onOpen={() => open(o.id)}
                    onAdvance={() => void advance(o)}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>

      <section className="space-y-2">
        <Button
          variant="ghost"
          aria-expanded={showFinished}
          onClick={() => setShowFinished((v) => !v)}
        >
          <ChevronDown className={cn('transition-transform', showFinished && 'rotate-180')} />
          Finalizados ({finished.length})
        </Button>
        {showFinished && (
          <ul className="divide-y overflow-hidden rounded-card border bg-card">
            {finished.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">Nenhum pedido finalizado.</li>
            )}
            {finished.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-accent focus-visible:-outline-offset-3"
                  onClick={() => open(o.id)}
                >
                  <span className="w-14 text-base font-extrabold">#{o.number}</span>
                  <span className="flex-1 truncate">{orderTitle(o)}</span>
                  {/* Delivered with an open balance (delivery "a receber"). */}
                  {o.balanceCents > 0 && (
                    <BalanceFlag cents={o.balanceCents} className="shrink-0" />
                  )}
                  <StatusBadge status={o.status} type={o.type} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DispatchDialog
        open={!!dispatchIds}
        initialIds={dispatchIds ?? []}
        onOpenChange={(v) => !v && setDispatchIds(null)}
      />

      <OrderDetailSheet
        orderId={openId}
        autoPay={payOnOpen}
        onOpenChange={(v) => !v && setOpenId(null)}
      />
    </Page>
  );
}
