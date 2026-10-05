'use client';

import {
  ORDER_PAYMENT_STATUS_LABELS,
  Permission,
  type TableDto,
  formatBRL,
  tableSchema,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
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
import {
  ArrowLeftRight,
  Combine,
  LayoutGrid,
  Pencil,
  Plus,
  Printer,
  Settings2,
  Split,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Controller } from 'react-hook-form';
import { Field, NumberField, TextField, applyApiErrors, useZodForm } from '@/components/form';
import { elapsedLabel, useNow } from '@/components/orders/common';
import { OrderDetailSheet } from '@/components/orders/order-detail-sheet';
import { EmptyState, Page } from '@/components/page';
import { PreBillDialog } from '@/components/pos/pre-bill';
import { SessionActionDialog, sessionTables } from '@/components/pos/table-actions';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  createArea,
  createTable,
  orderKeys,
  removeArea,
  updateTable,
  useAreas,
  useTables,
} from '@/lib/orders';

const NO_AREA = 'none';

function TableFormDialog({
  table,
  open,
  onOpenChange,
}: {
  table: TableDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: areas } = useAreas();
  const form = useZodForm(tableSchema, { name: '', areaId: null, seats: null, isActive: true });

  useEffect(() => {
    if (open) {
      form.reset({
        name: table?.name ?? '',
        areaId: table?.areaId ?? null,
        seats: table?.seats ?? null,
        isActive: table?.isActive ?? true,
      });
    }
  }, [open, table, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const tables = table ? await updateTable(table.id, values) : await createTable(values);
      queryClient.setQueryData(orderKeys.tables, tables);
      toast.success(table ? 'Mesa atualizada' : 'Mesa criada');
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{table ? `Editar mesa ${table.name}` : 'Nova mesa'}</DialogTitle>
          </DialogHeader>
          <TextField control={form.control} name="name" label="Número ou nome" autoFocus />
          <Controller
            control={form.control}
            name="areaId"
            render={({ field }) => (
              <Field label="Área">
                <Select
                  value={field.value ?? NO_AREA}
                  onValueChange={(v) => field.onChange(v === NO_AREA ? null : v)}
                >
                  <SelectTrigger aria-label="Área" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_AREA}>Sem área</SelectItem>
                    {areas?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <NumberField control={form.control} name="seats" label="Lugares (opcional)" min={1} />
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={field.value ?? true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
                Mesa ativa
              </Label>
            )}
          />
          <DialogFooter>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AreasDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: areas } = useAreas();
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const id = useId();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orderKeys.areas }),
      queryClient.invalidateQueries({ queryKey: orderKeys.tables }),
    ]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createArea(name.trim());
      setName('');
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Áreas</DialogTitle>
          <DialogDescription>Agrupe as mesas por ambiente (salão, varanda...).</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {areas?.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">Nenhuma área cadastrada.</li>
          )}
          {areas?.map((a) => (
            <li key={a.id} className="flex items-center justify-between p-2 pl-3 text-sm">
              {a.name}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Excluir ${a.name}`}
                onClick={() => setRemoving(a.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex items-end gap-2">
          <Field label="Nova área" htmlFor={id} className="flex-1">
            <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" variant="outline">
            Adicionar
          </Button>
        </form>
        <ConfirmDialog
          open={!!removing}
          onOpenChange={(o) => !o && setRemoving(null)}
          title="Excluir área?"
          description="As mesas desta área ficam sem área."
          confirmLabel="Excluir"
          destructive
          onConfirm={async () => {
            try {
              await removeArea(removing!);
              await refresh();
            } catch (error) {
              toast.error(errorMessage(error));
            }
            setRemoving(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function TableDialog({
  table,
  onOpenChange,
  onOpenOrder,
}: {
  table: TableDto | null;
  onOpenChange: (open: boolean) => void;
  onOpenOrder: (id: string) => void;
}) {
  const { can } = useAuth();
  const now = useNow();
  const { data: tables = [] } = useTables();
  const [panel, setPanel] = useState<'pre-bill' | 'change' | 'merge' | 'split' | null>(null);
  const session = table?.session;
  const linked = session ? sessionTables(tables, session.id) : [];
  const canOperate = can(Permission.TABLES_OPERATE);
  return (
    <Dialog open={!!table} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Mesa {linked.length > 1 ? linked.map((t) => t.name).join(' + ') : table?.name}
          </DialogTitle>
          <DialogDescription>
            {session
              ? `Aberta há ${elapsedLabel(session.openedAt, now)} · ${session.tabs.length} conta(s)${
                  session.billRequestedAt ? ' · aguardando pagamento' : ''
                }`
              : 'Mesa livre'}
          </DialogDescription>
        </DialogHeader>
        {session && session.tabs.length > 0 && (
          <ul className="divide-y rounded-md border">
            {session.tabs.map((tab) => (
              <li key={tab.orderId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm hover:bg-accent"
                  onClick={() => onOpenOrder(tab.orderId)}
                >
                  <span>
                    <span className="font-medium">#{tab.number}</span>
                    {tab.tabLabel ? ` · ${tab.tabLabel}` : ''}
                    <span className="block text-xs text-muted-foreground">
                      {ORDER_PAYMENT_STATUS_LABELS[tab.paymentStatus]}
                      {tab.paidCents > 0 ? ` · pago ${formatBRL(tab.paidCents)}` : ''}
                    </span>
                  </span>
                  <span className="tabular">{formatBRL(tab.totalCents - tab.paidCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {table && session && canOperate && (
          <div className="flex flex-wrap gap-2">
            {session.tabs.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setPanel('pre-bill')}>
                <Printer /> Pré-conta
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setPanel('change')}>
              <ArrowLeftRight /> Trocar mesa
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPanel('merge')}>
              <Combine /> Juntar mesas
            </Button>
            {linked.length > 1 && (
              <Button size="sm" variant="outline" onClick={() => setPanel('split')}>
                <Split /> Separar
              </Button>
            )}
          </div>
        )}
        {table && can(Permission.ORDERS_CREATE) && (
          <DialogFooter>
            <Button asChild>
              <Link href={`/pedidos/novo?mesa=${table.id}&origem=mesas` as never}>
                <Plus /> {session ? 'Nova conta' : 'Abrir mesa'}
              </Link>
            </Button>
          </DialogFooter>
        )}
        {table && panel === 'pre-bill' && (
          <PreBillDialog table={table} open onOpenChange={(o) => !o && setPanel(null)} />
        )}
        {table && session && panel && panel !== 'pre-bill' && (
          <SessionActionDialog
            table={table}
            action={panel}
            onOpenChange={(o) => !o && setPanel(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function TablesPage() {
  const { can } = useAuth();
  const now = useNow();
  const { data: tables, isLoading } = useTables();
  const canManage = can(Permission.TABLES_MANAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TableDto | 'new' | null>(null);
  const [areasOpen, setAreasOpen] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  const visible = (tables ?? []).filter((t) => t.isActive || canManage);
  const groups = new Map<string, TableDto[]>();
  for (const t of visible) {
    const key = t.areaName ?? 'Sem área';
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const selectedTable = tables?.find((t) => t.id === selected) ?? null;
  const occupied = visible.filter((t) => t.session).length;
  const awaiting = visible.filter((t) => t.session?.billRequestedAt).length;

  return (
    <Page
      title="Mesas"
      description={
        tables
          ? `${occupied} de ${visible.length} ocupadas${awaiting ? ` · ${awaiting} aguardando pagamento` : ''}`
          : undefined
      }
      className="max-w-none"
      actions={
        canManage && (
          <>
            <Button variant="outline" onClick={() => setAreasOpen(true)}>
              <Settings2 /> Áreas
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> Nova mesa
            </Button>
          </>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Nenhuma mesa cadastrada"
          description={canManage ? 'Cadastre as mesas para lançar pedidos no salão.' : undefined}
        />
      ) : (
        [...groups].map(([area, items]) => (
          <section key={area} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{area}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {items.map((t) => {
                const total =
                  t.session?.tabs.reduce((sum, tab) => sum + tab.totalCents - tab.paidCents, 0) ??
                  0;
                const billing = !!t.session?.billRequestedAt;
                return (
                  <div key={t.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setSelected(t.id)}
                      className={cn(
                        'flex h-28 w-full flex-col justify-between rounded-xl border p-3 text-left transition-colors',
                        !t.session
                          ? 'bg-card hover:bg-accent'
                          : billing
                            ? 'border-table-billing bg-table-billing/10 hover:bg-table-billing/15'
                            : 'border-table-occupied bg-table-occupied/10 hover:bg-table-occupied/15',
                        !t.isActive && 'opacity-50',
                      )}
                    >
                      <span className="text-lg font-semibold">{t.name}</span>
                      {t.session ? (
                        <span className="space-y-0.5 text-xs">
                          <span className="tabular block font-medium">{formatBRL(total)}</span>
                          <span className="block text-muted-foreground">
                            {billing ? 'Aguardando pagamento' : `${t.session.tabs.length} conta(s)`}{' '}
                            · {elapsedLabel(t.session.openedAt, now)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t.isActive ? 'Livre' : 'Inativa'}
                          {t.seats ? ` · ${t.seats} lugares` : ''}
                        </span>
                      )}
                    </button>
                    {canManage && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="absolute top-1 right-1"
                        aria-label={`Editar mesa ${t.name}`}
                        onClick={() => setEditing(t)}
                      >
                        <Pencil />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <TableDialog
        table={selectedTable}
        onOpenChange={(o) => !o && setSelected(null)}
        onOpenOrder={(id) => {
          setSelected(null);
          setOrderId(id);
        }}
      />
      <TableFormDialog
        table={editing === 'new' ? null : editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <AreasDialog open={areasOpen} onOpenChange={setAreasOpen} />
      <OrderDetailSheet orderId={orderId} onOpenChange={(o) => !o && setOrderId(null)} />
    </Page>
  );
}
