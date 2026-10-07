'use client';

import {
  type CourierDetailDto,
  Permission,
  type Role,
  courierPaySchema,
  courierUpdateSchema,
  formatBRL,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Skeleton, Switch } from '@app/ui/components/misc';
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
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller } from 'react-hook-form';
import {
  Field,
  MaskedField,
  MoneyField,
  MoneyInput,
  PercentField,
  TextField,
  applyApiErrors,
  useZodForm,
} from '@/components/form';
import { formatClock } from '@/components/orders/common';
import { apiGet, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  deliveryKeys,
  formatBps,
  payCourier,
  updateCourier,
  updateCourierPaySettings,
  useCourierLedger,
  useCourierPaySettings,
} from '@/lib/delivery';
import { createCourier, orderKeys } from '@/lib/orders';

interface StoreUser {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
}

/** "A pagar R$ 19,00" (restaurant owes) / "Deve R$ 2,00" (courier owes). */
export function BalanceText({ cents, className }: { cents: number; className?: string }) {
  if (cents === 0) return <span className={cn('text-muted-foreground', className)}>Sem saldo</span>;
  return cents > 0 ? (
    <span className={cn('tabular font-medium', className)}>A pagar {formatBRL(cents)}</span>
  ) : (
    <span className={cn('tabular font-medium text-destructive', className)}>
      Deve {formatBRL(-cents)}
    </span>
  );
}

/** New courier or edit: contact, app user (role Entregador), own pay rule. */
export function CourierFormDialog({
  courier,
  open,
  onOpenChange,
}: {
  /** null = new courier. */
  courier: CourierDetailDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <CourierForm courier={courier} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CourierForm({
  courier,
  onDone,
}: {
  courier: CourierDetailDto | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canUsers = can(Permission.USERS_MANAGE);
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<StoreUser[]>('/users'),
    enabled: canUsers,
  });
  const [ownPay, setOwnPay] = useState(
    !!courier &&
      (courier.perDeliveryCents != null ||
        courier.feeShareBps != null ||
        courier.dailyCents != null),
  );
  const form = useZodForm(courierUpdateSchema, {
    name: courier?.name ?? '',
    phone: courier?.phone ?? '',
    isActive: courier?.isActive ?? true,
    userId: courier?.userId ?? null,
    perDeliveryCents: courier?.perDeliveryCents ?? 0,
    feeShareBps: courier?.feeShareBps ?? 0,
    dailyCents: courier?.dailyCents ?? 0,
  });
  const couriers = (users.data ?? []).filter((u) => u.role === 'COURIER' && u.isActive);

  const submit = form.handleSubmit(async (values) => {
    const input = {
      ...values,
      perDeliveryCents: ownPay ? values.perDeliveryCents : null,
      feeShareBps: ownPay ? values.feeShareBps : null,
      dailyCents: ownPay ? values.dailyCents : null,
    };
    try {
      const id = courier
        ? courier.id
        : (await createCourier({ name: values.name, phone: values.phone ?? undefined })).id;
      await updateCourier(id, input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deliveryKeys.all }),
        queryClient.invalidateQueries({ queryKey: orderKeys.couriers }),
      ]);
      toast.success(courier ? 'Entregador atualizado' : 'Entregador cadastrado');
      onDone();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{courier ? `Editar ${courier.name}` : 'Novo entregador'}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Nome" autoFocus />
        <MaskedField control={form.control} name="phone" label="Telefone" mask="phone" />
      </div>
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <label className="flex items-center justify-between gap-3 text-sm">
            Ativo (aparece na saída para entrega)
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </label>
        )}
      />
      {canUsers && (
        <Controller
          control={form.control}
          name="userId"
          render={({ field, fieldState }) => (
            <Field
              label="Usuário do app de entregas"
              error={fieldState.error?.message}
              hint="Usuários com o papel Entregador. Ele vê só as próprias entregas."
            >
              <Select
                value={field.value ?? 'none'}
                onValueChange={(v) => field.onChange(v === 'none' ? null : v)}
              >
                <SelectTrigger className="w-full" aria-label="Usuário do app de entregas">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem usuário (a loja registra as entregas)</SelectItem>
                  {couriers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
      )}
      <label className="flex items-center justify-between gap-3 text-sm">
        Remuneração própria (senão, usa a padrão da loja)
        <Switch checked={ownPay} onCheckedChange={setOwnPay} />
      </label>
      {ownPay && (
        <div className="grid gap-3 sm:grid-cols-3">
          <MoneyField control={form.control} name="perDeliveryCents" label="Por entrega" />
          <PercentField control={form.control} name="feeShareBps" label="% da taxa" />
          <MoneyField control={form.control} name="dailyCents" label="Diária" />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Store default pay: per delivery, share of the delivery fee and daily (D030). */
export function PaySettingsCard() {
  const { can } = useAuth();
  const { data } = useCourierPaySettings();
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>Remuneração padrão</CardTitle>
          <CardDescription>
            Vale para quem não tem remuneração própria. A diária entra no primeiro acerto do dia.
          </CardDescription>
        </div>
        {can(Permission.DELIVERY_MANAGE) && !editing && data && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Alterar
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-10" />
        ) : editing ? (
          <PaySettingsForm initial={data} onDone={() => setEditing(false)} />
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Por entrega</dt>
              <dd className="tabular font-medium">{formatBRL(data.perDeliveryCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">% da taxa</dt>
              <dd className="tabular font-medium">{formatBps(data.feeShareBps)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Diária</dt>
              <dd className="tabular font-medium">{formatBRL(data.dailyCents)}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function PaySettingsForm({
  initial,
  onDone,
}: {
  initial: { perDeliveryCents: number; feeShareBps: number; dailyCents: number };
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(courierPaySchema, initial);
  const submit = form.handleSubmit(async (values) => {
    try {
      queryClient.setQueryData(deliveryKeys.settings, await updateCourierPaySettings(values));
      toast.success('Remuneração atualizada');
      onDone();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyField control={form.control} name="perDeliveryCents" label="Por entrega" />
        <PercentField control={form.control} name="feeShareBps" label="% da taxa" />
        <MoneyField control={form.control} name="dailyCents" label="Diária" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

const LEDGER_LABELS = { EARNING: 'Remuneração', PAYOUT: 'Pagamento', SHORTAGE: 'Falta descontada' };

/** Running balance of a courier with a payout from the open register (weekly, for example). */
export function LedgerSheet({
  courier,
  onOpenChange,
}: {
  courier: CourierDetailDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useAuth();
  const ledger = useCourierLedger(courier?.id ?? null);
  const [payOpen, setPayOpen] = useState(false);
  return (
    <Sheet open={!!courier} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Extrato · {courier?.name}</SheetTitle>
          <SheetDescription asChild>
            <div>
              {courier && <BalanceText cents={courier.balanceCents} className="text-base" />}
            </div>
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {can(Permission.CASH_OPERATE) && courier && courier.balanceCents > 0 && (
            <Button onClick={() => setPayOpen(true)}>
              <Wallet /> Pagar entregador
            </Button>
          )}
          {ledger.isLoading ? (
            <Skeleton className="h-40" />
          ) : !ledger.data?.length ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {ledger.data.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 p-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{LEDGER_LABELS[e.type]}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                      })}{' '}
                      {formatClock(e.createdAt)}
                      {e.createdByName ? ` · ${e.createdByName}` : ''}
                      {e.reason ? ` · ${e.reason}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        'tabular font-medium',
                        e.amountCents < 0 && 'text-muted-foreground',
                      )}
                    >
                      {e.amountCents > 0 ? '+' : '−'}
                      {formatBRL(Math.abs(e.amountCents))}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      saldo {formatBRL(e.balanceAfterCents)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {courier && <PayoutDialog courier={courier} open={payOpen} onOpenChange={setPayOpen} />}
      </SheetContent>
    </Sheet>
  );
}

function PayoutDialog({
  courier,
  open,
  onOpenChange,
}: {
  courier: CourierDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { amount: useId(), reason: useId() };
  const [amount, setAmount] = useState(courier.balanceCents);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAmount(courier.balanceCents);
      setReason('');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      queryClient.setQueryData(
        deliveryKeys.ledger(courier.id),
        await payCourier(courier.id, { amountCents: amount, reason: reason.trim() || null }),
      );
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.couriers });
      toast.success(`Pagamento de ${formatBRL(amount)} registrado (sangria do caixa)`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Pagar {courier.name}</DialogTitle>
            <DialogDescription>
              Sai do seu caixa aberto como sangria. Saldo: {formatBRL(courier.balanceCents)}.
            </DialogDescription>
          </DialogHeader>
          <Field label="Valor" htmlFor={ids.amount}>
            <MoneyInput id={ids.amount} value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Observação (opcional)" htmlFor={ids.reason}>
            <Input
              id={ids.reason}
              value={reason}
              maxLength={200}
              placeholder="Ex.: pagamento semanal"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" loading={busy} disabled={amount <= 0}>
              Pagar {formatBRL(amount)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
