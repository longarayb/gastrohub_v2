'use client';

import {
  BILLING_INTERVAL_LABELS,
  type SubscriptionChangeDto,
  ROLE_LABELS,
  SUPPORT_ACCESS_MODE_LABELS,
  formatBRL,
  formatCNPJ,
  formatCPF,
  formatDateTime,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Notice } from '@app/ui/components/notice';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { ListSkeleton } from '@app/ui/components/states';
import { Headset, Link2, Mail } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ReasonDialog, SubscriptionBadge } from '@/components/common';
import { CustomerDataDialog } from '@/components/customer-data-dialog';
import { Field, MoneyInput } from '@/components/form';
import { InvoiceTable } from '@/components/invoices';
import { Page } from '@/components/page';
import { SupportDialog } from '@/components/support-dialog';
import { apiPost, errorMessage } from '@/lib/api';
import { formatCalendarDate, useCustomer, usePlans, useRefresh } from '@/lib/queries';

const CHANGE_LABELS: Record<SubscriptionChangeDto['kind'], string> = {
  CREATED: 'Assinatura criada',
  PLAN_CHANGED: 'Troca de plano',
  PRICE_CHANGED: 'Preço alterado',
  TRIAL_CHANGED: 'Período de teste alterado',
  GRACE_CHANGED: 'Tolerância alterada',
  SUSPENDED: 'Suspensa',
  REACTIVATED: 'Reativada',
  CANCELED: 'Cancelada',
};

type Action =
  | 'plan'
  | 'price'
  | 'trial'
  | 'grace'
  | 'suspend'
  | 'reactivate'
  | 'cancel'
  | 'disable'
  | 'enable'
  | null;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, isLoading } = useCustomer(id);
  const { data: plans } = usePlans();
  const refresh = useRefresh();
  const [action, setAction] = useState<Action>(null);
  const [editing, setEditing] = useState(false);
  const [supportStore, setSupportStore] = useState<{ id: string; name: string } | null>(null);
  const [planId, setPlanId] = useState('');
  const [price, setPrice] = useState(0);
  const [trialEnd, setTrialEnd] = useState('');
  const [grace, setGrace] = useState('');

  if (isLoading || !c)
    return (
      <Page title="Cliente">
        <ListSkeleton rows={8} />
      </Page>
    );
  const s = c.subscription;

  async function run(path: string, body: object, success: string) {
    try {
      await apiPost(`/customers/${id}${path}`, body);
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    } finally {
      await refresh();
    }
  }

  const doc = c.document
    ? c.document.length === 11
      ? formatCPF(c.document)
      : formatCNPJ(c.document)
    : '—';

  return (
    <Page
      title={c.name}
      description={`${c.createdVia === 'SIGNUP' ? 'Cadastro aberto' : 'Cadastrado pela plataforma'} em ${formatDateTime(c.createdAt)}`}
      actions={
        <>
          <SubscriptionBadge status={s?.status ?? null} />
          {!c.isActive && <Badge variant="destructive">Desativado</Badge>}
          <Button variant="outline" onClick={() => setEditing(true)}>
            Editar dados
          </Button>
          <Button variant="ghost" onClick={() => setAction(c.isActive ? 'disable' : 'enable')}>
            {c.isActive ? 'Desativar cliente' : 'Reativar cliente'}
          </Button>
        </>
      }
    >
      {/* ---- Subscription ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Assinatura</CardTitle>
          {s && (
            <CardAction className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPlanId(s.plan.id);
                  setPrice(s.priceCents);
                  setAction('plan');
                }}
              >
                Trocar plano
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPrice(s.priceCents);
                  setAction('price');
                }}
              >
                Alterar preço
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTrialEnd(s.trialEndsOn ?? '');
                  setAction('trial');
                }}
              >
                Período de teste
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setGrace(s.graceDays?.toString() ?? '');
                  setAction('grace');
                }}
              >
                Tolerância
              </Button>
              {s.suspendedAt || s.canceledAt ? (
                <Button size="sm" onClick={() => setAction('reactivate')}>
                  Reativar
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setAction('suspend')}>
                    Suspender
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAction('cancel')}>
                    Cancelar assinatura
                  </Button>
                </>
              )}
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!s ? (
            <p className="text-sm text-muted-foreground">
              Cliente sem assinatura (sem avisos nem limites).
            </p>
          ) : (
            <>
              {s.readOnlyEligibleAt && (
                <Notice
                  tone={s.status === 'SUSPENDED' ? 'critical' : 'attention'}
                  title={
                    s.readOnlyReason === 'OVERDUE'
                      ? `Atraso de ${s.daysOverdue} dia(s)`
                      : s.readOnlyReason === 'SUSPENDED'
                        ? `Suspensa: ${s.suspendedReason ?? ''}`
                        : `Cancelada: ${s.cancelReason ?? ''}`
                  }
                >
                  Somente leitura a partir de {formatDateTime(s.readOnlyEligibleAt)}, em cada
                  unidade só depois do fechamento (veja as unidades abaixo).
                </Notice>
              )}
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Plano">
                  {s.plan.name} · {BILLING_INTERVAL_LABELS[s.interval]}
                </Info>
                <Info label="Valor do período">
                  <span className="tabular-nums">{formatBRL(s.charge.totalCents)}</span>
                  {s.charge.extraStores > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {formatBRL(s.charge.baseCents)} + {s.charge.extraStores} unidade(s)
                      adicional(is)
                    </span>
                  )}
                  {s.priceCents !== s.plan.priceCents && (
                    <span className="block text-xs text-muted-foreground">
                      Preço combinado (plano: {formatBRL(s.plan.priceCents)})
                    </span>
                  )}
                </Info>
                <Info label="Equivalente mensal">{formatBRL(s.monthlyCents)}</Info>
                <Info label="Próximo vencimento">{formatCalendarDate(s.nextDueDate)}</Info>
                <Info label="Teste">
                  {s.trialEndsOn ? `até ${formatCalendarDate(s.trialEndsOn)}` : 'Sem teste'}
                </Info>
                <Info label="Tolerância">
                  {s.effectiveGraceDays} dia(s)
                  {s.graceDays == null ? ' (padrão)' : ' (deste cliente)'}
                </Info>
                <Info label="Unidades do plano">
                  {s.plan.storeLimit}
                  {s.plan.extraStorePriceCents != null
                    ? ` + adicionais a ${formatBRL(s.plan.extraStorePriceCents)}`
                    : ' (limite fixo)'}
                </Info>
                <Info label="Início">{formatDateTime(s.startedAt)}</Info>
              </dl>
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold">
                  Histórico da assinatura ({s.changes.length})
                </summary>
                <ul className="mt-2 divide-y">
                  {s.changes.map((ch, i) => (
                    <li key={i} className="py-2">
                      <span className="font-semibold">{CHANGE_LABELS[ch.kind]}</span>
                      {ch.fromPlanName || ch.toPlanName
                        ? ` · ${ch.fromPlanName ?? '—'} → ${ch.toPlanName ?? '—'}`
                        : ''}
                      {ch.reason ? (
                        <span className="text-muted-foreground"> — {ch.reason}</span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {ch.adminName ?? 'Sistema'} · {formatDateTime(ch.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Invoices ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Mensalidades</CardTitle>
          {s && (
            <CardAction>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await apiPost<{ created: number }>('/invoices/generate', {
                      organizationId: id,
                    });
                    toast.success(
                      res.created
                        ? `${res.created} mensalidade(s) gerada(s)`
                        : 'Nada a gerar agora',
                    );
                  } catch (error) {
                    toast.error(errorMessage(error));
                  } finally {
                    await refresh();
                  }
                }}
              >
                Gerar mensalidades
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {c.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma mensalidade gerada ainda.</p>
          ) : (
            <InvoiceTable invoices={c.invoices} showCustomer={false} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Stores ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Unidades ({c.stores.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {c.stores.map((st) => (
                <li
                  key={st.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div>
                    <p className="font-semibold">{st.tradeName}</p>
                    <p className="text-xs text-muted-foreground">
                      /{st.slug} · {formatCNPJ(st.cnpj)}
                      {!st.isActive ? ' · inativa' : ''}
                    </p>
                    {st.readOnlyFrom && (
                      <p className="text-xs font-semibold text-signal-critical">
                        {st.readOnly
                          ? 'Em somente leitura'
                          : `Somente leitura a partir de ${formatDateTime(st.readOnlyFrom)}`}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!st.isActive || !c.isActive}
                    onClick={() => setSupportStore({ id: st.id, name: st.tradeName })}
                  >
                    <Headset /> Acessar como suporte
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ---- Users ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Usuários ({c.users.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {c.users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div>
                    <p className="font-semibold">
                      {u.name} {!u.isActive && <Badge variant="secondary">Desativado</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {u.email} ·{' '}
                      {u.memberships
                        .map((m) => `${ROLE_LABELS[m.role]} em ${m.storeName}`)
                        .join(', ')}
                    </p>
                    {u.invitePending && <Badge variant="info">Convite pendente</Badge>}
                  </div>
                  {u.invitePending && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await apiPost(`/customers/${id}/users/${u.id}/invite`);
                            toast.success('Convite reenviado');
                          } catch (error) {
                            toast.error(errorMessage(error));
                          }
                        }}
                      >
                        <Mail /> Reenviar convite
                      </Button>
                      <CopyInviteLink customerId={id} userId={u.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ---- Company data ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Dados para nota fiscal</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Info label="Razão social">{c.legalName ?? '—'}</Info>
              <Info label={c.documentType ?? 'Documento'}>{doc}</Info>
              <Info label="Inscrição municipal">{c.municipalRegistration ?? '—'}</Info>
              <Info label="E-mail para nota">{c.invoiceEmail ?? '—'}</Info>
              <Info label="Contato">
                {c.contactName ?? '—'}
                {c.contactPhone ? ` · ${c.contactPhone}` : ''}
              </Info>
              <Info label="Endereço">
                {c.address
                  ? `${c.address.street}, ${c.address.number} ${c.address.complement} — ${c.address.neighborhood}, ${c.address.city}/${c.address.state}`
                  : '—'}
              </Info>
            </dl>
            {c.notes && <p className="mt-3 text-sm text-muted-foreground">{c.notes}</p>}
          </CardContent>
        </Card>

        {/* ---- Terms and support ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Termos e acessos de suporte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {c.terms ? (
              <p>
                Termos {c.terms.termsVersion} e privacidade {c.terms.privacyVersion} aceitos por{' '}
                {c.terms.userName ?? '—'} em {formatDateTime(c.terms.acceptedAt)} (IP{' '}
                {c.terms.ip ?? '—'})
                {c.terms.current ? '' : ' — versão antiga: o dono aceita a nova no próximo acesso'}.
              </p>
            ) : (
              <p className="text-muted-foreground">
                O dono ainda não aceitou os termos (pede no primeiro acesso).
              </p>
            )}
            {c.supportSessions.length > 0 && (
              <ul className="divide-y">
                {c.supportSessions.map((ss) => (
                  <li key={ss.id} className="py-2">
                    <span className="font-semibold">{ss.storeName}</span> ·{' '}
                    {SUPPORT_ACCESS_MODE_LABELS[ss.mode]} · {ss.adminName}
                    {ss.active && (
                      <Badge variant="warning" className="ml-2">
                        Em andamento
                      </Badge>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(ss.startedAt)} — {ss.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- Dialogs ---- */}
      <CustomerDataDialog customer={editing ? c : null} onOpenChange={setEditing} />
      <SupportDialog store={supportStore} onOpenChange={(o) => !o && setSupportStore(null)} />

      {s && (
        <>
          <ReasonDialog
            open={action === 'plan'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Trocar plano"
            description="Limites e módulos mudam na hora; o preço novo vale para as próximas mensalidades."
            confirmLabel="Trocar plano"
            onConfirm={(reason) =>
              run(
                '/subscription/plan',
                { expectedVersion: s.version, planId, priceCents: price, reason },
                'Plano alterado',
              )
            }
          >
            <Field label="Novo plano">
              <Select
                value={planId}
                onValueChange={(v) => {
                  setPlanId(v);
                  setPrice(plans?.find((p) => p.id === v)?.priceCents ?? 0);
                }}
              >
                <SelectTrigger aria-label="Novo plano">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans
                    ?.filter((p) => p.isActive)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {formatBRL(p.priceCents)} ({BILLING_INTERVAL_LABELS[p.interval]})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Preço combinado por período">
              <MoneyInput value={price} onChange={setPrice} aria-label="Preço combinado" />
            </Field>
          </ReasonDialog>
          <ReasonDialog
            open={action === 'price'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Alterar preço combinado"
            confirmLabel="Salvar preço"
            onConfirm={(reason) =>
              run(
                '/subscription/price',
                { expectedVersion: s.version, priceCents: price, reason },
                'Preço alterado',
              )
            }
          >
            <Field label="Preço por período">
              <MoneyInput value={price} onChange={setPrice} aria-label="Preço por período" />
            </Field>
          </ReasonDialog>
          <ReasonDialog
            open={action === 'trial'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Período de teste"
            description="Só antes da primeira mensalidade. Deixe a data vazia para encerrar o teste hoje."
            confirmLabel="Salvar"
            onConfirm={(reason) =>
              run(
                '/subscription/trial',
                { expectedVersion: s.version, trialEndsOn: trialEnd || null, reason },
                'Período de teste alterado',
              )
            }
          >
            <Field label="Teste até (primeiro vencimento)">
              <Input type="date" value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
            </Field>
          </ReasonDialog>
          <ReasonDialog
            open={action === 'grace'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Tolerância deste cliente"
            description="Dias depois do vencimento antes do somente leitura. Vazio = padrão da plataforma."
            confirmLabel="Salvar"
            onConfirm={(reason) =>
              run(
                '/subscription/grace',
                {
                  expectedVersion: s.version,
                  graceDays: grace === '' ? null : Number(grace),
                  reason,
                },
                'Tolerância alterada',
              )
            }
          >
            <Field label="Dias de tolerância">
              <Input
                type="number"
                min={0}
                max={60}
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
              />
            </Field>
          </ReasonDialog>
          <ReasonDialog
            open={action === 'suspend'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Suspender assinatura"
            description="As unidades passam para somente leitura no fim do dia de negócio (nunca no meio do expediente)."
            confirmLabel="Suspender"
            destructive
            onConfirm={(reason) =>
              run(
                '/subscription/suspend',
                { expectedVersion: s.version, reason },
                'Suspensão agendada',
              )
            }
          />
          <ReasonDialog
            open={action === 'reactivate'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Reativar assinatura"
            description="Remove a suspensão ou o cancelamento. Mensalidades em atraso continuam valendo."
            confirmLabel="Reativar"
            onConfirm={(reason) =>
              run(
                '/subscription/reactivate',
                { expectedVersion: s.version, reason },
                'Assinatura reativada',
              )
            }
          />
          <ReasonDialog
            open={action === 'cancel'}
            onOpenChange={(o) => !o && setAction(null)}
            title="Cancelar assinatura"
            description="Somente leitura no fim do dia de negócio; não são geradas novas mensalidades."
            confirmLabel="Cancelar assinatura"
            destructive
            onConfirm={(reason) =>
              run(
                '/subscription/cancel',
                { expectedVersion: s.version, reason },
                'Assinatura cancelada',
              )
            }
          />
        </>
      )}
      <ReasonDialog
        open={action === 'disable' || action === 'enable'}
        onOpenChange={(o) => !o && setAction(null)}
        title={action === 'disable' ? 'Desativar cliente' : 'Reativar cliente'}
        description={
          action === 'disable'
            ? 'Ninguém do cliente consegue entrar até reativar. As sessões abertas terminam.'
            : 'Os usuários voltam a entrar normalmente.'
        }
        confirmLabel={action === 'disable' ? 'Desativar' : 'Reativar'}
        destructive={action === 'disable'}
        onConfirm={(reason) =>
          run(
            '/active',
            { active: action === 'enable', reason },
            action === 'disable' ? 'Cliente desativado' : 'Cliente reativado',
          )
        }
      />
    </Page>
  );
}

/**
 * Copies a new invitation link (to send by WhatsApp while the e-mails may land in spam). The
 * previous links stop working. Without clipboard access (plain http), the link is shown to copy.
 */
function CopyInviteLink({ customerId, userId }: { customerId: string; userId: string }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    try {
      const { link } = await apiPost<{ link: string }>(
        `/customers/${customerId}/users/${userId}/invite-link`,
      );
      try {
        await navigator.clipboard.writeText(link);
        toast.success('Link do convite copiado', {
          description: 'Vale por 7 dias. Os links enviados antes deixaram de valer.',
        });
      } catch {
        setShown(link);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" loading={busy} onClick={() => void copy()}>
        <Link2 /> Copiar link do convite
      </Button>
      <Dialog open={!!shown} onOpenChange={(open) => !open && setShown(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link do convite</DialogTitle>
            <DialogDescription>
              Copie e envie para a pessoa. Vale por 7 dias; os links enviados antes deixaram de
              valer.
            </DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            value={shown ?? ''}
            aria-label="Link do convite"
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
