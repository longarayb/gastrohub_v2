'use client';

import { forgotPasswordSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TextField, useZodForm } from '@/components/form';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useZodForm(forgotPasswordSchema, { email: '' });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api('/auth/forgot-password', { method: 'POST', body: values, noRetry: true });
      setSent(true);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-10 text-primary" />
        <h1 className="text-2xl font-semibold">Verifique seu e-mail</h1>
        <p className="text-sm text-muted-foreground">
          Se existir uma conta com esse e-mail, você receberá um link para redefinir a senha.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Voltar ao login</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Recuperar senha</h1>
        <p className="text-sm text-muted-foreground">Enviaremos um link para o seu e-mail.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField control={form.control} name="email" label="E-mail" type="email" autoFocus />
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Enviar link
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Voltar ao login
        </Link>
      </p>
    </div>
  );
}
