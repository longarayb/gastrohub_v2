'use client';

import { registerSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MaskedField, TextField, applyApiErrors, useZodForm } from '@/components/form';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSignupStatus } from '@/lib/platform';
import { Notice } from '@app/ui/components/notice';
import { FullPageSpinner } from '@/components/page';

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const form = useZodForm(registerSchema, {
    ownerName: '',
    email: '',
    password: '',
    phone: '',
    tradeName: '',
    legalName: '',
    cnpj: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await register(values);
      toast.success('Restaurante cadastrado! Complete os dados da empresa.');
      router.replace('/configuracoes/empresa');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold">Cadastre seu restaurante</h1>
        <p className="text-sm text-muted-foreground">Leva menos de um minuto.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <fieldset className="space-y-4">
          <legend className="mb-3 text-sm font-extrabold tracking-wide text-muted-foreground uppercase">
            O restaurante
          </legend>
          <TextField
            control={form.control}
            name="tradeName"
            label="Nome do restaurante"
            autoFocus
          />
          <TextField control={form.control} name="legalName" label="Razão social" />
          <MaskedField control={form.control} name="cnpj" label="CNPJ" mask="cnpj" />
        </fieldset>
        <hr />
        <fieldset className="space-y-4">
          <legend className="mb-3 text-sm font-extrabold tracking-wide text-muted-foreground uppercase">
            Você (dono)
          </legend>
          <TextField control={form.control} name="ownerName" label="Seu nome" autoComplete="name" />
          <MaskedField
            control={form.control}
            name="phone"
            label="Celular"
            mask="phone"
            autoComplete="tel"
          />
          <TextField
            control={form.control}
            name="email"
            label="E-mail"
            type="email"
            autoComplete="email"
          />
          <TextField
            control={form.control}
            name="password"
            label="Senha"
            type="password"
            autoComplete="new-password"
            hint="Mínimo de 8 caracteres, com letras e números"
          />
        </fieldset>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

/**
 * Public signup (D043): only when the platform admin opened it, with a trial period. By default
 * new restaurants come by invitation.
 */
export default function RegisterPage() {
  const { data, isLoading } = useSignupStatus();
  if (isLoading) return <FullPageSpinner />;
  if (data?.mode !== 'OPEN_TRIAL') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-extrabold">Cadastro por convite</h1>
        <Notice tone="info" title="O cadastro de novos restaurantes é feito pela nossa equipe">
          Fale com a gente para conhecer o sistema. Quem já recebeu o convite por e-mail define a
          senha pelo link do convite.
        </Notice>
        <p className="text-sm text-muted-foreground">
          Já tem acesso?{' '}
          <Link href="/login" className="text-primary underline underline-offset-4">
            Entrar
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Notice tone="info" title={`${data.trialDays} dias de teste`}>
        Experimente sem compromisso. Antes do fim do teste avisamos no painel.
      </Notice>
      <RegisterForm />
    </div>
  );
}
