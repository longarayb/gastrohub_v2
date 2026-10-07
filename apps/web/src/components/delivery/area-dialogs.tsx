'use client';

import { type DeliveryAreaDto, deliveryAreaSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Controller } from 'react-hook-form';
import {
  Field,
  MoneyField,
  NumberField,
  TextField,
  applyApiErrors,
  useZodForm,
} from '@/components/form';
import { errorMessage } from '@/lib/api';
import {
  createDeliveryArea,
  deliveryKeys,
  pauseDeliveryArea,
  updateDeliveryArea,
} from '@/lib/delivery';

/** New area or edit: by neighborhood (suggested) or by radius from the store. */
export function AreaFormDialog({
  area,
  open,
  onOpenChange,
}: {
  area: DeliveryAreaDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <AreaForm area={area} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AreaForm({ area, onDone }: { area: DeliveryAreaDto | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const ids = { names: useId(), radius: useId() };
  const form = useZodForm(deliveryAreaSchema, {
    name: area?.name ?? '',
    kind: area?.kind ?? 'NEIGHBORHOOD',
    neighborhoods: area?.neighborhoods ?? [],
    city: area?.city ?? '',
    radiusMeters: area?.radiusMeters ?? 3000,
    feeCents: area?.feeCents ?? 0,
    etaMinutes: area?.etaMinutes ?? 40,
    minimumOrderCents: area?.minimumOrderCents ?? null,
    freeAboveCents: area?.freeAboveCents ?? null,
  });
  const kind = form.watch('kind');

  const submit = form.handleSubmit(async (values) => {
    try {
      const input = {
        ...values,
        // 0 = no minimum / never free.
        minimumOrderCents: values.minimumOrderCents || null,
        freeAboveCents: values.freeAboveCents || null,
      };
      if (area) await updateDeliveryArea(area.id, input);
      else await createDeliveryArea(input);
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      toast.success(area ? 'Área atualizada' : 'Área criada');
      onDone();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{area ? `Editar ${area.name}` : 'Nova área de entrega'}</DialogTitle>
        <DialogDescription>
          Por bairro funciona sem mapa. Por raio usa a localização do endereço.
        </DialogDescription>
      </DialogHeader>
      <TextField control={form.control} name="name" label="Nome da área" autoFocus />
      <Controller
        control={form.control}
        name="kind"
        render={({ field }) => (
          <div role="radiogroup" aria-label="Tipo de área" className="grid grid-cols-2 gap-2">
            {(
              [
                ['NEIGHBORHOOD', 'Por bairro (recomendado)'],
                ['RADIUS', 'Por raio (km)'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={field.value === value}
                variant={field.value === value ? 'default' : 'outline'}
                onClick={() => field.onChange(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      />
      {kind === 'NEIGHBORHOOD' ? (
        <>
          <Controller
            control={form.control}
            name="neighborhoods"
            render={({ field, fieldState }) => (
              <Field
                label="Bairros e variações de nome (um por linha)"
                htmlFor={ids.names}
                error={fieldState.error?.message}
                hint="Ex.: Centro, Centro Histórico. Acentos e maiúsculas não importam."
              >
                <Textarea
                  id={ids.names}
                  rows={4}
                  defaultValue={(field.value ?? []).join('\n')}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value
                        .split('\n')
                        .map((n) => n.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            )}
          />
          <TextField
            control={form.control}
            name="city"
            label="Cidade (opcional)"
            hint="Em branco: qualquer cidade atendida"
          />
        </>
      ) : (
        <Controller
          control={form.control}
          name="radiusMeters"
          render={({ field, fieldState }) => (
            <Field
              label="Raio a partir da loja (km)"
              htmlFor={ids.radius}
              error={fieldState.error?.message}
              hint="Cadastre a localização da loja em Empresa"
            >
              <Input
                id={ids.radius}
                type="number"
                inputMode="decimal"
                step={0.5}
                min={0.1}
                value={((field.value as number | null) ?? 0) / 1000}
                onChange={(e) => field.onChange(Math.round(Number(e.target.value || 0) * 1000))}
              />
            </Field>
          )}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField control={form.control} name="feeCents" label="Taxa de entrega" />
        <NumberField control={form.control} name="etaMinutes" label="Tempo de entrega (min)" />
        <MoneyField
          control={form.control}
          name="minimumOrderCents"
          label="Pedido mínimo"
          hint="Zero: usa o mínimo da loja"
        />
        <MoneyField
          control={form.control}
          name="freeAboveCents"
          label="Grátis acima de"
          hint="Zero: sempre cobra"
        />
      </div>
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

const QUICK_REASONS = ['Chuva', 'Sem entregador', 'Muitos pedidos'];

/** Suspends deliveries to an area for a while (optional automatic resume today). */
export function PauseAreaDialog({
  area,
  onOpenChange,
}: {
  area: DeliveryAreaDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { reason: useId(), until: useId() };
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if ((area?.id ?? null) !== lastId) {
    setLastId(area?.id ?? null);
    setReason('');
    setUntil('');
    setError(undefined);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!area) return;
    if (reason.trim().length < 3) return setError('Informe o motivo');
    let untilDate: Date | null = null;
    if (until) {
      const [h, m] = until.split(':').map(Number);
      untilDate = new Date();
      untilDate.setHours(h!, m!, 0, 0);
      if (untilDate <= new Date()) untilDate.setDate(untilDate.getDate() + 1);
    }
    setBusy(true);
    try {
      await pauseDeliveryArea(area.id, { reason: reason.trim(), until: untilDate });
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      toast.success(`Entrega suspensa para ${area.name}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!area} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Suspender {area?.name}</DialogTitle>
            <DialogDescription>
              Novos pedidos para esta área ficam bloqueados até você retomar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={reason === r ? 'default' : 'outline'}
                onClick={() => {
                  setReason(r);
                  setError(undefined);
                }}
              >
                {r}
              </Button>
            ))}
          </div>
          <Field label="Motivo" htmlFor={ids.reason} error={error}>
            <Input
              id={ids.reason}
              value={reason}
              maxLength={120}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <Field
            label="Retomar automaticamente às (opcional)"
            htmlFor={ids.until}
            hint="Em branco: só volta quando alguém retomar"
          >
            <Input
              id={ids.until}
              type="time"
              className="w-32"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" loading={busy}>
              Suspender
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
