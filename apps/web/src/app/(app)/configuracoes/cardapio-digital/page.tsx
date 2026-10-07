'use client';

import {
  type DigitalMenuSettingsDto,
  blockedPhoneSchema,
  digitalMenuSettingsSchema,
  formatPhone,
  isHexColor,
  readableForeground,
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
import { Input } from '@app/ui/components/input';
import { Skeleton, Switch } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, ImageUp, Printer, Scale, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller } from 'react-hook-form';
import { Field, MaskedField, NumberField, applyApiErrors, useZodForm } from '@/components/form';
import { formatClock } from '@/components/orders/common';
import { Page } from '@/components/page';
import { PrintPortal, QrCode } from '@/components/pos/common';
import { errorMessage } from '@/lib/api';
import {
  blockPhone,
  digitalMenuKeys,
  removeMenuCover,
  unblockPhone,
  updateDigitalMenuSettings,
  uploadMenuCover,
  useBlockedPhones,
  useDigitalMenuSettings,
} from '@/lib/digital-menu';

/** Link and QR Code to share the menu (printable for the counter or the window). */
function ShareCard({ settings }: { settings: DigitalMenuSettingsDto }) {
  const [printing, setPrinting] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Link do cardápio</CardTitle>
        <CardDescription>
          Divulgue no WhatsApp, Instagram e no balcão. A prévia do link mostra o nome, a cor e a
          capa do restaurante.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <QrCode value={settings.menuUrl} label="QR Code do cardápio" className="size-32" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate font-mono text-sm">{settings.menuUrl}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(settings.menuUrl)
                  .then(() => toast.success('Link copiado'))
              }
            >
              <Copy /> Copiar link
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={settings.menuUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Abrir cardápio
              </a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPrinting(true)}>
              <Printer /> Imprimir QR Code
            </Button>
          </div>
        </div>
      </CardContent>
      {printing && (
        <PrintPortal onDone={() => setPrinting(false)}>
          <div className="space-y-2 text-center">
            <p className="text-lg font-bold">Peça pelo celular</p>
            <QrCode value={settings.menuUrl} label="QR Code do cardápio" className="mx-auto w-48" />
            <p className="text-xs break-all">{settings.menuUrl}</p>
          </div>
        </PrintPortal>
      )}
    </Card>
  );
}

function CoverPicker({ settings }: { settings: DigitalMenuSettingsDto }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<DigitalMenuSettingsDto>, success: string) {
    setBusy(true);
    try {
      queryClient.setQueryData(digitalMenuKeys.settings, await fn());
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 md:col-span-2">
      <p className="text-sm font-medium">Foto de capa</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-24 w-48 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {settings.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded image from the API
            <img
              src={settings.coverUrl}
              alt="Capa do cardápio"
              className="size-full object-cover"
            />
          ) : (
            <span className="text-xs text-muted-foreground">Sem capa</span>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(() => uploadMenuCover(file), 'Capa atualizada');
          }}
        />
        <Button size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()}>
          <ImageUp /> Enviar capa
        </Button>
        {settings.coverUrl && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(removeMenuCover, 'Capa removida')}
          >
            <Trash2 /> Remover
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        O logo e o nome vêm da tela Empresa. A imagem é otimizada automaticamente.
      </p>
    </div>
  );
}

function SettingsForm({ settings }: { settings: DigitalMenuSettingsDto }) {
  const queryClient = useQueryClient();
  const ids = { privacy: useId(), color: useId() };
  const form = useZodForm(digitalMenuSettingsSchema, {
    digitalMenuEnabled: settings.digitalMenuEnabled,
    autoAcceptDigitalOrders: settings.autoAcceptDigitalOrders,
    brandColor: settings.brandColor ?? '',
    menuDescription: settings.menuDescription ?? '',
    privacyNotice: settings.privacyNotice ?? '',
    limitPerPhoneOpen: settings.limitPerPhoneOpen,
    limitPerPhoneDay: settings.limitPerPhoneDay,
    limitPerIpHour: settings.limitPerIpHour,
    limitStorePending: settings.limitStorePending,
  });
  const color = form.watch('brandColor') ?? '';

  const submit = form.handleSubmit(async (values) => {
    try {
      queryClient.setQueryData(digitalMenuKeys.settings, await updateDigitalMenuSettings(values));
      toast.success('Cardápio digital atualizado');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  const toggle = (
    name: 'digitalMenuEnabled' | 'autoAcceptDigitalOrders',
    title: string,
    hint: string,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </span>
          <Switch checked={field.value} onCheckedChange={field.onChange} />
        </label>
      )}
    />
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Recebimento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {toggle(
            'digitalMenuEnabled',
            'Receber pedidos pelo cardápio',
            'Desligado: o cardápio continua visível, sem pedidos',
          )}
          {toggle(
            'autoAcceptDigitalOrders',
            'Aceitar pedidos automaticamente',
            'Ligado: o pedido já entra aceito, sem esperar alguém aceitar',
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marca do restaurante</CardTitle>
          <CardDescription>
            O cardápio mostra o logo, a cor e o nome do seu restaurante.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Controller
            control={form.control}
            name="brandColor"
            render={({ field, fieldState }) => (
              <Field
                label="Cor principal"
                htmlFor={ids.color}
                error={fieldState.error?.message}
                hint="Em branco: tema neutro"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Escolher cor"
                    className="h-9 w-12 cursor-pointer rounded border bg-transparent"
                    value={isHexColor(field.value ?? '') ? (field.value as string) : '#888888'}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                  <Input
                    id={ids.color}
                    className="font-mono uppercase"
                    placeholder="#E85D04"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                </div>
              </Field>
            )}
          />
          <div className="flex items-end">
            {isHexColor(color) && (
              <span
                className="rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: color, color: readableForeground(color) }}
              >
                Adicionar ao carrinho
              </span>
            )}
          </div>
          <Controller
            control={form.control}
            name="menuDescription"
            render={({ field, fieldState }) => (
              <Field
                label="Descrição curta"
                error={fieldState.error?.message}
                className="md:col-span-2"
                hint="Aparece abaixo do nome e na prévia do link"
              >
                <Input maxLength={300} value={field.value ?? ''} onChange={field.onChange} />
              </Field>
            )}
          />
          <CoverPicker settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proteção contra pedidos falsos</CardTitle>
          <CardDescription>
            O limite por telefone é a proteção principal. O limite por conexão (IP) é largo de
            propósito: operadoras de celular compartilham o mesmo IP entre muitos clientes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            control={form.control}
            name="limitPerPhoneOpen"
            label="Pedidos em andamento por telefone"
            min={1}
          />
          <NumberField
            control={form.control}
            name="limitPerPhoneDay"
            label="Pedidos por dia por telefone"
            min={1}
          />
          <NumberField
            control={form.control}
            name="limitPerIpHour"
            label="Pedidos por hora por conexão (IP)"
            min={5}
          />
          <NumberField
            control={form.control}
            name="limitStorePending"
            label="Pedidos aguardando aceite (máximo)"
            min={1}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aviso de privacidade (LGPD)</CardTitle>
          <CardDescription>
            O cliente aceita este aviso no primeiro pedido. Os dados ficam só com o seu restaurante.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 rounded-md bg-warning/20 p-3 text-sm text-warning-foreground">
            <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              O texto abaixo é um <strong>modelo</strong>. Como controlador dos dados dos clientes,
              o restaurante deve revisá-lo e adaptá-lo, de preferência com apoio jurídico.
            </span>
          </p>
          <Controller
            control={form.control}
            name="privacyNotice"
            render={({ field, fieldState }) => (
              <Field
                label="Texto do aviso"
                htmlFor={ids.privacy}
                error={fieldState.error?.message}
                hint={
                  field.value ? 'Texto próprio do restaurante' : 'Em branco: usa o modelo abaixo'
                }
              >
                <Textarea
                  id={ids.privacy}
                  rows={8}
                  placeholder={settings.privacyTemplate}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          {!form.watch('privacyNotice') && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => form.setValue('privacyNotice', settings.privacyTemplate)}
            >
              Partir do modelo para editar
            </Button>
          )}
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Salvar
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function BlockedPhonesCard() {
  const queryClient = useQueryClient();
  const { data } = useBlockedPhones();
  const form = useZodForm(blockedPhoneSchema, { phone: '', reason: '' });
  const submit = form.handleSubmit(async (values) => {
    try {
      queryClient.setQueryData(digitalMenuKeys.blocked, await blockPhone(values));
      form.reset({ phone: '', reason: '' });
      toast.success('Telefone bloqueado');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });
  async function unblock(id: string) {
    try {
      queryClient.setQueryData(digitalMenuKeys.blocked, await unblockPhone(id));
      toast.success('Telefone desbloqueado');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Telefones bloqueados</CardTitle>
        <CardDescription>
          Não conseguem pedir pelo cardápio (recebem uma mensagem para ligar para o restaurante). Ao
          recusar um pedido, dá para bloquear o telefone direto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <MaskedField control={form.control} name="phone" label="Telefone" mask="phone" />
          <Controller
            control={form.control}
            name="reason"
            render={({ field }) => (
              <Field label="Motivo (interno)">
                <Input maxLength={200} value={field.value ?? ''} onChange={field.onChange} />
              </Field>
            )}
          />
          <Button type="submit" variant="outline" loading={form.formState.isSubmitting}>
            Bloquear
          </Button>
        </form>
        {!data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhum telefone bloqueado.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm" aria-label="Telefones bloqueados">
            {data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 p-2.5">
                <span className="tabular w-36 font-medium">{formatPhone(b.phone)}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {b.reason ?? 'Sem motivo'}
                  {b.createdByName ? ` · ${b.createdByName}` : ''} ·{' '}
                  {new Date(b.createdAt).toLocaleDateString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                  })}{' '}
                  {formatClock(b.createdAt)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void unblock(b.id)}>
                  Desbloquear
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Digital menu settings: receiving, brand, limits, privacy notice, blocked phones (D032–D034). */
export default function DigitalMenuSettingsPage() {
  const { data, isLoading } = useDigitalMenuSettings();
  return (
    <Page
      title="Cardápio digital"
      description="O cardápio público do seu restaurante: pedidos para entrega e retirada."
    >
      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <ShareCard settings={data} />
          <SettingsForm settings={data} />
          <BlockedPhonesCard />
        </>
      )}
    </Page>
  );
}
