'use client';

import { type CouponDto, couponSchema, formatBRL } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@app/ui/components/table';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, TicketPercent } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import {
  Field,
  MoneyField,
  PercentField,
  TextField,
  applyApiErrors,
  useZodForm,
} from '@/components/form';
import { EmptyState, Page } from '@/components/page';
import { errorMessage } from '@/lib/api';
import { createCoupon, orderKeys, updateCoupon, useCoupons } from '@/lib/orders';

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(iso));

function couponValueLabel(c: Pick<CouponDto, 'type' | 'value'>) {
  return c.type === 'PERCENT' ? `${c.value / 100}%` : formatBRL(c.value);
}

function DateField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: Date | string | null | undefined;
  onChange: (value: string | null) => void;
  error?: string;
}) {
  const id = useId();
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : (value ?? '');
  return (
    <Field label={label} htmlFor={id} error={error}>
      <Input id={id} type="date" value={text} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}

function CouponDialog({
  coupon,
  open,
  onOpenChange,
}: {
  coupon: CouponDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(couponSchema, { code: '', type: 'PERCENT', value: 1000, isActive: true });
  const type = useWatch({ control: form.control, name: 'type' });

  useEffect(() => {
    if (!open) return;
    form.reset({
      code: coupon?.code ?? '',
      type: coupon?.type ?? 'PERCENT',
      value: coupon?.value ?? 1000,
      minOrderCents: coupon?.minOrderCents ?? null,
      maxDiscountCents: coupon?.maxDiscountCents ?? null,
      validFrom: toDateInput(coupon?.validFrom ?? null) || null,
      validUntil: toDateInput(coupon?.validUntil ?? null) || null,
      usageLimit: coupon?.usageLimit ?? null,
      isActive: coupon?.isActive ?? true,
    });
  }, [open, coupon, form]);

  const submit = form.handleSubmit(async (parsed) => {
    // Zero in the optional money fields means "no limit".
    const values = {
      ...parsed,
      minOrderCents: parsed.minOrderCents || null,
      maxDiscountCents: parsed.maxDiscountCents || null,
    };
    try {
      if (coupon) await updateCoupon(coupon.id, values);
      else await createCoupon(values);
      await queryClient.invalidateQueries({ queryKey: orderKeys.coupons });
      toast.success(coupon ? 'Cupom atualizado' : 'Cupom criado');
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{coupon ? `Editar ${coupon.code}` : 'Novo cupom'}</DialogTitle>
          </DialogHeader>
          <TextField
            control={form.control}
            name="code"
            label="Código"
            className="uppercase"
            autoFocus
          />
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <div className="flex gap-2" role="radiogroup" aria-label="Tipo de desconto">
                {(['PERCENT', 'FIXED'] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={field.value === t}
                    variant={field.value === t ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      field.onChange(t);
                      // 10% or R$ 10,00 as a starting point.
                      form.setValue('value', 1000);
                    }}
                  >
                    {t === 'PERCENT' ? 'Percentual' : 'Valor fixo'}
                  </Button>
                ))}
              </div>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            {type === 'PERCENT' ? (
              <PercentField control={form.control} name="value" label="Desconto (%)" />
            ) : (
              <MoneyField control={form.control} name="value" label="Desconto (R$)" />
            )}
            <MoneyField
              control={form.control}
              name="maxDiscountCents"
              label="Desconto máximo"
              hint="R$ 0,00 = sem limite"
            />
            <MoneyField
              control={form.control}
              name="minOrderCents"
              label="Pedido mínimo"
              hint="R$ 0,00 = sem mínimo"
            />
            <Controller
              control={form.control}
              name="usageLimit"
              render={({ field, fieldState }) => (
                <Field
                  label="Limite de usos"
                  hint="Vazio = ilimitado"
                  error={fieldState.error?.message}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    aria-label="Limite de usos"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                  />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="validFrom"
              render={({ field, fieldState }) => (
                <DateField
                  label="Válido a partir de"
                  value={field.value as Date | string | null}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={form.control}
              name="validUntil"
              render={({ field, fieldState }) => (
                <DateField
                  label="Válido até"
                  value={field.value as Date | string | null}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={field.value ?? true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
                Cupom ativo
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

export default function CouponsPage() {
  const { data: coupons, isLoading } = useCoupons();
  const [editing, setEditing] = useState<CouponDto | 'new' | null>(null);

  return (
    <Page
      title="Cupons"
      description="Descontos aplicados depois dos descontos manuais, antes da taxa de serviço."
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus /> Novo cupom
        </Button>
      }
    >
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !coupons?.length ? (
        <EmptyState icon={TicketPercent} title="Nenhum cupom cadastrado" />
      ) : (
        <div className="overflow-hidden rounded-card border bg-card max-md:border-0 max-md:bg-transparent">
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Desconto</TableHead>
                <TableHead>Regras</TableHead>
                <TableHead>Usos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c) => (
                <TableRow key={c.id}>
                  <TableCell label="Código" className="font-medium">
                    {c.code}
                  </TableCell>
                  <TableCell label="Desconto" className="tabular">
                    {couponValueLabel(c)}
                  </TableCell>
                  <TableCell label="Regras" className="text-xs text-muted-foreground">
                    {[
                      c.minOrderCents ? `mín. ${formatBRL(c.minOrderCents)}` : null,
                      c.maxDiscountCents ? `máx. ${formatBRL(c.maxDiscountCents)}` : null,
                      c.validUntil ? `até ${formatDate(c.validUntil)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </TableCell>
                  <TableCell label="Usos" className="tabular">
                    {c.usedCount}
                    {c.usageLimit ? ` / ${c.usageLimit}` : ''}
                  </TableCell>
                  <TableCell label="Status">
                    <Badge variant={c.isActive ? 'success' : 'secondary'}>
                      {c.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Editar ${c.code}`}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <CouponDialog
        coupon={editing === 'new' ? null : editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </Page>
  );
}
