'use client';

import {
  SUPPORT_ACCESS_MODE_LABELS,
  SUPPORT_SESSION_MINUTES,
  type SupportAccessMode,
  type SupportSessionDto,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { Notice } from '@app/ui/components/notice';
import { Segmented } from '@app/ui/components/segmented';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { apiPost, errorMessage } from '@/lib/api';
import { useRefresh } from '@/lib/queries';

/**
 * Starts a support session (D041): reason, duration (15–60 min) and mode; read-only by default,
 * "with changes" needs an explicit confirmation. Opens the restaurant panel in a new tab.
 */
export function SupportDialog({
  store,
  onOpenChange,
}: {
  store: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefresh();
  const reasonId = useId();
  const minutesId = useId();
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState<number>(SUPPORT_SESSION_MINUTES.default);
  const [mode, setMode] = useState<SupportAccessMode>('READ_ONLY');
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (store) {
      setReason('');
      setMinutes(SUPPORT_SESSION_MINUTES.default);
      setMode('READ_ONLY');
      setConfirmWrite(false);
      setError(undefined);
    }
  }, [store]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    if (reason.trim().length < 10) return setError('Descreva o motivo (mínimo de 10 caracteres)');
    // Open the tab now (popup blockers allow it only inside the click).
    const tab = window.open('about:blank', '_blank');
    setBusy(true);
    try {
      const res = await apiPost<{ session: SupportSessionDto; url: string }>('/support-sessions', {
        storeId: store.id,
        reason: reason.trim(),
        minutes,
        mode,
        confirmWrite: mode === 'READ_WRITE' ? confirmWrite : undefined,
      });
      if (tab) tab.location.href = res.url;
      else window.open(res.url, '_blank');
      await refresh();
      toast.success('Acesso de suporte iniciado (o dono foi avisado por e-mail)');
      onOpenChange(false);
    } catch (err) {
      tab?.close();
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!store} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Acessar como suporte</DialogTitle>
            <DialogDescription>
              {store?.name}: o painel abre em outra aba. Todos da unidade veem o aviso e tudo fica
              na auditoria.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" htmlFor={reasonId} error={error}>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={300}
              aria-invalid={!!error}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <Field label="Duração (minutos)" htmlFor={minutesId} hint="De 15 a 60 minutos">
            <Input
              id={minutesId}
              type="number"
              min={SUPPORT_SESSION_MINUTES.min}
              max={SUPPORT_SESSION_MINUTES.max}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </Field>
          <Segmented
            label="Tipo de acesso"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'READ_ONLY', label: SUPPORT_ACCESS_MODE_LABELS.READ_ONLY },
              { value: 'READ_WRITE', label: SUPPORT_ACCESS_MODE_LABELS.READ_WRITE },
            ]}
          />
          {mode === 'READ_WRITE' && (
            <>
              <Notice tone="attention" title="Acesso com alterações">
                Você poderá mudar dados do restaurante. Cada alteração fica marcada na auditoria da
                unidade como feita pelo suporte.
              </Notice>
              <Label className="flex items-start gap-2 text-sm font-normal">
                <Checkbox
                  checked={confirmWrite}
                  onCheckedChange={(v) => setConfirmWrite(v === true)}
                  className="mt-0.5"
                />
                Confirmo que o cliente pediu ajuda que exige alterações.
              </Label>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" loading={busy} disabled={mode === 'READ_WRITE' && !confirmWrite}>
              Iniciar acesso
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
