'use client';

import { Button } from '@app/ui/components/button';
import { Card } from '@app/ui/components/card';
import { Notice } from '@app/ui/components/notice';
import { toast } from '@app/ui/components/sonner';
import { KeyRound } from 'lucide-react';
import { Brand } from '@/components/brand';
import { ChangePasswordForm } from '@/components/change-password-form';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * First access with a temporary password (created on the server): right after the 2FA, the
 * admin chooses a password before any other screen. The API refuses every other route meanwhile.
 */
export function ForcedPasswordChange() {
  const { admin, logout } = useAuth();
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <Brand />
          <p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
            Administração da plataforma
          </p>
        </div>
        <Card className="space-y-5 p-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold">Crie a sua senha</h1>
            <p className="text-sm text-muted-foreground">{admin?.email}</p>
          </div>
          <Notice tone="info" icon={KeyRound} title="Senha temporária">
            A senha que você recebeu vale só para este primeiro acesso. Escolha uma senha nova para
            continuar.
          </Notice>
          <ChangePasswordForm
            currentLabel="Senha temporária"
            submitLabel="Salvar e continuar"
            onChanged={async () => {
              // The new session carries the admin without the pending change.
              await refreshSession();
              toast.success('Senha criada');
            }}
          />
          <Button variant="link" className="w-full" onClick={() => void logout()}>
            Sair
          </Button>
        </Card>
      </div>
    </main>
  );
}
