'use client';

import { type OrderDetailDto, Permission } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Copy, Printer } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { printKeys, printOrder, usePrintStatus } from '@/lib/printing';
import { PrintQueueList } from './queue-card';

/** Order detail: delivery copy, second copy of the tickets and what was printed for it. */
export function OrderPrintSection({ order }: { order: OrderDetailDto }) {
  const { can } = useAuth();
  const allowed = can(Permission.PRINT);
  const queryClient = useQueryClient();
  const { data: status } = usePrintStatus(allowed);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!allowed || !status?.printers.length) return null;

  async function send(document: 'DELIVERY_COPY' | 'KITCHEN_TICKETS') {
    setBusy(document);
    try {
      const { queued } = await printOrder(order.id, { document });
      await queryClient.invalidateQueries({ queryKey: printKeys.all });
      toast.success(
        document === 'DELIVERY_COPY'
          ? 'Via de entrega enviada para a impressora'
          : `${queued} comanda(s) enviada(s) como 2ª via`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2 text-sm">
      <h3 className="font-semibold">Impressão</h3>
      <div className="flex flex-wrap gap-2">
        {order.type === 'DELIVERY' && (
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'DELIVERY_COPY'}
            onClick={() => void send('DELIVERY_COPY')}
          >
            <Printer /> Via de entrega
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'KITCHEN_TICKETS'}
          onClick={() => void send('KITCHEN_TICKETS')}
        >
          <Copy /> 2ª via das comandas
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHistory((v) => !v)}>
          {history ? <ChevronUp /> : <ChevronDown />} O que foi impresso
        </Button>
      </div>
      {history && <PrintQueueList orderId={order.id} empty="Nada impresso para este pedido." />}
    </section>
  );
}
