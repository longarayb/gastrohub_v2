'use client';

import { type OrderDetailDto, type TableDto, formatBRL } from '@app/shared';
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
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/form';
import { ApiError, errorMessage } from '@/lib/api';
import { changeTable, mergeTables, moveOrderItems, splitTables, transferOrder } from '@/lib/cash';
import { orderKeys, useOrder, useTables } from '@/lib/orders';

/** Tables of the same session (merged tables share one session). */
export const sessionTables = (tables: TableDto[], sessionId: string) =>
  tables.filter((t) => t.session?.id === sessionId);

function useRefresh() {
  const queryClient = useQueryClient();
  return (orders: OrderDetailDto[] = []) => {
    for (const order of orders) queryClient.setQueryData(orderKeys.detail(order.id), order);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: orderKeys.board }),
      queryClient.invalidateQueries({ queryKey: orderKeys.tables }),
    ]);
  };
}

function handleError(error: unknown, queryClient: ReturnType<typeof useQueryClient>) {
  toast.error(errorMessage(error));
  if (error instanceof ApiError && error.status === 409) {
    void queryClient.invalidateQueries({ queryKey: orderKeys.all });
  }
}

/** Picks a table from a list (transfer, change, merge). */
function TableGrid({
  tables,
  value,
  onChange,
  empty,
}: {
  tables: TableDto[];
  value: string | null;
  onChange: (id: string) => void;
  empty: string;
}) {
  if (tables.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2 overflow-y-auto">
      {tables.map((t) => (
        <Button
          key={t.id}
          type="button"
          variant={value === t.id ? 'default' : 'outline'}
          className={cn(
            'h-16 flex-col gap-0.5',
            t.session && value !== t.id && 'border-table-occupied',
          )}
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
        >
          <span className="text-base font-semibold">{t.name}</span>
          <span className="text-xs opacity-80">{t.session ? 'Ocupada' : 'Livre'}</span>
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MoveItemsDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const { data: tables } = useTables();
  const otherTabs =
    tables
      ?.find((t) => t.session?.id === order.tableSessionId)
      ?.session?.tabs.filter((tab) => tab.orderId !== order.id) ?? [];
  const items = order.items.filter((i) => i.status !== 'CANCELED');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [target, setTarget] = useState('new');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const targetOrder = useOrder(target === 'new' ? null : target);

  const selection = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
  const movingCents = selection.reduce((sum, s) => {
    const item = items.find((i) => i.id === s.itemId)!;
    return sum + Math.round((item.totalCents * s.quantity) / item.quantity);
  }, 0);

  const setQuantity = (id: string, quantity: number) =>
    setQuantities((q) => ({ ...q, [id]: quantity }));

  async function submit() {
    setBusy(true);
    try {
      const result = await moveOrderItems(order, {
        items: selection,
        ...(target === 'new'
          ? { newTabLabel: label.trim() || null }
          : { targetOrderId: target, targetExpectedVersion: targetOrder.data?.version }),
      });
      await refresh([result.source, result.target]);
      toast.success(`Itens transferidos para a conta #${result.target.number}`);
      setQuantities({});
      onOpenChange(false);
    } catch (error) {
      handleError(error, queryClient);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dividir por itens · conta #{order.number}</DialogTitle>
          <DialogDescription>
            Escolha os itens (ou parte da quantidade) e a conta que vai recebê-los. A taxa de
            serviço é recalculada em cada conta.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {items.map((item) => {
            const quantity = quantities[item.id] ?? 0;
            return (
              <li key={item.id} className="flex items-center gap-3 p-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {item.quantity}× {item.name}
                  </p>
                  <p className="tabular text-xs text-muted-foreground">
                    {formatBRL(item.totalCents)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Menos ${item.name}`}
                    disabled={quantity === 0}
                    onClick={() => setQuantity(item.id, quantity - 1)}
                  >
                    <Minus />
                  </Button>
                  <span
                    className="tabular w-8 text-center"
                    aria-label={`Transferir de ${item.name}`}
                  >
                    {quantity}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Mais ${item.name}`}
                    disabled={quantity === item.quantity}
                    onClick={() => setQuantity(item.id, quantity + 1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Para a conta">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger aria-label="Conta de destino" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Nova conta nesta mesa</SelectItem>
                {otherTabs.map((tab) => (
                  <SelectItem key={tab.orderId} value={tab.orderId}>
                    #{tab.number}
                    {tab.tabLabel ? ` · ${tab.tabLabel}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {target === 'new' && (
            <Field label="Nome da nova conta (opcional)">
              <Input
                value={label}
                maxLength={60}
                aria-label="Nome da nova conta"
                placeholder="Ex.: Ana"
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          )}
        </div>
        <DialogFooter className="items-center">
          {selection.length > 0 && (
            <span className="tabular mr-auto text-sm text-muted-foreground">
              ≈ {formatBRL(movingCents)} sem taxa
            </span>
          )}
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={selection.length === 0 || (target !== 'new' && !targetOrder.data)}
          >
            Transferir itens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function TransferTabDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const { data: tables } = useTables();
  const [tableId, setTableId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = (tables ?? []).filter(
    (t) => t.isActive && t.session?.id !== order.tableSessionId,
  );

  async function submit() {
    if (!tableId) return;
    setBusy(true);
    try {
      const updated = await transferOrder(order, tableId);
      await refresh([updated]);
      toast.success(`Conta transferida para a mesa ${updated.tableNames.join(' + ')}`);
      onOpenChange(false);
    } catch (error) {
      handleError(error, queryClient);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir conta #{order.number}</DialogTitle>
          <DialogDescription>
            A conta vai para a mesa escolhida (se ela estiver ocupada, entra como mais uma conta).
          </DialogDescription>
        </DialogHeader>
        <TableGrid
          tables={options}
          value={tableId}
          onChange={setTableId}
          empty="Nenhuma outra mesa."
        />
        <DialogFooter>
          <Button onClick={() => void submit()} loading={busy} disabled={!tableId}>
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

type SessionAction = 'change' | 'merge' | 'split';

/** Mount it only while an action is chosen (its state starts fresh each time). */
export function SessionActionDialog({
  table,
  action,
  onOpenChange,
}: {
  table: TableDto;
  action: SessionAction | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: tables = [] } = useTables();
  const session = table.session!;
  const linked = sessionTables(tables, session.id);
  const [tableId, setTableId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(table.id);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const free = tables.filter((t) => t.isActive && !t.session);
  const occupied = tables.filter((t) => t.session && t.session.id !== session.id);

  const copy: Record<
    SessionAction,
    { title: string; description: string; confirm: string; done: string }
  > = {
    change: {
      title: `Trocar a mesa ${table.name}`,
      description: 'O grupo muda para uma mesa livre levando todas as contas.',
      confirm: 'Trocar mesa',
      done: 'Mesa trocada',
    },
    merge: {
      title: `Juntar à mesa ${table.name}`,
      description: 'A outra mesa e as contas dela passam a fazer parte desta.',
      confirm: 'Juntar mesas',
      done: 'Mesas juntadas',
    },
    split: {
      title: 'Separar mesas',
      description: 'Escolha a mesa que sai e as contas que vão com ela.',
      confirm: 'Separar',
      done: 'Mesas separadas',
    },
  };

  async function submit() {
    if (!action) return;
    setBusy(true);
    try {
      let list: TableDto[];
      if (action === 'change') {
        list = await changeTable(session.id, { fromTableId: table.id, toTableId: tableId! });
      } else if (action === 'merge') {
        const source = tables.find((t) => t.id === tableId)!.session!.id;
        list = await mergeTables(session.id, { sourceSessionId: source });
      } else {
        list = await splitTables(session.id, { tableId: leaving, orderIds });
      }
      queryClient.setQueryData(orderKeys.tables, list);
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      toast.success(copy[action].done);
      onOpenChange(false);
    } catch (error) {
      handleError(error, queryClient);
    } finally {
      setBusy(false);
    }
  }

  const ready = action === 'split' ? !!leaving : !!tableId;

  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {action && (
          <>
            <DialogHeader>
              <DialogTitle>{copy[action].title}</DialogTitle>
              <DialogDescription>{copy[action].description}</DialogDescription>
            </DialogHeader>
            {action === 'change' && (
              <TableGrid
                tables={free}
                value={tableId}
                onChange={setTableId}
                empty="Nenhuma mesa livre."
              />
            )}
            {action === 'merge' && (
              <TableGrid
                tables={occupied}
                value={tableId}
                onChange={setTableId}
                empty="Nenhuma outra mesa ocupada para juntar."
              />
            )}
            {action === 'split' && (
              <div className="space-y-3">
                <Field label="Mesa que sai">
                  <Select value={leaving} onValueChange={setLeaving}>
                    <SelectTrigger aria-label="Mesa que sai" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {linked.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          Mesa {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Contas que vão com ela</legend>
                  {session.tabs.map((tab) => (
                    <Label key={tab.orderId} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={orderIds.includes(tab.orderId)}
                        onCheckedChange={(on) =>
                          setOrderIds((ids) =>
                            on === true
                              ? [...ids, tab.orderId]
                              : ids.filter((id) => id !== tab.orderId),
                          )
                        }
                      />
                      #{tab.number}
                      {tab.tabLabel ? ` · ${tab.tabLabel}` : ''} · {formatBRL(tab.totalCents)}
                    </Label>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Sem contas, a mesa que sai fica livre.
                  </p>
                </fieldset>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => void submit()} loading={busy} disabled={!ready}>
                {copy[action].confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
