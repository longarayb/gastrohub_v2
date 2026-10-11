'use client';

import { type PlatformAuditEntryDto, formatBRL, formatDateTime } from '@app/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import { ListSkeleton } from '@app/ui/components/states';
import Link from 'next/link';
import { InvoiceBadge, Kpi } from '@/components/common';
import { Page } from '@/components/page';
import { formatCalendarDate, useOverview } from '@/lib/queries';
import { actionLabel } from '@/lib/audit-labels';

function ActivityItem({ entry }: { entry: PlatformAuditEntryDto }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
      <span>
        <span className="font-semibold">{actionLabel(entry.action)}</span>
        {entry.customerName ? ` · ${entry.customerName}` : ''}
        {entry.reason ? <span className="text-muted-foreground"> — {entry.reason}</span> : null}
      </span>
      <span className="text-xs text-muted-foreground">
        {entry.adminName ?? entry.actorEmail ?? 'Sistema'} · {formatDateTime(entry.createdAt)}
      </span>
    </li>
  );
}

/** Admin home (D041): customers by situation, recurring revenue, due dates and activity. */
export default function OverviewPage() {
  const { data, isLoading } = useOverview();

  return (
    <Page title="Visão geral" description="Clientes, mensalidades e atividade da plataforma.">
      {isLoading || !data ? (
        <ListSkeleton rows={6} />
      ) : (
        <>
          <section
            aria-label="Indicadores"
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
          >
            <Kpi
              label="Receita mensal recorrente"
              value={formatBRL(data.mrrCents)}
              note="Ativos e atrasados"
              tone="info"
            />
            <Kpi label="Ativos" value={data.counts.ACTIVE} tone="positive" />
            <Kpi label="Em teste" value={data.counts.TRIALING} tone="info" />
            <Kpi label="Atrasados" value={data.counts.PAST_DUE} tone="attention" />
            <Kpi label="Somente leitura" value={data.counts.SUSPENDED} tone="critical" />
            <Kpi
              label="Cancelados"
              value={data.counts.CANCELED}
              note={`${data.counts.total} clientes no total`}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Mensalidades atrasadas</CardTitle>
              </CardHeader>
              <CardContent>
                {data.overdue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma mensalidade atrasada.</p>
                ) : (
                  <ul className="divide-y">
                    {data.overdue.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <Link
                          href={`/clientes/${i.organizationId}` as never}
                          className="font-semibold hover:underline"
                        >
                          {i.customerName}
                        </Link>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{formatBRL(i.amountCents)}</span>
                          <InvoiceBadge status={i.displayStatus} daysOverdue={i.daysOverdue} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vencimentos nos próximos 7 dias</CardTitle>
              </CardHeader>
              <CardContent>
                {data.dueSoon.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nada vence nos próximos dias.</p>
                ) : (
                  <ul className="divide-y">
                    {data.dueSoon.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <Link
                          href={`/clientes/${i.organizationId}` as never}
                          className="font-semibold hover:underline"
                        >
                          {i.customerName}
                        </Link>
                        <span className="text-muted-foreground">
                          {formatCalendarDate(i.dueDate)} ·{' '}
                          <span className="text-foreground tabular-nums">
                            {formatBRL(i.amountCents)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.trialsEnding.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-sm font-bold">Testes terminando</p>
                    <ul className="text-sm">
                      {data.trialsEnding.map((t) => (
                        <li key={t.id}>
                          <Link href={`/clientes/${t.id}` as never} className="hover:underline">
                            {t.name}
                          </Link>{' '}
                          <span className="text-muted-foreground">
                            — até {formatCalendarDate(t.trialEndsOn)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Últimas atividades</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {data.activity.map((a) => (
                    <ActivityItem key={a.seq} entry={a} />
                  ))}
                </ul>
                <Link
                  href="/auditoria"
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  Ver toda a auditoria
                </Link>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
