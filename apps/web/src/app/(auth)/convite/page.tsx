'use client';

import { type AuthSession, resetPasswordSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { TextField, applyApiErrors, useZodForm } from '@/components/form';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/routes';

/** Invitation e-mail (D041): the new user sets the first password and enters the panel. */
function InviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setSession } = useAuth();
  const form = useZodForm(resetPasswordSchema, {
    token: params.get('token') ?? '',
    password: '',
    confirmPassword: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const session = await api<AuthSession>('/auth/accept-invite', {
        method: 'POST',
        body: values,
        noRetry: true,
      });
      queryClient.clear();
      setSession(session);
      toast.success('Senha definida. Bem-vindo!');
      router.replace(homeFor(session.role) as never);
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  if (!params.get('token')) {
    return (
      <p className="text-sm text-muted-foreground">
        Convite inválido. Peça um novo convite a quem cadastrou o restaurante, ou{' '}
        <Link href="/login" className="text-primary hover:underline">
          entre
        </Link>{' '}
        se já tiver senha.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        control={form.control}
        name="password"
        label="Crie sua senha"
        type="password"
        autoComplete="new-password"
        hint="Mínimo de 8 caracteres, com letras e números"
        autoFocus
      />
      <TextField
        control={form.control}
        name="confirmPassword"
        label="Confirme a senha"
        type="password"
        autoComplete="new-password"
      />
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Definir senha e entrar
      </Button>
    </form>
  );
}

export default function InvitePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold">Bem-vindo</h1>
        <p className="text-sm text-muted-foreground">
          Você foi convidado para usar o sistema. Defina sua senha para começar.
        </p>
      </div>
      <Suspense>
        <InviteForm />
      </Suspense>
    </div>
  );
}
