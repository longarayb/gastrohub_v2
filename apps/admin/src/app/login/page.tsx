'use client';

import {
  type PlatformEnrollment,
  type PlatformLoginStep,
  type PlatformSessionDto,
  platformLoginSchema,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card } from '@app/ui/components/card';
import { Checkbox } from '@app/ui/components/checkbox';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { Notice } from '@app/ui/components/notice';
import { toast } from '@app/ui/components/sonner';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useId, useState } from 'react';
import { Brand } from '@/components/brand';
import { Field, TextField, useZodForm } from '@/components/form';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Stage =
  | { kind: 'password' }
  | { kind: 'code'; challenge: string; recovery: boolean }
  | { kind: 'enroll'; challenge: string; enrollment: PlatformEnrollment | null; qr: string | null }
  | { kind: 'codes'; session: PlatformSessionDto };

function CodeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      autoFocus
      className="text-center text-2xl font-bold tracking-[0.4em] tabular-nums"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
    />
  );
}

/**
 * Platform admin sign-in (D041): password, then the authenticator code (or a recovery code).
 * The first access enrolls the authenticator app and shows the recovery codes once.
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const { status, signIn } = useAuth();
  const [stage, setStage] = useState<Stage>({ kind: 'password' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const codeId = useId();
  const form = useZodForm(platformLoginSchema, { email: '', password: '' });

  useEffect(() => {
    if (status === 'authenticated' && stage.kind !== 'codes') router.replace('/' as never);
  }, [status, stage.kind, router]);

  const onPassword = form.handleSubmit(async (values) => {
    try {
      const step = await api<PlatformLoginStep>('/auth/login', {
        method: 'POST',
        body: values,
        noRetry: true,
      });
      setCode('');
      if (step.step === 'TOTP')
        return setStage({ kind: 'code', challenge: step.challenge, recovery: false });
      const enrollment = await api<PlatformEnrollment>('/auth/2fa/enroll/start', {
        method: 'POST',
        body: { challenge: step.challenge },
        noRetry: true,
      });
      const qr = await QRCode.toDataURL(enrollment.otpauthUrl, { margin: 1, width: 220 });
      setStage({ kind: 'enroll', challenge: step.challenge, enrollment, qr });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== 'code' && stage.kind !== 'enroll') return;
    setBusy(true);
    try {
      if (stage.kind === 'enroll') {
        const session = await api<PlatformSessionDto>('/auth/2fa/enroll/confirm', {
          method: 'POST',
          body: { challenge: stage.challenge, code },
          noRetry: true,
        });
        setStage({ kind: 'codes', session });
      } else {
        const session = await api<PlatformSessionDto>(
          stage.recovery ? '/auth/2fa/recover' : '/auth/2fa/verify',
          {
            method: 'POST',
            body: stage.recovery
              ? { challenge: stage.challenge, recoveryCode: code }
              : { challenge: stage.challenge, code },
            noRetry: true,
          },
        );
        signIn(session);
        router.replace('/' as never);
      }
    } catch (error) {
      toast.error(errorMessage(error));
      // An expired login starts over.
      if (/expirou/.test(errorMessage(error))) setStage({ kind: 'password' });
    } finally {
      setBusy(false);
    }
  }

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
          {stage.kind === 'password' && (
            <form onSubmit={onPassword} className="space-y-4" noValidate>
              <h1 className="text-2xl font-extrabold">Entrar</h1>
              <TextField
                control={form.control}
                name="email"
                label="E-mail"
                type="email"
                autoComplete="username"
                autoFocus
              />
              <TextField
                control={form.control}
                name="password"
                label="Senha"
                type="password"
                autoComplete="current-password"
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={form.formState.isSubmitting}
              >
                Continuar
              </Button>
            </form>
          )}

          {stage.kind === 'code' && (
            <form onSubmit={submitCode} className="space-y-4" noValidate>
              <h1 className="text-2xl font-extrabold">Verificação em duas etapas</h1>
              <Field
                label={
                  stage.recovery ? 'Código de recuperação' : 'Código do aplicativo autenticador'
                }
                htmlFor={codeId}
                hint={
                  stage.recovery
                    ? 'Cada código funciona uma única vez.'
                    : '6 números, renovados a cada 30 segundos.'
                }
              >
                {stage.recovery ? (
                  <Input
                    id={codeId}
                    autoFocus
                    autoComplete="off"
                    className="text-center text-lg font-bold tracking-widest uppercase"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                ) : (
                  <CodeInput id={codeId} value={code} onChange={setCode} />
                )}
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Entrar
              </Button>
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => {
                  setCode('');
                  setStage({ ...stage, recovery: !stage.recovery });
                }}
              >
                {stage.recovery
                  ? 'Usar o aplicativo autenticador'
                  : 'Usar um código de recuperação'}
              </Button>
            </form>
          )}

          {stage.kind === 'enroll' && (
            <form onSubmit={submitCode} className="space-y-4" noValidate>
              <h1 className="text-2xl font-extrabold">Ative a verificação em duas etapas</h1>
              <p className="text-sm text-muted-foreground">
                Obrigatória para entrar no painel da plataforma. Escaneie o QR Code com um
                aplicativo autenticador (Google Authenticator, Microsoft Authenticator,
                1Password...).
              </p>
              {stage.qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={stage.qr}
                  alt="QR Code do autenticador"
                  className="mx-auto size-55 rounded-lg bg-white p-2"
                />
              )}
              <p className="text-center text-xs text-muted-foreground">
                Sem câmera? Digite a chave:{' '}
                <code className="font-mono text-sm break-all text-foreground">
                  {stage.enrollment?.secret}
                </code>
              </p>
              <Field label="Código que aparece no aplicativo" htmlFor={codeId}>
                <CodeInput id={codeId} value={code} onChange={setCode} />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Ativar e entrar
              </Button>
            </form>
          )}

          {stage.kind === 'codes' && (
            <div className="space-y-4">
              <h1 className="flex items-center gap-2 text-2xl font-extrabold">
                <ShieldCheck className="size-6 text-signal-positive" aria-hidden /> Códigos de
                recuperação
              </h1>
              <Notice tone="attention" title="Guarde estes códigos agora">
                Eles aparecem só desta vez. Cada um permite entrar uma vez se você perder o celular.
                Guarde num gerenciador de senhas ou em papel, fora deste computador.
              </Notice>
              <ol
                className="grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-sm"
                aria-label="Códigos de recuperação"
              >
                {stage.session.recoveryCodes?.map((c) => (
                  <li key={c} className="text-center">
                    {c}
                  </li>
                ))}
              </ol>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    stage.session.recoveryCodes?.join('\n') ?? '',
                  );
                  toast.success('Códigos copiados');
                }}
              >
                Copiar os códigos
              </Button>
              <Label className="flex items-start gap-2 text-sm font-normal">
                <Checkbox
                  checked={saved}
                  onCheckedChange={(v) => setSaved(v === true)}
                  className="mt-0.5"
                />
                Guardei os códigos de recuperação em um lugar seguro.
              </Label>
              <Button
                size="lg"
                className="w-full"
                disabled={!saved}
                onClick={() => {
                  signIn(stage.session);
                  router.replace('/' as never);
                }}
              >
                Continuar
              </Button>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
