'use client';

import {
  type StoreBillingNoticeDto,
  type StoreNoticesDto,
  SUPPORT_ACCESS_MODE_LABELS,
  formatBRL,
  formatDateTime,
  formatTime,
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
import { Label } from '@app/ui/components/label';
import { Segmented } from '@app/ui/components/segmented';
import { Notice } from '@app/ui/components/notice';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Headset, Lock } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/auth';
import {
  acceptTerms,
  formatCalendarDate,
  platformKeys,
  usePlatformTerms,
  useStoreNotices,
} from '@/lib/platform';

function billingText(b: StoreBillingNoticeDto, manager: boolean) {
  const amount = manager && b.amountCents != null ? ` de ${formatBRL(b.amountCents)}` : '';
  switch (b.level) {
    case 'READ_ONLY':
      return {
        tone: 'critical' as const,
        title: 'Modo somente leitura',
        body: manager
          ? 'Há uma pendência na mensalidade. Consultas e relatórios continuam disponíveis; novas vendas voltam assim que o pagamento for registrado.'
          : 'Novas vendas estão bloqueadas por uma pendência administrativa. Consultas continuam disponíveis. Avise o responsável pela unidade.',
      };
    case 'SCHEDULED':
      return manager
        ? {
            tone: 'attention' as const,
            title: 'Somente leitura agendado',
            body: `A unidade passa para somente leitura em ${b.readOnlyFrom ? formatDateTime(b.readOnlyFrom) : 'breve'}, depois do fechamento. Fale com o suporte da plataforma.`,
          }
        : null;
    case 'OVERDUE':
      return manager
        ? {
            tone: 'attention' as const,
            title: `Mensalidade${amount} em atraso`,
            body: `Vencida em ${b.dueDate ? formatCalendarDate(b.dueDate) : '—'}.${
              b.readOnlyFrom
                ? ` Sem o pagamento, novas vendas ficam bloqueadas a partir de ${formatDateTime(b.readOnlyFrom)} (sempre depois do fechamento).`
                : ''
            }`,
          }
        : {
            tone: 'attention' as const,
            title: 'Pendência administrativa',
            body: 'Há uma pendência na mensalidade do sistema. Avise o responsável pela unidade.',
          };
    case 'DUE_SOON':
      return manager
        ? {
            tone: 'info' as const,
            title:
              b.daysToDue === 0
                ? `Mensalidade${amount} vence hoje`
                : `Mensalidade${amount} vence em ${b.daysToDue} ${b.daysToDue === 1 ? 'dia' : 'dias'}`,
            body: b.dueDate ? `Vencimento em ${formatCalendarDate(b.dueDate)}.` : undefined,
          }
        : null;
    case 'TRIAL':
      return manager && b.daysToDue != null && b.daysToDue <= 5 && b.trialEndsOn
        ? {
            tone: 'info' as const,
            title: 'Período de teste',
            body: `O teste termina em ${formatCalendarDate(b.trialEndsOn)}. A primeira mensalidade${amount} vence nesse dia.`,
          }
        : null;
    default:
      return null;
  }
}

/**
 * Platform notices at the top of the panel (D042/D043): public demo (D045), support session (everyone), billing
 * (amounts only for owner and manager; read-only for everyone) and the terms the owner must
 * accept before using the panel.
 */
export function PlatformNotices() {
  const session = useSession();
  const { data } = useStoreNotices();
  if (!data) return null;
  const manager = session.role === 'OWNER' || session.role === 'MANAGER';
  const billing = data.billing ? billingText(data.billing, manager) : null;
  if (!data.demoMode && !data.support && !billing && !data.termsRequired) return null;

  return (
    <div className="space-y-2 px-4 pt-3 xl:px-8">
      {data.demoMode && (
        <Notice tone="info" icon={FlaskConical} title="Ambiente de demonstração" role="status">
          Restaurado toda noite. Pedidos, caixa, mesas, cozinha, entregas e relatórios estão
          liberados; usuários, senhas, dados da empresa, impressão, exclusões e envio de imagens,
          não.
        </Notice>
      )}
      {data.support && (
        <Notice
          tone="attention"
          icon={Headset}
          title="Suporte da plataforma conectado"
          role="status"
        >
          {SUPPORT_ACCESS_MODE_LABELS[data.support.mode]} até {formatTime(data.support.endsAt)}.
          Motivo: {data.support.reason}. Tudo fica registrado na auditoria.
        </Notice>
      )}
      {billing && (
        <Notice
          tone={billing.tone}
          icon={data.billing?.readOnly ? Lock : undefined}
          title={billing.title}
          role={billing.tone === 'critical' ? 'alert' : 'status'}
        >
          {billing.body}
        </Notice>
      )}
      {data.termsRequired && <TermsDialog required={data.termsRequired} />}
    </div>
  );
}

function TermsDialog({ required }: { required: NonNullable<StoreNoticesDto['termsRequired']> }) {
  const queryClient = useQueryClient();
  const { data: texts } = usePlatformTerms();
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const doc = texts ? (tab === 'terms' ? texts.terms : texts.privacy) : null;

  async function accept() {
    setBusy(true);
    try {
      await acceptTerms(required);
      await queryClient.invalidateQueries({ queryKey: platformKeys.notices });
      toast.success('Termos aceitos');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Mandatory for the owner: no close button, no Esc, no click outside.
    <Dialog open>
      <DialogContent
        className="max-h-[90dvh] gap-4 sm:max-w-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Termos de uso e privacidade</DialogTitle>
          <DialogDescription>
            Para continuar, o responsável pela conta precisa ler e aceitar a versão atual.
          </DialogDescription>
        </DialogHeader>
        <Segmented
          value={tab}
          onChange={setTab}
          label="Documento"
          options={[
            { value: 'terms', label: 'Termos de uso' },
            { value: 'privacy', label: 'Privacidade' },
          ]}
        />
        {texts && (
          <Notice tone="attention" role="note">
            {texts.reviewNotice}
          </Notice>
        )}
        <div
          className="max-h-[45dvh] space-y-2 overflow-y-auto rounded-lg border p-4 text-sm"
          tabIndex={0}
          aria-label={doc?.title ?? 'Documento'}
        >
          {doc ? (
            <>
              <p className="text-base font-bold">{doc.title}</p>
              <p className="text-xs text-muted-foreground">Versão {doc.version}</p>
              {doc.body.map((p, i) =>
                p.startsWith('## ') ? (
                  <p key={i} className="pt-2 font-bold">
                    {p.slice(3)}
                  </p>
                ) : (
                  <p key={i}>{p}</p>
                ),
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Carregando…</p>
          )}
        </div>
        <Label className="flex items-start gap-2 text-sm font-normal">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
          />
          Li e aceito os termos de uso e a política de privacidade da plataforma.
        </Label>
        <DialogFooter>
          <Button disabled={!agreed} loading={busy} onClick={() => void accept()}>
            Aceitar e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
