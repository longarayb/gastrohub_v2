'use client';

import { platformChangePasswordSchema } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import { TextField, applyApiErrors, useZodForm } from '@/components/form';
import { apiPost, errorMessage } from '@/lib/api';

/** Password change of the signed-in admin (account page and the mandatory first change). */
export function ChangePasswordForm({
  currentLabel = 'Senha atual',
  submitLabel = 'Trocar senha',
  onChanged,
}: {
  currentLabel?: string;
  submitLabel?: string;
  onChanged: () => void | Promise<void>;
}) {
  const form = useZodForm(platformChangePasswordSchema, {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiPost('/auth/password', values);
      form.reset();
      await onChanged();
    } catch (error) {
      if (!applyApiErrors(form, error)) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        control={form.control}
        name="currentPassword"
        label={currentLabel}
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
      <Button type="submit" loading={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
