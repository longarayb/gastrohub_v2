'use client';

import type { TimesRow } from '@app/shared';
import { Skeleton } from '@app/ui/components/misc';
import { cn } from '@app/ui/lib/utils';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { PrintPortal } from '@/components/pos/common';
import { HelpTip, KpiCard, KpiGrid, ReportCard } from '@/components/reports/kpi';
import { PeriodPicker, ReportTools, usePeriod } from '@/components/reports/period';
import { ReportHeader } from '@/components/reports/report-header';
import { ReportPrint } from '@/components/reports/report-print';
import { formatDuration, formatPeriod, useTimesReport } from '@/lib/reports';

/** Operation times use every task of the period (API limit, D038). */
const MAX_DAYS = 120;
const daysIn = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

function overClass(pct: number | null) {
  if (pct === null) return '';
  if (pct >= 30) return 'text-signal-critical font-bold';
  if (pct >= 10) return 'text-signal-attention font-semibold';
  return 'text-signal-positive';
}

function TimesTable({ rows, withSector }: { rows: TimesRow[]; withSector?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 font-semibold">{withSector ? 'Produto' : 'Setor'}</th>
            <th className="py-2 text-right font-semibold">Itens</th>
            <th className="py-2 text-right font-semibold">Espera</th>
            <th className="py-2 text-right font-semibold">Preparo</th>
            <th className="py-2 text-right font-semibold">Total (mediana)</th>
            <th className="py-2 text-right font-semibold">P90</th>
            <th className="py-2 text-right font-semibold">Acima do limite</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.name}:${r.sectorName ?? ''}:${i}`} className="border-t">
              <td className="py-2">
                <p className="font-semibold">{r.name}</p>
                {withSector && <p className="text-xs text-muted-foreground">{r.sectorName}</p>}
              </td>
              <td className="tabular py-2 text-right">{r.total.count}</td>
              <td className="tabular py-2 text-right">{formatDuration(r.wait.medianSeconds)}</td>
              <td className="tabular py-2 text-right">{formatDuration(r.prep.medianSeconds)}</td>
              <td className="tabular py-2 text-right font-semibold">
                {formatDuration(r.total.medianSeconds)}
              </td>
              <td className="tabular py-2 text-right">{formatDuration(r.total.p90Seconds)}</td>
              <td className={cn('tabular py-2 text-right', overClass(r.total.overLimitPct))}>
                {r.total.overLimitPct === null
                  ? '—'
                  : `${r.total.overLimitPct.toLocaleString('pt-BR')}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Preparation times per sector and product (KDS), with the delivery times link (D038). */
export default function TimesReportPage() {
  const period = usePeriod('30d');
  const range = period.range;
  const tooLong = !!range && daysIn(range.from, range.to) > MAX_DAYS;
  const { data: report, isLoading } = useTimesReport(
    range?.from ?? '',
    range?.to ?? '',
    !!range && !tooLong,
  );
  const [printing, setPrinting] = useState(false);
  const donePrinting = useCallback(() => setPrinting(false), []);
  const total = report?.sectors.reduce((t, s) => t + s.total.count, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <ReportHeader
        title="Tempos de operação"
        subtitle={range ? `Preparo na cozinha (KDS) · ${formatPeriod(range.from, range.to)}` : ''}
        actions={
          range &&
          !tooLong && (
            <ReportTools
              report="times"
              sections={[
                { id: 'sectors', label: 'Por setor' },
                { id: 'products', label: 'Por produto' },
              ]}
              range={range}
              onPrint={() => setPrinting(true)}
            />
          )
        }
      />
      <div className="print:hidden">
        <PeriodPicker period={period} maxDays={MAX_DAYS} />
      </div>
      {tooLong ? (
        <p className="rounded-card border bg-card p-4 text-sm">
          Para os tempos de preparo, escolha um período de até {MAX_DAYS} dias.
        </p>
      ) : isLoading || !report ? (
        <Skeleton className="h-96 rounded-card" />
      ) : (
        <>
          <KpiGrid>
            {report.sectors.map((s) => (
              <KpiCard
                key={s.id ?? s.name}
                label={s.name}
                tone={
                  (s.total.overLimitPct ?? 0) >= 30
                    ? 'critical'
                    : (s.total.overLimitPct ?? 0) >= 10
                      ? 'attention'
                      : 'green'
                }
                help="prepTime"
                value={formatDuration(s.total.medianSeconds)}
                support={`P90 ${formatDuration(s.total.p90Seconds)} · limite ${s.lateAfterMinutes} min · ${
                  s.total.overLimitPct ?? 0
                }% acima`}
              />
            ))}
          </KpiGrid>
          <ReportCard title="Por setor" summary={`${total} itens prontos`} help="prepTime">
            <TimesTable rows={report.sectors} />
          </ReportCard>
          <ReportCard title="Por produto" summary="mais demorados primeiro">
            <TimesTable rows={report.products} withSector />
          </ReportCard>
          <p className="text-sm text-muted-foreground">
            Tempos de entrega (saída e chegada ao cliente, por área e entregador) estão no{' '}
            <Link
              href="/entregadores/relatorio"
              className="font-semibold text-accent-blue underline"
            >
              relatório de entregas
            </Link>
            . <HelpTip topic="prepTime" label="Tempos de preparo" />
          </p>
        </>
      )}

      {printing && report && (
        <PrintPortal onDone={donePrinting}>
          <ReportPrint
            title="Tempos de operação"
            period={formatPeriod(report.from, report.to)}
            blocks={[
              {
                title: 'Por setor',
                columns: ['Setor', 'Itens', 'Mediana', 'P90', 'Acima do limite'],
                rows: report.sectors.map((s) => [
                  s.name,
                  String(s.total.count),
                  formatDuration(s.total.medianSeconds),
                  formatDuration(s.total.p90Seconds),
                  `${s.total.overLimitPct ?? 0}%`,
                ]),
              },
              {
                title: 'Por produto (40 mais demorados)',
                columns: ['Produto', 'Setor', 'Mediana', 'P90'],
                rows: report.products
                  .slice(0, 40)
                  .map((p) => [
                    p.name,
                    p.sectorName ?? '',
                    formatDuration(p.total.medianSeconds),
                    formatDuration(p.total.p90Seconds),
                  ]),
              },
            ]}
          />
        </PrintPortal>
      )}
    </div>
  );
}
