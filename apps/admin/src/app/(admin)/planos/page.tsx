'use client';

import {
  BILLING_INTERVALS,
  BILLING_INTERVAL_LABELS,
  PLATFORM_MODULES,
  PLATFORM_MODULE_LABELS,
  type PlanDto,
  formatBRL,
  planSchema,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Label } from '@app/ui/components/label';
import { Switch } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { ListSkeleton } from '@app/ui/components/states';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import {
  Field,
  MoneyField,
  NumberField,
  TextField,
  applyApiErrors,
  useZodForm,
} from '@/components/form';
import { Page } from '@/components/page';
import { apiPost, apiPut, errorMessage } from '@/lib/api';
import { usePlans, useRefresh } from '@/lib/queries';

function PlanForm({ plan, onDone }: { plan: PlanDto | null; onDone: () => void }) {
  const refresh = useRefresh();
  const form = useZodForm(planSchema, {
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    priceCents: plan?.priceCents ?? 0,
    interval: plan?.interval ?? 'MONTHLY',
    trialDays: plan?.trialDays ?? 14,
    storeLimit: plan?.storeLimit ?? 1,
    extraStorePriceCents: plan?.extraStorePriceCents ?? null,
    modules: plan?.modules ?? [],
    isActive: plan?.isActive ?? true,
    sortOrder: plan?.sortOrder ?? 0,
  });
  const extra = useWatch({ control: form.control, name: 'extraStorePriceCents' });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (plan) await apiPut(`/plans/${plan.id}`, values);
      else await apiPost('/plans', values);
      await refresh();
      toast.success(plan ? 'Plano alterado' : 'Plano criado');
      onDone();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{plan ? `Plano ${plan.name}` : 'Novo plano'}</DialogTitle>
        <DialogDescription>
          Mudar limites e módulos vale na hora para os clientes do plano; o preço dos clientes
          atuais não muda.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Nome" autoFocus />
        <Controller
          control={form.control}
          name="interval"
          render={({ field }) => (
            <Field label="Periodicidade">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label="Periodicidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_INTERVALS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {BILLING_INTERVAL_LABELS[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <MoneyField control={form.control} name="priceCents" label="Preço por período" />
        <NumberField control={form.control} name="trialDays" label="Dias de teste" min={0} />
        <NumberField control={form.control} name="storeLimit" label="Unidades incluídas" min={1} />
        <div className="space-y-2">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={extra != null}
              onCheckedChange={(v) => form.setValue('extraStorePriceCents', v === true ? 0 : null)}
            />
            Permite unidades adicionais
          </Label>
          {extra != null && (
            <MoneyField
              control={form.control}
              name="extraStorePriceCents"
              label="Valor por unidade adicional (por período)"
            />
          )}
        </div>
        <TextField
          control={form.control}
          name="description"
          label="Descrição (opcional)"
          className="sm:col-span-2"
        />
      </div>
      <Controller
        control={form.control}
        name="modules"
        render={({ field }) => (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Módulos incluídos</legend>
            {PLATFORM_MODULES.map((m) => {
              const selected = (field.value ?? []).includes(m);
              return (
                <Label key={m} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(v) =>
                      field.onChange(
                        v === true
                          ? [...(field.value ?? []), m]
                          : (field.value ?? []).filter((x) => x !== m),
                      )
                    }
                  />
                  {PLATFORM_MODULE_LABELS[m]}
                </Label>
              );
            })}
          </fieldset>
        )}
      />
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <Label className="flex items-center gap-2 font-normal">
            <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
            Disponível para novos clientes
          </Label>
        )}
      />
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

export default function PlansPage() {
  const { data, isLoading } = usePlans();
  const [editing, setEditing] = useState<PlanDto | 'new' | null>(null);

  return (
    <Page
      title="Planos"
      description="Preço, periodicidade, unidades incluídas e módulos."
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus /> Novo plano
        </Button>
      }
    >
      {isLoading || !data ? (
        <ListSkeleton rows={3} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {p.name}
                  {!p.isActive && <Badge variant="secondary">Inativo</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-2xl font-extrabold tabular-nums">
                  {formatBRL(p.priceCents)}{' '}
                  <span className="text-sm font-semibold text-muted-foreground">
                    {BILLING_INTERVAL_LABELS[p.interval].toLowerCase()}
                  </span>
                </p>
                <p>
                  {p.storeLimit} unidade(s)
                  {p.extraStorePriceCents != null
                    ? ` + adicionais a ${formatBRL(p.extraStorePriceCents)}`
                    : ' (limite fixo)'}
                  {p.trialDays ? ` · ${p.trialDays} dias de teste` : ''}
                </p>
                <ul className="flex flex-wrap gap-1">
                  {p.modules.map((m) => (
                    <li key={m}>
                      <Badge variant="outline">{PLATFORM_MODULE_LABELS[m]}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">{p.subscribers} cliente(s)</p>
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  Editar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          {editing && (
            <PlanForm
              key={editing === 'new' ? 'new' : editing.id}
              plan={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
