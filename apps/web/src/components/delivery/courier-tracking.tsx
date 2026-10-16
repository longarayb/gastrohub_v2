'use client';

import {
  type CourierTrackingDto,
  TRACKING_CONSENT_TEXT,
  TRACKING_CONSENT_VERSION,
  formatTime,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Notice } from '@app/ui/components/notice';
import { toast } from '@app/ui/components/sonner';
import { BellOff, BellRing, LocateFixed, LocateOff, MapPin, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { type PushState, disablePush, enablePush, isIos, pushState } from '@/lib/push';
import { type TrackingStatus, acceptTracking } from '@/lib/tracking';

/** What the courier reads and accepts before the first location is sent (LGPD). */
export function TrackingConsentDialog({
  open,
  storeName,
  onOpenChange,
  onAccepted,
}: {
  open: boolean;
  storeName: string;
  onOpenChange: (open: boolean) => void;
  onAccepted: (tracking: CourierTrackingDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    try {
      onAccepted(await acceptTracking());
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar sua localização com {storeName || 'a loja'}</DialogTitle>
          <DialogDescription>
            Leia antes de aceitar (versão {TRACKING_CONSENT_VERSION}).
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {TRACKING_CONSENT_TEXT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Agora não
          </Button>
          <Button loading={busy} onClick={() => void accept()}>
            Concordo e compartilhar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TEXT: Record<TrackingStatus, string> = {
  off: 'Localização desligada',
  starting: 'Procurando o GPS…',
  on: 'Localização compartilhada',
  denied: 'Localização bloqueada no celular',
  insecure: 'Localização indisponível neste endereço',
  unsupported: 'Este navegador não informa a localização',
};

/** Sharing the location during the route: status, start and stop. */
export function TrackingCard({
  tracking,
  status,
  lastSentAt,
  screenOn,
  sendError,
  onStart,
  onStop,
  onAccepted,
}: {
  tracking: CourierTrackingDto;
  status: TrackingStatus;
  lastSentAt: Date | null;
  screenOn: boolean;
  sendError: string | null;
  onStart: () => void;
  onStop: () => void;
  onAccepted: (tracking: CourierTrackingDto) => void;
}) {
  const [consentOpen, setConsentOpen] = useState(false);
  const accepted = tracking.consentVersion === TRACKING_CONSENT_VERSION;
  const on = status === 'on' || status === 'starting';
  return (
    <section
      aria-label="Localização"
      className="space-y-3 rounded-card border border-l-4 border-l-status-dispatched bg-card p-4"
    >
      <p className="flex items-center gap-2 text-base font-bold" role="status">
        {on ? (
          <LocateFixed className="size-5" aria-hidden />
        ) : (
          <LocateOff className="size-5" aria-hidden />
        )}
        {on ? `${STATUS_TEXT[status]} com ${tracking.storeName}` : STATUS_TEXT[status]}
      </p>
      {on && (
        <p className="text-sm text-muted-foreground">
          {lastSentAt ? `Último envio às ${formatTime(lastSentAt)}` : 'Aguardando o primeiro envio'}
          {screenOn ? ' · tela mantida acesa' : ''}
        </p>
      )}
      {on && sendError && <Notice tone="attention">{sendError}</Notice>}
      {status === 'insecure' && (
        <Notice tone="attention">
          O GPS do celular só funciona em endereço seguro (https). Peça ao gerente o endereço seguro
          do sistema.
        </Notice>
      )}
      {status === 'denied' && (
        <Notice tone="attention">
          A permissão de localização foi negada. Libere nas configurações do navegador (ícone ao
          lado do endereço) e toque em &quot;Compartilhar localização&quot; de novo.
        </Notice>
      )}
      {on && (
        <p className="text-sm text-muted-foreground">
          Mantenha esta página aberta e a tela acesa: com o Waze ou o Maps na frente, ou a tela
          apagada, o celular para de enviar.
        </p>
      )}
      {on ? (
        <Button variant="outline" size="lg" className="w-full" onClick={onStop}>
          <LocateOff /> Parar localização
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full"
          onClick={() => (accepted ? onStart() : setConsentOpen(true))}
        >
          <MapPin /> Compartilhar localização
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {tracking.storedPositions}{' '}
        {tracking.storedPositions === 1 ? 'posição guardada' : 'posições guardadas'} das suas rotas
        (apagadas em 7 dias).
      </p>
      <TrackingConsentDialog
        open={consentOpen}
        storeName={tracking.storeName}
        onOpenChange={setConsentOpen}
        onAccepted={(t) => {
          onAccepted(t);
          onStart();
        }}
      />
    </section>
  );
}

/** "Rota nova" notices (Web Push); on the iPhone, the home screen step comes first. */
export function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);

  async function run(fn: () => Promise<PushState>) {
    setBusy(true);
    try {
      const next = await fn();
      setState(next);
      if (next === 'on') toast.success('Avisos de rota nova ativados');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!state || state === 'server-off' || state === 'unsupported') return null;
  return (
    <section aria-label="Avisos" className="space-y-3 rounded-card border bg-card p-4">
      <p className="flex items-center gap-2 text-base font-bold">
        {state === 'on' ? (
          <BellRing className="size-5" aria-hidden />
        ) : (
          <BellOff className="size-5" aria-hidden />
        )}
        {state === 'on' ? 'Avisos de rota nova ativados' : 'Avisos de rota nova'}
      </p>
      {state === 'needs-install' && (
        <Notice tone="info">
          No iPhone, os avisos só funcionam com o sistema na Tela de Início: toque em{' '}
          <Share className="inline size-4" aria-label="Compartilhar" /> Compartilhar › Adicionar à
          Tela de Início, abra pelo ícone novo e ative aqui.
        </Notice>
      )}
      {state === 'denied' && (
        <Notice tone="attention">
          Os avisos foram bloqueados. Libere as notificações deste site nas configurações do
          {isIos() ? ' iPhone (Ajustes › Notificações)' : ' navegador'} e tente de novo.
        </Notice>
      )}
      {state === 'off' && (
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          loading={busy}
          onClick={() => void run(enablePush)}
        >
          <BellRing /> Ativar avisos
        </Button>
      )}
      {state === 'on' && (
        <Button variant="ghost" size="sm" loading={busy} onClick={() => void run(disablePush)}>
          Desativar avisos
        </Button>
      )}
    </section>
  );
}
