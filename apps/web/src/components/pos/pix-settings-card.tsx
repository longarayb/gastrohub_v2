'use client';

import {
  PIX_KEY_TYPES,
  PIX_KEY_TYPE_LABELS,
  PIX_MERCHANT_CITY_MAX,
  PIX_MERCHANT_NAME_MAX,
  type PixKeyType,
  buildPixBrCode,
  normalizePixKey,
  type PixSettingsInput,
  pixSettingsSchema,
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
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useWatch } from 'react-hook-form';
import { Field, TextField, applyApiErrors, useZodForm } from '@/components/form';
import { errorMessage } from '@/lib/api';
import { cashKeys, updatePixSettings, usePixSettings } from '@/lib/cash';
import type { StoreDto } from '@/lib/stores';
import { QrCode } from './common';

const NONE = 'none';
const KEY_PLACEHOLDERS: Record<PixKeyType, string> = {
  CPF: '000.000.000-00',
  CNPJ: '00.000.000/0000-00',
  EMAIL: 'financeiro@restaurante.com.br',
  PHONE: '(11) 98765-4321',
  RANDOM: '123e4567-e89b-12d3-a456-426614174000',
};

/** QR Code without amount to check the key in a bank app; null while the data is incomplete. */
function testCode(key: string, merchantName: string, merchantCity: string): string | null {
  try {
    return buildPixBrCode({ key, merchantName, merchantCity });
  } catch {
    return null;
  }
}

/** PIX key of the static QR Code (pre-bill and payment screen). */
export function PixSettingsCard({ store }: { store: StoreDto }) {
  const { data } = usePixSettings();
  if (!data) return <Skeleton className="h-48" />;
  // Mounted with the saved values (no reset after load); suggestions when there is no key yet.
  return (
    <PixSettingsForm
      initial={{
        pixKeyType: data.pixKeyType,
        pixKey: data.pixKey ?? '',
        pixMerchantName: data.pixMerchantName ?? store.tradeName.slice(0, PIX_MERCHANT_NAME_MAX),
        pixMerchantCity: data.pixMerchantCity ?? store.address.city.slice(0, PIX_MERCHANT_CITY_MAX),
      }}
    />
  );
}

function PixSettingsForm({ initial }: { initial: PixSettingsInput }) {
  const queryClient = useQueryClient();
  const form = useZodForm(pixSettingsSchema, initial);

  const [type, key, name, city] = useWatch({
    control: form.control,
    name: ['pixKeyType', 'pixKey', 'pixMerchantName', 'pixMerchantCity'],
  });
  const normalized = type ? normalizePixKey(type, key ?? '') : null;
  const preview = normalized && name && city ? testCode(normalized, name, city) : null;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await updatePixSettings(values);
      queryClient.setQueryData(cashKeys.pixSettings, saved);
      toast.success(saved.pixKeyType ? 'Chave PIX salva' : 'PIX desativado');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>PIX</CardTitle>
          <CardDescription>
            Chave usada no QR Code da pré-conta e da tela de pagamento. O operador confirma o
            recebimento no app do banco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="grid gap-4 md:grid-cols-2">
              <Controller
                control={form.control}
                name="pixKeyType"
                render={({ field }) => (
                  <Field label="Tipo de chave">
                    <Select
                      value={field.value ?? NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                    >
                      <SelectTrigger aria-label="Tipo de chave" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem PIX</SelectItem>
                        {PIX_KEY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {PIX_KEY_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              {type && (
                <>
                  <TextField
                    control={form.control}
                    name="pixKey"
                    label="Chave"
                    placeholder={KEY_PLACEHOLDERS[type]}
                  />
                  <TextField
                    control={form.control}
                    name="pixMerchantName"
                    label="Nome do recebedor"
                    hint={`Até ${PIX_MERCHANT_NAME_MAX} caracteres, como aparece no banco`}
                    maxLength={PIX_MERCHANT_NAME_MAX}
                  />
                  <TextField
                    control={form.control}
                    name="pixMerchantCity"
                    label="Cidade"
                    hint={`Até ${PIX_MERCHANT_CITY_MAX} caracteres`}
                    maxLength={PIX_MERCHANT_CITY_MAX}
                  />
                </>
              )}
            </div>
            {preview && (
              <div className="flex flex-col items-center gap-1">
                <QrCode value={preview} className="size-32" />
                <p className="max-w-36 text-center text-xs text-muted-foreground">
                  Teste: leia no app do banco e confira o recebedor (sem pagar).
                </p>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Salvar PIX
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
