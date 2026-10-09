'use client';

import { COURIER_STATUS_LABELS, formatBRL } from '@app/shared';
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
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Bike } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@app/ui/components/sonner';
import { ApiError, errorMessage } from '@/lib/api';
import { deliveryKeys, dispatchOrders, useCourierDetails } from '@/lib/delivery';
import { orderKeys, orderTitle, useOrderBoard } from '@/lib/orders';
import { DeliveryFailureBadge } from './failure';

/**
 * "Saída para entrega": the ready deliveries that leave together with one courier (same route).
 * A courier already on the road gets the orders in the same route.
 */
export function DispatchDialog({
  open,
  onOpenChange,
  initialIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Orders checked when the dialog opens. */
  initialIds: string[];
}) {
  const queryClient = useQueryClient();
  const board = useOrderBoard();
  const couriers = useCourierDetails(open);
  const [selected, setSelected] = useState<string[]>([]);
  const [courierId, setCourierId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = (board.data ?? [])
    .filter((o) => o.type === 'DELIVERY' && o.status === 'READY')
    .sort(
      (a, b) =>
        (a.readyAt ?? a.createdAt).localeCompare(b.readyAt ?? b.createdAt) ||
        a.businessDate.localeCompare(b.businessDate) ||
        a.number - b.number,
    );
  const active = (couriers.data ?? []).filter((c) => c.isActive);

  // Reset when (re)opening (state adjusted during render, no effect needed).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(initialIds);
      setCourierId(null);
    }
  }

  function toggle(id: string, on: boolean) {
    setSelected((list) => (on ? [...list, id] : list.filter((x) => x !== id)));
  }

  async function submit() {
    if (!courierId || selected.length === 0) return;
    setBusy(true);
    try {
      const orders = ready.filter((o) => selected.includes(o.id));
      await dispatchOrders(courierId, orders);
      const courier = active.find((c) => c.id === courierId);
      toast.success(
        `${orders.length === 1 ? 'Pedido saiu' : `${orders.length} pedidos saíram`} com ${courier?.name ?? 'o entregador'}`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      }
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Saída para entrega</DialogTitle>
          <DialogDescription>
            Marque os pedidos que saem juntos e escolha o entregador.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Pedidos prontos</h3>
          {ready.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum delivery pronto.</p>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {ready.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-start gap-3 p-2.5 text-sm hover:bg-accent">
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(o.id)}
                      onCheckedChange={(v) => toggle(o.id, v === true)}
                      aria-label={`Pedido ${o.number}`}
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex justify-between gap-2">
                        <span className="truncate font-medium">
                          #{o.number} · {orderTitle(o)}
                        </span>
                        <span className="tabular">{formatBRL(o.totalCents)}</span>
                      </span>
                      {o.neighborhood && (
                        <span className="block text-xs text-muted-foreground">
                          {o.neighborhood}
                        </span>
                      )}
                      {o.deliveryFailure && <DeliveryFailureBadge failure={o.deliveryFailure} />}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Entregador</h3>
          {active.length === 0 && !couriers.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Nenhum entregador ativo. Cadastre em Entregadores.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Entregador" className="grid grid-cols-2 gap-2">
              {active.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={courierId === c.id}
                  variant={courierId === c.id ? 'default' : 'outline'}
                  className="h-auto flex-col items-start gap-0.5 py-2 text-left"
                  onClick={() => setCourierId(c.id)}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Bike className="size-4" aria-hidden /> {c.name}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      courierId === c.id ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {c.openRun
                      ? `Em rota · ${c.openRun.stops - c.openRun.delivered} pendente(s)`
                      : COURIER_STATUS_LABELS[c.status]}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            loading={busy}
            disabled={!courierId || selected.length === 0}
            onClick={() => void submit()}
          >
            <Bike /> Saiu para entrega
            {selected.length > 1 ? ` (${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
