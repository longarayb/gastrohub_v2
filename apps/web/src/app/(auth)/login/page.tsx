'use client';

import { loginSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { TextField, useZodForm } from '@/components/form';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/painel';
  const form = useZodForm(loginSchema, { email: '', password: '' });

  useEffect(() => {
    if (status === 'authenticated') router.replace(next as never);
  }, [status, router, next]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login(values);
      router.replace(next as never);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        control={form.control}
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        autoFocus
      />
      <TextField
        control={form.control}
        name="password"
        label="Senha"
        type="password"
        autoComplete="current-password"
      />
      <div className="flex justify-end">
        <Link href="/esqueci-senha" className="text-sm text-primary hover:underline">
          Esqueci minha senha
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        Entrar
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="text-sm text-muted-foreground">Acesse o painel do seu restaurante</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="text-center text-sm text-muted-foreground">
        Ainda não tem conta?{' '}
        <Link href="/cadastro" className="font-medium text-primary hover:underline">
          Cadastre seu restaurante
        </Link>
      </p>
    </div>
  );
}
