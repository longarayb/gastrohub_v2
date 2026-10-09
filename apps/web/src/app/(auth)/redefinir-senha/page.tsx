'use client';

import { resetPasswordSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { TextField, applyApiErrors, useZodForm } from '@/components/form';
import { api, errorMessage } from '@/lib/api';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const form = useZodForm(resetPasswordSchema, {
    token: params.get('token') ?? '',
    password: '',
    confirmPassword: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api('/auth/reset-password', { method: 'POST', body: values, noRetry: true });
      toast.success('Senha redefinida! Faça login com a nova senha.');
      router.replace('/login');
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  if (!params.get('token')) {
    return (
      <p className="text-sm text-muted-foreground">
        Link inválido.{' '}
        <Link href="/esqueci-senha" className="text-primary hover:underline">
          Solicite um novo
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        control={form.control}
        name="password"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        hint="Mínimo de 8 caracteres, com letras e números"
        autoFocus
      />
      <TextField
        control={form.control}
        name="confirmPassword"
        label="Confirme a nova senha"
        type="password"
        autoComplete="new-password"
      />
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Redefinir senha
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">Nova senha</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
