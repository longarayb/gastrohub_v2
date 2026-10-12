'use client';

import { formatDateTime } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import { Input } from '@app/ui/components/input';
import { Notice } from '@app/ui/components/notice';
import { toast } from '@app/ui/components/sonner';
import { useId, useState } from 'react';
import { ChangePasswordForm } from '@/components/change-password-form';
import { Field } from '@/components/form';
import { Page } from '@/components/page';
import { apiPost, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** The admin's own account: password and second-factor recovery codes. */
export default function AccountPage() {
  const { admin } = useAuth();
  const codeId = useId();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setCodes(await apiPost<string[]>('/auth/recovery-codes', { code }));
      setCode('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Minha conta"
      description={`${admin?.email ?? ''}${admin?.lastLoginAt ? ` · último acesso em ${formatDateTime(admin.lastLoginAt)}` : ''}`}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trocar senha</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm
              onChanged={() => {
                toast.success('Senha alterada. As outras sessões foram encerradas.');
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Códigos de recuperação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Restam {admin?.recoveryCodesLeft ?? '—'} código(s). Gerar novos invalida os
              anteriores.
            </p>
            {codes ? (
              <>
                <Notice tone="attention" title="Guarde estes códigos agora">
                  Eles aparecem só desta vez.
                </Notice>
                <ol className="grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-sm">
                  {codes.map((c) => (
                    <li key={c} className="text-center">
                      {c}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <form onSubmit={regenerate} className="space-y-3" noValidate>
                <Field label="Código atual do autenticador" htmlFor={codeId}>
                  <Input
                    id={codeId}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                  />
                </Field>
                <Button type="submit" variant="outline" loading={busy}>
                  Gerar novos códigos
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
