'use client';

import { BRAND } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { MonitorSmartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { KDS_REVOKED_KEY, useKdsSession } from '@/lib/kds-session';

function PairForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { mode, pair } = useKdsSession();
  const [store, setStore] = useState(params.get('loja') ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set by the kitchen screen when the manager revoked this device (read once).
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    if (mode.kind === 'device') router.replace('/kds');
  }, [mode.kind, router]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KDS_REVOKED_KEY)) {
        sessionStorage.removeItem(KDS_REVOKED_KEY);
        setRevoked(true);
      }
    } catch {
      // Storage blocked: the notice is a courtesy, pairing works the same.
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!store.trim()) return setError('Informe o código da unidade');
    if (!/^\d{6}$/.test(code)) return setError('O código tem 6 números');
    setBusy(true);
    try {
      await pair(store.trim().toLowerCase(), code);
      router.replace('/kds');
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-8">
      {revoked && (
        <div role="status" className="rounded-lg border-l-4 border-signal-attention bg-muted p-4">
          <p className="font-bold">Dispositivo desvinculado</p>
          <p className="text-sm text-muted-foreground">
            O gerente desvinculou esta tela. Para usá-la de novo, peça um novo código.
          </p>
        </div>
      )}
      <div className="space-y-2 text-center">
        <MonitorSmartphone className="mx-auto size-12 text-primary" />
        <h1 className="text-2xl font-bold">Vincular esta tela</h1>
        <p className="text-muted-foreground">
          O gerente gera o código em{' '}
          <strong>Cardápio › Setores de produção › Telas da cozinha</strong>.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="store" className="text-base">
          Código da unidade
        </Label>
        <Input
          id="store"
          value={store}
          autoCapitalize="none"
          autoComplete="off"
          className="h-12 text-lg"
          onChange={(e) => setStore(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="code" className="text-base">
          Código de 6 números
        </Label>
        <Input
          id="code"
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="tabular h-16 text-center text-4xl tracking-[0.5em]"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/15 p-3 text-center text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-12 w-full text-lg" loading={busy}>
        Vincular
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Prefere entrar com usuário e senha?{' '}
        <Link href={'/login?next=/kds' as never} className="underline">
          Entrar
        </Link>
      </p>
      <p className="text-center text-xs text-muted-foreground">{BRAND.name}</p>
    </form>
  );
}

export default function PairPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense>
        <PairForm />
      </Suspense>
    </main>
  );
}
