'use client';

import type { DispatchOrderDto, GeoPointDto } from '@app/shared';
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
import { toast } from '@app/ui/components/sonner';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { setOrderLocation } from '@/lib/dispatch';

/**
 * Confirms a delivery point placed by hand (pin dragged, or clicked for an order without
 * location). The fee already charged never changes; the screen warns when the point leaves the
 * area. Saved on the customer's address unless unchecked (next orders start right).
 */
export function LocationDialog({
  pending,
  onClose,
  onSaved,
}: {
  pending: { order: DispatchOrderDto; point: GeoPointDto } | null;
  onClose: () => void;
  onSaved: (orderId: string) => void;
}) {
  const [saveToCustomer, setSaveToCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(pending);
  if (pending !== shown) {
    setShown(pending);
    if (pending) setSaveToCustomer(true);
  }
  const order = pending?.order;

  async function save() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await setOrderLocation(pending.order.id, {
        ...pending.point,
        saveToCustomer,
      });
      toast.success(
        result.savedToCustomer
          ? `Ponto do pedido #${pending.order.number} salvo, também no cadastro do cliente`
          : `Ponto do pedido #${pending.order.number} salvo`,
      );
      if (result.outsideArea) toast.warning(result.outsideArea);
      onSaved(pending.order.id);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {order?.location ? 'Mover o ponto de entrega?' : 'Marcar o ponto de entrega?'}
          </DialogTitle>
          <DialogDescription>
            Pedido #{order?.number}
            {order?.addressLine ? ` · ${order.addressLine}` : ''}
            {order?.neighborhood ? ` · ${order.neighborhood}` : ''}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={saveToCustomer}
            onCheckedChange={(v) => setSaveToCustomer(v === true)}
          />
          <span>
            Salvar também no cadastro do cliente
            <span className="block text-muted-foreground">
              Os próximos pedidos para este endereço já saem no lugar certo.
            </span>
          </span>
        </label>
        <p className="text-sm text-muted-foreground">A taxa de entrega já cobrada não muda.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Salvar ponto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
