'use client';

import {
  LOSS_KINDS,
  LOSS_KIND_LABELS,
  type LossEvent,
  type LossKind,
  formatBRL,
  formatDateTime,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { PrintPortal } from '@/components/pos/common';
import { BarList } from '@/components/reports/charts';
import { KpiCard, KpiGrid, ReportCard, type Tone } from '@/components/reports/kpi';
import { PeriodPicker, ReportTools, usePeriod } from '@/components/reports/period';
import { ReportHeader } from '@/components/reports/report-header';
import { ReportPrint } from '@/components/reports/report-print';
import { formatPeriod, useLossesReport } from '@/lib/reports';

const ALL = 'all';
const KIND_TONES: Record<LossKind, Tone> = {
  ORDER_CANCELED: 'critical',
  ITEM_CANCELED: 'orange',
  REFUND: 'purple',
  DISCOUNT: 'blue',
  SERVICE_FEE_REMOVED: 'green',
  REPRINT: 'attention',
  CASH_DIFFERENCE: 'critical',
  CASH_REOPENED: 'attention',
};

function EventRow({ event }: { event: LossEvent }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t py-3 first:border-t-0">
      <div className="min-w-48 flex-1">
        <p className="font-semibold">
          {LOSS_KIND_LABELS[event.kind]}
          {event.orderNumber !== null && ` · pedido #${event.orderNumber}`}
          {event.afterProduction && (
            <Badge variant="destructive" className="ml-2 align-middle">
              depois da produção
            </Badge>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {event.description} · {event.userName} · {formatDateTime(event.at)}
        </p>
        {event.reason && <p className="text-sm">Motivo: {event.reason}</p>}
      </div>
      {event.cents !== 0 && <p className="tabular font-bold">{formatBRL(event.cents)}</p>}
    </li>
  );
}

/** Loss prevention (D038): what the owner looks at when something seems wrong. */
export default function LossesReportPage() {
  const period = usePeriod('30d');
  const range = period.range;
  const { data: report, isLoading } = useLossesReport(range?.from ?? '', range?.to ?? '');
  const [kind, setKind] = useState<string>(ALL);
  const [user, setUser] = useState<string>(ALL);
  const [onlyAfter, setOnlyAfter] = useState(false);
  const [printing, setPrinting] = useState(false);
  const donePrinting = useCallback(() => setPrinting(false), []);

  const events = useMemo(
    () =>
      (report?.events ?? []).filter(
        (e) =>
          (kind === ALL || e.kind === kind) &&
          (user === ALL || (e.userId ?? '') === user) &&
          (!onlyAfter || e.afterProduction),
      ),
    [report, kind, user, onlyAfter],
  );
  const total = (k: LossKind) => report?.totals.find((t) => t.kind === k);
  const afterProduction = report?.users.reduce((t, u) => t + u.afterProduction, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <ReportHeader
        title="Controle de perdas"
        subtitle={
          range
            ? `Cancelamentos, estornos, descontos e reimpressões · ${formatPeriod(range.from, range.to)}`
            : ''
        }
        actions={
          range && (
            <ReportTools
              report="losses"
              sections={[
                { id: 'events', label: 'Todos os eventos' },
                { id: 'users', label: 'Resumo por usuário' },
              ]}
              range={range}
              onPrint={() => setPrinting(true)}
            />
          )
        }
      />
      <div className="print:hidden">
        <PeriodPicker period={period} />
      </div>

      {isLoading || !report ? (
        <Skeleton className="h-96 rounded-card" />
      ) : (
        <>
          <KpiGrid>
            {(
              [
                'ORDER_CANCELED',
                'ITEM_CANCELED',
                'REFUND',
                'DISCOUNT',
                'SERVICE_FEE_REMOVED',
              ] as const
            ).map((k) => (
              <KpiCard
                key={k}
                label={LOSS_KIND_LABELS[k]}
                tone={KIND_TONES[k]}
                value={(total(k)?.count ?? 0).toLocaleString('pt-BR')}
                support={formatBRL(total(k)?.cents ?? 0)}
              />
            ))}
            <KpiCard
              label="Depois da produção"
              tone="critical"
              value={afterProduction.toLocaleString('pt-BR')}
              support="cancelados já em preparo ou impressos"
            />
          </KpiGrid>

          <div className="grid gap-5 lg:grid-cols-2">
            <ReportCard title="Por usuário" summary="mais eventos primeiro">
              <ul className="divide-y text-sm">
                {report.users.map((u) => {
                  const events = Object.values(u.counts).reduce((a, b) => a + (b ?? 0), 0);
                  return (
                    <li
                      key={u.userId ?? 'none'}
                      className="flex flex-wrap items-center gap-2 py-2.5"
                    >
                      <button
                        type="button"
                        className="min-h-11 flex-1 text-left font-semibold hover:underline"
                        onClick={() => setUser(u.userId ?? '')}
                      >
                        {u.name}
                      </button>
                      <span className="tabular text-muted-foreground">{events} eventos</span>
                      {u.afterProduction > 0 && (
                        <Badge variant="destructive">
                          <AlertTriangle className="size-3" /> {u.afterProduction} após produção
                        </Badge>
                      )}
                      <span className="w-full text-xs text-muted-foreground">
                        {LOSS_KINDS.filter((k) => u.counts[k])
                          .map(
                            (k) =>
                              `${LOSS_KIND_LABELS[k]}: ${u.counts[k]} (${formatBRL(u.cents[k] ?? 0)})`,
                          )
                          .join(' · ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </ReportCard>
            <ReportCard title="Motivos" summary={`${report.reasons.length} motivos`}>
              <BarList
                tone="orange"
                rows={report.reasons.slice(0, 12).map((r) => ({
                  key: `${r.kind}:${r.reason}`,
                  label: `${r.reason} · ${LOSS_KIND_LABELS[r.kind]}`,
                  value: r.count,
                  primary: `${r.count}×`,
                  secondary: r.cents ? formatBRL(r.cents) : undefined,
                }))}
              />
            </ReportCard>
          </div>

          <ReportCard
            title="Eventos"
            summary={
              report.eventCount > report.events.length
                ? `${events.length} mostrados · ${report.eventCount} no período (CSV tem todos)`
                : `${events.length} eventos`
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label="Tipo" className="h-11 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os tipos</SelectItem>
                  {LOSS_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {LOSS_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={user} onValueChange={setUser}>
                <SelectTrigger aria-label="Usuário" className="h-11 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os usuários</SelectItem>
                  {report.users.map((u) => (
                    <SelectItem key={u.userId ?? 'none'} value={u.userId ?? ''}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={onlyAfter}
                  onChange={(e) => setOnlyAfter(e.target.checked)}
                />
                Só depois da produção
              </label>
            </div>
            {events.length ? (
              <ul>
                {events.slice(0, 200).map((e, i) => (
                  <EventRow key={`${e.kind}:${e.at}:${i}`} event={e} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum evento com esses filtros.</p>
            )}
          </ReportCard>
        </>
      )}

      {printing && report && (
        <PrintPortal onDone={donePrinting}>
          <ReportPrint
            title="Controle de perdas"
            period={formatPeriod(report.from, report.to)}
            blocks={[
              {
                title: 'Totais',
                columns: ['Tipo', 'Quantidade', 'Valor'],
                rows: report.totals.map((t) => [
                  LOSS_KIND_LABELS[t.kind],
                  String(t.count),
                  formatBRL(t.cents),
                ]),
              },
              {
                title: 'Por usuário',
                columns: ['Usuário', 'Eventos', 'Após produção'],
                rows: report.users.map((u) => [
                  u.name,
                  String(Object.values(u.counts).reduce((a, b) => a + (b ?? 0), 0)),
                  String(u.afterProduction),
                ]),
              },
              {
                title: 'Eventos (100 mais recentes)',
                columns: ['Data', 'Tipo', 'Usuário', 'Motivo', 'Valor'],
                rows: report.events
                  .slice(0, 100)
                  .map((e) => [
                    formatDateTime(e.at),
                    `${LOSS_KIND_LABELS[e.kind]}${e.orderNumber !== null ? ` #${e.orderNumber}` : ''}`,
                    e.userName,
                    e.reason ?? '',
                    formatBRL(e.cents),
                  ]),
              },
            ]}
          />
        </PrintPortal>
      )}
    </div>
  );
}
