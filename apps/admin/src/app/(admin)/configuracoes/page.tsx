'use client';

import {
  type PlatformSettingsDto,
  SIGNUP_MODE_LABELS,
  type SignupMode,
  platformSettingsSchema,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import { Notice } from '@app/ui/components/notice';
import { Segmented } from '@app/ui/components/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { ListSkeleton } from '@app/ui/components/states';
import { Controller, useWatch } from 'react-hook-form';
import { Field, NumberField, applyApiErrors, useZodForm } from '@/components/form';
import { Page } from '@/components/page';
import { apiPut, errorMessage } from '@/lib/api';
import { usePlans, useRefresh, useSettings } from '@/lib/queries';

function SettingsForm({ settings }: { settings: PlatformSettingsDto }) {
  const refresh = useRefresh();
  const { data: plans } = usePlans();
  const form = useZodForm(platformSettingsSchema, settings);
  const mode = useWatch({ control: form.control, name: 'signupMode' });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiPut('/settings', values);
      await refresh();
      toast.success('Configurações salvas');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Cadastro de novos restaurantes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={form.control}
            name="signupMode"
            render={({ field }) => (
              <Segmented
                label="Cadastro"
                value={field.value as SignupMode}
                onChange={field.onChange}
                options={(Object.keys(SIGNUP_MODE_LABELS) as SignupMode[]).map((m) => ({
                  value: m,
                  label: SIGNUP_MODE_LABELS[m],
                }))}
              />
            )}
          />
          {mode === 'INVITE_ONLY' ? (
            <Notice tone="info">
              A página pública de cadastro mostra que o acesso é por convite. Os clientes são
              cadastrados aqui, em Clientes.
            </Notice>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="signupPlanId"
                render={({ field, fieldState }) => (
                  <Field label="Plano do período de teste" error={fieldState.error?.message}>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <SelectTrigger aria-label="Plano do período de teste">
                        <SelectValue placeholder="Escolha o plano" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans
                          ?.filter((p) => p.isActive)
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <NumberField control={form.control} name="trialDays" label="Dias de teste" min={0} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mensalidades em atraso</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            control={form.control}
            name="warnDaysBefore"
            label="Avisar quantos dias antes do vencimento"
            min={0}
          />
          <NumberField
            control={form.control}
            name="graceDays"
            label="Tolerância depois do vencimento (dias)"
            hint="Depois dela, somente leitura no fim do dia de negócio de cada unidade"
            min={0}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={form.formState.isSubmitting}>
          Salvar configurações
        </Button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { data } = useSettings();
  return (
    <Page
      title="Configurações"
      description="Cadastro aberto, período de teste, avisos e tolerância."
    >
      {/* Mounted with the data in hand (form defaults). */}
      {data ? <SettingsForm settings={data} /> : <ListSkeleton rows={4} />}
    </Page>
  );
}
