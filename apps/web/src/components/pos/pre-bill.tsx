'use client';

import { BRAND, type OrderDetailDto, type TableDto, formatBRL, splitEvenly } from '@app/shared';
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
import { toast } from '@app/ui/components/sonner';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ItemDescription } from '@/components/orders/common';
import { apiGet, errorMessage } from '@/lib/api';
import { cashKeys, requestBill, usePixCharge } from '@/lib/cash';
import { orderKeys } from '@/lib/orders';
import { useCurrentStore } from '@/lib/stores';
import { PrintPortal, QrCode, ReceiptDivider, ReceiptRow } from './common';

const dateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);

function TabReceipt({ order }: { order: OrderDetailDto }) {
  const items = order.items.filter((i) => i.status !== 'CANCELED');
  return (
    <div className="space-y-0.5">
      <p className="font-bold">
        Conta nº {order.number}
        {order.tabLabel ? ` · ${order.tabLabel}` : ''}
      </p>
      {items.map((item) => (
        <div key={item.id}>
          <ReceiptRow
            label={`${item.quantity}x ${item.name}${item.sizeName ? ` (${item.sizeName})` : ''}`}
            value={formatBRL(item.totalCents)}
          />
          <div className="pl-3 [&_*]:text-current">
            <ItemDescription item={item} />
          </div>
        </div>
      ))}
      <ReceiptDivider />
      <ReceiptRow label="Subtotal" value={formatBRL(order.subtotalCents)} />
      {order.orderDiscountCents > 0 && (
        <ReceiptRow label="Desconto" value={`− ${formatBRL(order.orderDiscountCents)}`} />
      )}
      {order.couponDiscountCents > 0 && (
        <ReceiptRow
          label={`Cupom ${order.couponCode}`}
          value={`− ${formatBRL(order.couponDiscountCents)}`}
        />
      )}
      {order.serviceFeeCents > 0 && (
        <ReceiptRow
          label={`Serviço ${order.serviceFeeBps / 100}% (opcional)`}
          value={formatBRL(order.serviceFeeCents)}
        />
      )}
      <ReceiptRow label="Total" value={formatBRL(order.totalCents)} strong />
      {order.paidCents > 0 && (
        <>
          <ReceiptRow label="Já pago" value={`− ${formatBRL(order.paidCents)}`} />
          <ReceiptRow label="A pagar" value={formatBRL(order.balanceCents)} strong />
        </>
      )}
    </div>
  );
}

/** 80 mm pre-bill: tabs of the table, optional even split and static PIX QR Code. */
export function PreBillReceipt({
  storeName,
  tableNames,
  orders,
  people,
  pixCode,
}: {
  storeName: string;
  tableNames: string[];
  orders: OrderDetailDto[];
  people: number;
  pixCode?: string | null;
}) {
  const balance = orders.reduce((sum, o) => sum + o.balanceCents, 0);
  return (
    <div className="space-y-1">
      <p className="text-center text-sm font-bold">{storeName}</p>
      <p className="text-center font-bold">PRÉ-CONTA</p>
      <p className="text-center">
        Mesa {tableNames.join(' + ')} · {dateTime(new Date())}
      </p>
      <p className="text-center">Não é documento fiscal</p>
      <ReceiptDivider />
      {orders.map((order) => (
        <div key={order.id} className="space-y-1">
          <TabReceipt order={order} />
          <ReceiptDivider />
        </div>
      ))}
      {orders.length > 1 && <ReceiptRow label="Total da mesa" value={formatBRL(balance)} strong />}
      {people > 1 && balance > 0 && (
        <div>
          <p>Dividido por {people} pessoas:</p>
          {splitEvenly(balance, people).map((share, i) => (
            <ReceiptRow key={i} label={`Pessoa ${i + 1}`} value={formatBRL(share)} />
          ))}
        </div>
      )}
      {pixCode && (
        <div className="flex flex-col items-center gap-1 pt-1">
          <p>Pague com PIX</p>
          <QrCode value={pixCode} className="size-40" />
        </div>
      )}
      <p className="pt-1 text-center">Obrigado pela preferência!</p>
    </div>
  );
}

/** Mount it only while open: the selection starts with all tabs of the table. */
export function PreBillDialog({
  table,
  open,
  onOpenChange,
}: {
  table: TableDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const store = useCurrentStore();
  const tabs = table.session?.tabs ?? [];
  const [selected, setSelected] = useState(() => tabs.map((t) => t.orderId));
  const [people, setPeople] = useState(1);
  const [withPix, setWithPix] = useState(true);
  const [printing, setPrinting] = useState(false);

  const details = useQueries({
    queries: selected.map((id) => ({
      queryKey: orderKeys.detail(id),
      queryFn: () => apiGet<OrderDetailDto>(`/orders/${id}`),
      enabled: open,
    })),
  });
  const orders = details.map((d) => d.data).filter(Boolean) as OrderDetailDto[];
  const loading = details.some((d) => d.isLoading);
  // PIX: one QR per order (its code is the txid), so only for a single tab.
  const single = orders.length === 1 ? orders[0]! : null;
  const pix = usePixCharge(
    single?.id ?? '',
    single?.balanceCents ?? 0,
    open && withPix && !!single,
  );

  const done = useCallback(() => setPrinting(false), []);

  async function print() {
    try {
      if (table.session) await requestBill(table.session.id);
      void queryClient.invalidateQueries({ queryKey: orderKeys.tables });
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
      setPrinting(true);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pré-conta · Mesa {table.name}</DialogTitle>
          <DialogDescription>
            Ao imprimir, a mesa fica como aguardando pagamento até uma nova rodada.
          </DialogDescription>
        </DialogHeader>
        {tabs.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Contas</legend>
            {tabs.map((tab) => (
              <Label key={tab.orderId} className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={selected.includes(tab.orderId)}
                  onCheckedChange={(on) =>
                    setSelected((list) =>
                      on === true
                        ? [...list, tab.orderId]
                        : list.filter((id) => id !== tab.orderId),
                    )
                  }
                />
                #{tab.number}
                {tab.tabLabel ? ` · ${tab.tabLabel}` : ''} · {formatBRL(tab.totalCents)}
              </Label>
            ))}
          </fieldset>
        )}
        <Label className="flex items-center gap-2 font-normal">
          Dividir por
          <Input
            type="number"
            min={1}
            max={30}
            value={people}
            aria-label="Número de pessoas"
            className="h-8 w-16"
            onChange={(e) => setPeople(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
          />
          pessoas
        </Label>
        {single && (
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={withPix} onCheckedChange={(on) => setWithPix(on === true)} />
            Imprimir QR Code PIX do saldo
          </Label>
        )}
        {withPix && single && pix.error && (
          <p className="text-xs text-muted-foreground">{errorMessage(pix.error)}</p>
        )}
        <div className="max-h-72 overflow-y-auto rounded-md border bg-qr-background p-3 font-mono text-xs text-qr-foreground">
          {loading || !store.data ? (
            <Skeleton className="h-40" />
          ) : (
            <PreBillReceipt
              storeName={store.data.tradeName || BRAND.name}
              tableNames={orders[0]?.tableNames ?? [table.name]}
              orders={orders}
              people={people}
              pixCode={withPix ? pix.data?.brCode : null}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => void print()}
            disabled={loading || orders.length === 0 || printing}
          >
            <Printer /> Imprimir pré-conta
          </Button>
        </DialogFooter>
        {printing && store.data && (
          <PrintPortal onDone={done}>
            <PreBillReceipt
              storeName={store.data.tradeName || BRAND.name}
              tableNames={orders[0]?.tableNames ?? [table.name]}
              orders={orders}
              people={people}
              pixCode={withPix ? pix.data?.brCode : null}
            />
          </PrintPortal>
        )}
      </DialogContent>
    </Dialog>
  );
}
