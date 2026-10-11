'use client';

import {
  BILLING_INTERVAL_LABELS,
  type CustomerDetailDto,
  billingDate,
  createCustomerSchema,
  fetchAddressByCEP,
  formatBRL,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import { Input } from '@app/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import {
  Field,
  MaskedField,
  MoneyField,
  NumberField,
  TextField,
  applyApiErrors,
  useZodForm,
} from '@/components/form';
import { Page } from '@/components/page';
import { apiPost, errorMessage } from '@/lib/api';
import { usePlans, useRefresh } from '@/lib/queries';

/**
 * New customer (D041): organization with the invoice data, first store, owner (receives the
 * invitation e-mail) and subscription, all at once.
 */
export default function NewCustomerPage() {
  const router = useRouter();
  const refresh = useRefresh();
  const { data: plans } = usePlans();
  const startId = useId();
  const form = useZodForm(createCustomerSchema, {
    customer: {
      name: '',
      document: '',
      legalName: '',
      municipalRegistration: '',
      invoiceEmail: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      address: {
        cep: '',
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        city: '',
        state: '',
      },
      notes: '',
    },
    store: { tradeName: '', cnpj: '', phone: '' },
    owner: { name: '', email: '', phone: '' },
    subscription: {
      planId: '',
      priceCents: null,
      trialDays: null,
      startDate: billingDate(new Date()),
    },
  });
  const planId = useWatch({ control: form.control, name: 'subscription.planId' });
  const plan = plans?.find((p) => p.id === planId);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await apiPost<CustomerDetailDto>('/customers', values);
      await refresh();
      toast.success('Cliente cadastrado. O convite foi enviado ao dono por e-mail.');
      router.replace(`/clientes/${created.id}` as never);
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  async function lookupCep(cep: string) {
    if (cep.replace(/\D/g, '').length !== 8) return;
    const address = await fetchAddressByCEP(cep).catch(() => null);
    if (!address) return;
    form.setValue('customer.address.street', address.street);
    form.setValue('customer.address.neighborhood', address.neighborhood);
    form.setValue('customer.address.city', address.city);
    form.setValue('customer.address.state', address.state);
  }

  return (
    <Page
      title="Novo cliente"
      description="O dono recebe um convite por e-mail para definir a senha."
    >
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Cliente e dados para nota fiscal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <TextField
              control={form.control}
              name="customer.name"
              label="Nome do cliente"
              autoFocus
            />
            <MaskedField
              control={form.control}
              name="customer.document"
              label="CNPJ ou CPF"
              mask="document"
            />
            <TextField
              control={form.control}
              name="customer.legalName"
              label="Razão social ou nome completo"
            />
            <TextField
              control={form.control}
              name="customer.municipalRegistration"
              label="Inscrição municipal (opcional)"
            />
            <TextField
              control={form.control}
              name="customer.invoiceEmail"
              label="E-mail para nota fiscal"
              type="email"
            />
            <TextField control={form.control} name="customer.contactName" label="Contato" />
            <MaskedField
              control={form.control}
              name="customer.contactPhone"
              label="Telefone do contato"
              mask="phone"
            />
            <TextField
              control={form.control}
              name="customer.contactEmail"
              label="E-mail do contato (opcional)"
              type="email"
            />
            <Controller
              control={form.control}
              name="customer.address.cep"
              render={({ field, fieldState }) => (
                <Field label="CEP" error={fieldState.error?.message}>
                  <Input
                    {...field}
                    inputMode="numeric"
                    aria-label="CEP"
                    aria-invalid={!!fieldState.error}
                    onBlur={(e) => {
                      field.onBlur();
                      void lookupCep(e.target.value);
                    }}
                  />
                </Field>
              )}
            />
            <TextField control={form.control} name="customer.address.street" label="Rua" />
            <TextField control={form.control} name="customer.address.number" label="Número" />
            <TextField
              control={form.control}
              name="customer.address.complement"
              label="Complemento"
            />
            <TextField control={form.control} name="customer.address.neighborhood" label="Bairro" />
            <TextField control={form.control} name="customer.address.city" label="Cidade" />
            <TextField
              control={form.control}
              name="customer.address.state"
              label="UF"
              maxLength={2}
            />
            <TextField control={form.control} name="customer.notes" label="Observações internas" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Primeira unidade</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <TextField control={form.control} name="store.tradeName" label="Nome fantasia" />
            <MaskedField
              control={form.control}
              name="store.cnpj"
              label="CNPJ da unidade"
              mask="cnpj"
            />
            <MaskedField
              control={form.control}
              name="store.phone"
              label="Telefone da unidade"
              mask="phone"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dono</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <TextField control={form.control} name="owner.name" label="Nome" />
            <TextField
              control={form.control}
              name="owner.email"
              label="E-mail (recebe o convite)"
              type="email"
            />
            <MaskedField
              control={form.control}
              name="owner.phone"
              label="Telefone (opcional)"
              mask="phone"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assinatura</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Controller
              control={form.control}
              name="subscription.planId"
              render={({ field, fieldState }) => (
                <Field label="Plano" error={fieldState.error?.message}>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      const chosen = plans?.find((p) => p.id === v);
                      form.setValue('subscription.priceCents', chosen?.priceCents ?? null);
                      form.setValue('subscription.trialDays', chosen?.trialDays ?? null);
                    }}
                  >
                    <SelectTrigger aria-label="Plano" aria-invalid={!!fieldState.error}>
                      <SelectValue placeholder="Escolha o plano" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans
                        ?.filter((p) => p.isActive)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} · {formatBRL(p.priceCents)} (
                            {BILLING_INTERVAL_LABELS[p.interval]})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <MoneyField
              control={form.control}
              name="subscription.priceCents"
              label="Preço combinado por período"
              hint={plan ? `Preço do plano: ${formatBRL(plan.priceCents)}` : undefined}
            />
            <NumberField
              control={form.control}
              name="subscription.trialDays"
              label="Dias de teste"
              min={0}
              hint="0 = sem teste: a primeira mensalidade vence no início"
            />
            <Controller
              control={form.control}
              name="subscription.startDate"
              render={({ field, fieldState }) => (
                <Field label="Início" htmlFor={startId} error={fieldState.error?.message}>
                  <Input
                    id={startId}
                    type="date"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </Field>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Cadastrar e enviar convite
          </Button>
        </div>
      </form>
    </Page>
  );
}
