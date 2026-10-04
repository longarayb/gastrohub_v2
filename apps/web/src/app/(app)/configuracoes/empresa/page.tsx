'use client';

import {
  PIZZA_PRICING_RULE_LABELS,
  type PizzaPricingRule,
  fetchAddressByCEP,
  formatCEP,
  formatCNPJ,
  formatPhone,
  isValidCEP,
  storeSettingsSchema,
  updateStoreSchema,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@app/ui/components/card';
import { Skeleton, Switch } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Store } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Controller } from 'react-hook-form';
import {
  MaskedField,
  Field,
  MoneyField,
  NumberField,
  PercentField,
  TextField,
  applyApiErrors,
  useZodForm,
} from '@/components/form';
import { Page } from '@/components/page';
import { api, apiPatch, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type StoreDto, storeKeys, useCurrentStore } from '@/lib/stores';

const MENU_URL = process.env.NEXT_PUBLIC_MENU_URL ?? 'http://localhost:3001';

function StoreDataForm({ store }: { store: StoreDto }) {
  const queryClient = useQueryClient();
  const form = useZodForm(updateStoreSchema, {
    tradeName: store.tradeName,
    legalName: store.legalName,
    cnpj: formatCNPJ(store.cnpj),
    phone: formatPhone(store.phone),
    email: store.email ?? '',
    slug: store.slug,
    address: {
      ...store.address,
      cep: formatCEP(store.address.cep),
    },
  });

  const cep = form.watch('address.cep');
  const lastCep = useRef(store.address.cep);
  useEffect(() => {
    if (!cep || !isValidCEP(cep) || cep.replace(/\D/g, '') === lastCep.current) return;
    lastCep.current = cep.replace(/\D/g, '');
    fetchAddressByCEP(cep)
      .then((addr) => {
        if (!addr) return toast.error('CEP não encontrado');
        form.setValue('address.street', addr.street, { shouldValidate: true });
        form.setValue('address.neighborhood', addr.neighborhood, { shouldValidate: true });
        form.setValue('address.city', addr.city, { shouldValidate: true });
        form.setValue('address.state', addr.state, { shouldValidate: true });
        form.setFocus('address.number');
      })
      .catch(() => toast.error('Não foi possível consultar o CEP'));
  }, [cep, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const updated = await apiPatch<StoreDto>('/stores/current', values);
      queryClient.setQueryData(storeKeys.current, updated);
      toast.success('Dados da empresa salvos');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
          <CardDescription>Informações cadastrais e endereço da unidade.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <TextField control={form.control} name="tradeName" label="Nome fantasia" />
          <TextField control={form.control} name="legalName" label="Razão social" />
          <MaskedField control={form.control} name="cnpj" label="CNPJ" mask="cnpj" />
          <MaskedField control={form.control} name="phone" label="Telefone" mask="phone" />
          <TextField control={form.control} name="email" label="E-mail" type="email" />
          <TextField
            control={form.control}
            name="slug"
            label="Endereço do cardápio digital"
            hint={`${MENU_URL}/${form.watch('slug') || 'seu-restaurante'}`}
          />
          <div className="border-t pt-2 md:col-span-2">
            <p className="text-sm font-medium">Endereço</p>
          </div>
          <MaskedField
            control={form.control}
            name="address.cep"
            label="CEP"
            mask="cep"
            hint="Preenchemos o endereço automaticamente"
          />
          <TextField control={form.control} name="address.street" label="Rua" />
          <div className="grid grid-cols-2 gap-4">
            <TextField control={form.control} name="address.number" label="Número" />
            <TextField control={form.control} name="address.complement" label="Complemento" />
          </div>
          <TextField control={form.control} name="address.neighborhood" label="Bairro" />
          <div className="grid grid-cols-[1fr_5rem] gap-4">
            <TextField control={form.control} name="address.city" label="Cidade" />
            <TextField control={form.control} name="address.state" label="UF" maxLength={2} />
          </div>
          <TextField control={form.control} name="address.reference" label="Ponto de referência" />
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Salvar dados
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function LogoCard({ store }: { store: StoreDto }) {
  const queryClient = useQueryClient();
  const { session, setSession } = useAuth();
  const input = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<StoreDto>('/stores/current/logo', { method: 'POST', body });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(storeKeys.current, updated);
      if (session)
        setSession({ ...session, store: { ...session.store, logoUrl: updated.logoUrl } });
      toast.success('Logo atualizado');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Exibido no cardápio digital e nos cupons. JPG, PNG, WEBP, AVIF ou HEIC até 8 MB
          (convertido para WebP).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border bg-muted">
          {store.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logoUrl} alt="Logo" className="size-full object-cover" />
          ) : (
            <Store className="size-8 text-muted-foreground" />
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()} loading={upload.isPending}>
          <ImageUp /> Enviar logo
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ store }: { store: StoreDto }) {
  const queryClient = useQueryClient();
  const form = useZodForm(storeSettingsSchema, store.settings);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const updated = await apiPatch<StoreDto>('/stores/current/settings', values);
      queryClient.setQueryData(storeKeys.current, updated);
      toast.success('Configurações salvas');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Operação</CardTitle>
          <CardDescription>Taxas, tempos e comportamento do cardápio digital.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <PercentField
            control={form.control}
            name="serviceFeeBps"
            label="Taxa de serviço no salão (%)"
            max={30}
          />
          <NumberField
            control={form.control}
            name="kdsLateAfterMinutes"
            label="Alerta de atraso na cozinha (minutos)"
            min={1}
          />
          <NumberField
            control={form.control}
            name="takeoutEtaMinutes"
            label="Tempo de preparo para retirada (minutos)"
            min={0}
          />
          <MoneyField
            control={form.control}
            name="deliveryMinimumCents"
            label="Pedido mínimo para delivery"
          />
          <Controller
            control={form.control}
            name="digitalMenuEnabled"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <span>
                  <span className="block text-sm font-medium">Cardápio digital recebe pedidos</span>
                  <span className="text-xs text-muted-foreground">
                    Desative para mostrar só o cardápio
                  </span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <Controller
            control={form.control}
            name="autoAcceptDigitalOrders"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <span>
                  <span className="block text-sm font-medium">
                    Aceitar pedidos online automaticamente
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Sem precisar aceitar manualmente
                  </span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
          <Controller
            control={form.control}
            name="pizzaPricingRule"
            render={({ field }) => (
              <Field
                label="Preço da pizza com mais de um sabor"
                hint="Usado em meio a meio e pizzas com vários sabores"
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Preço da pizza com mais de um sabor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PIZZA_PRICING_RULE_LABELS) as PizzaPricingRule[]).map((rule) => (
                      <SelectItem key={rule} value={rule}>
                        {PIZZA_PRICING_RULE_LABELS[rule]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Salvar configurações
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export default function CompanySettingsPage() {
  const { data: store, isLoading } = useCurrentStore();

  return (
    <Page title="Empresa" description="Cadastro, endereço e configurações da unidade">
      {isLoading || !store ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="space-y-6">
          <LogoCard store={store} />
          <StoreDataForm store={store} />
          <SettingsForm store={store} />
        </div>
      )}
    </Page>
  );
}
