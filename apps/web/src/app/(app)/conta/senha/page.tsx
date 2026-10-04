'use client';

import { changePasswordSchema } from '@gastrohub/shared';
import { Button } from '@gastrohub/ui/components/button';
import { Card, CardContent, CardFooter } from '@gastrohub/ui/components/card';
import { toast } from '@gastrohub/ui/components/sonner';
import { TextField, applyApiErrors, useZodForm } from '@/components/form';
import { Page } from '@/components/page';
import { apiPost, errorMessage } from '@/lib/api';

export default function ChangePasswordPage() {
  const form = useZodForm(changePasswordSchema, {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiPost('/auth/change-password', values);
      toast.success('Senha alterada');
      form.reset();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <Page title="Alterar senha" className="max-w-lg">
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardContent className="space-y-4">
            <TextField
              control={form.control}
              name="currentPassword"
              label="Senha atual"
              type="password"
              autoComplete="current-password"
            />
            <TextField
              control={form.control}
              name="newPassword"
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              hint="Mínimo de 8 caracteres, com letras e números"
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirme a nova senha"
              type="password"
              autoComplete="new-password"
            />
          </CardContent>
          <CardFooter className="justify-end border-t">
            <Button type="submit" loading={form.formState.isSubmitting}>
              Alterar senha
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Page>
  );
}
