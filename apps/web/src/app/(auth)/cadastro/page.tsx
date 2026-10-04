'use client';

import { registerSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MaskedField, TextField, applyApiErrors, useZodForm } from '@/components/form';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
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
        <h1 className="text-2xl font-semibold">Cadastre seu restaurante</h1>
        <p className="text-sm text-muted-foreground">Leva menos de um minuto.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField control={form.control} name="tradeName" label="Nome do restaurante" autoFocus />
        <TextField control={form.control} name="legalName" label="Razão social" />
        <MaskedField control={form.control} name="cnpj" label="CNPJ" mask="cnpj" />
        <div className="border-t pt-4" />
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
