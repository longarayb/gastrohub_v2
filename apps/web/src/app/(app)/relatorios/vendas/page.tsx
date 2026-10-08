'use client';

import {
  type AbcClass,
  PAYMENT_METHOD_LABELS,
  REPORT_CHANNEL_LABELS,
  type ReportScope,
  type SalesReportDto,
  formatBRL,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Skeleton } from '@app/ui/components/misc';
import { cn } from '@app/ui/lib/utils';
import { useCallback, useState } from 'react';
import { PrintPortal } from '@/components/pos/common';
import { BarList, DayColumns, Heatmap } from '@/components/reports/charts';
import { HelpTip, KpiCard, KpiGrid, ReportCard } from '@/components/reports/kpi';
import { PeriodPicker, ReportTools, usePeriod } from '@/components/reports/period';
import { ReportHeader, ScopeSwitch, Segmented } from '@/components/reports/report-header';
import { ReportPrint } from '@/components/reports/report-print';
import { formatPeriod, formatShortDate, useSalesReport } from '@/lib/reports';

const ABC_VARIANT: Record<AbcClass, 'info' | 'secondary' | 'outline'> = {
  A: 'info',
  B: 'secondary',
  C: 'outline',
};

const SECTIONS = [
  { id: 'products', label: 'Produtos (curva ABC)' },
  { id: 'categories', label: 'Categorias' },
  { id: 'payments', label: 'Formas de pagamento' },
  { id: 'channels', label: 'Canais' },
  { id: 'days', label: 'Faturamento por dia' },
  { id: 'hours', label: 'Dia da semana × hora' },
  { id: 'waiters', label: 'Garçons' },
];

function Breakdown({ report }: { report: SalesReportDto }) {
  const b = report.breakdown;
  const rows: [string, number, boolean?][] = [
    ['Produtos (preço cheio)', b.grossProductsCents],
    ['− Descontos nos itens', -b.itemDiscountCents],
    ['− Descontos no pedido', -b.orderDiscountCents],
    ['− Cupons', -b.couponDiscountCents],
    ['= Produtos líquidos', b.netProductsCents, true],
    ['+ Taxa de serviço', b.serviceFeeCents],
    ['+ Taxa de entrega', b.deliveryFeeCents],
    ['− Estornos de pedidos concluídos', -report.refundsCents],
    ['= Faturamento', report.revenueCents, true],
  ];
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows
          .filter(([, v, strong]) => strong || v !== 0)
          .map(([label, value, strong]) => (
            <tr key={label} className={cn(strong && 'border-t font-bold')}>
              <td className="py-1.5">{label}</td>
              <td className="tabular py-1.5 text-right">{formatBRL(value)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function Products({ report }: { report: SalesReportDto }) {
  const [filter, setFilter] = useState<'ALL' | AbcClass>('ALL');
  const [all, setAll] = useState(false);
  const rows = report.products.filter((p) => filter === 'ALL' || p.abc === filter);
  const shown = all ? rows : rows.slice(0, 15);
  const count = (c: AbcClass) => report.products.filter((p) => p.abc === c).length;
  return (
    <ReportCard
      title="Produtos"
      help="abc"
      summary={`${report.products.length} produtos · A ${count('A')} · B ${count('B')} · C ${count('C')}`}
    >
      <div className="mb-3">
        <Segmented
          label="Curva"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: 'Todos' },
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
            { value: 'C', label: 'C' },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-semibold">Produto</th>
              <th className="py-2 text-right font-semibold">Qtd.</th>
              <th className="py-2 text-right font-semibold">Faturamento</th>
              <th className="py-2 text-right font-semibold">%</th>
              <th className="py-2 text-right font-semibold">Acum.</th>
              <th className="py-2 text-center font-semibold">Curva</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.productId ?? p.name} className="border-t">
                <td className="py-2">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.categoryName}</p>
                </td>
                <td className="tabular py-2 text-right">{p.quantity}</td>
                <td className="tabular py-2 text-right">{formatBRL(p.revenueCents)}</td>
                <td className="tabular py-2 text-right">{p.sharePct.toLocaleString('pt-BR')}%</td>
                <td className="tabular py-2 text-right">
                  {p.cumulativePct.toLocaleString('pt-BR')}%
                </td>
                <td className="py-2 text-center">
                  <Badge variant={ABC_VARIANT[p.abc]}>{p.abc}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 15 && (
        <button
          type="button"
          className="mt-2 min-h-11 text-sm font-semibold text-accent-blue"
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Mostrar menos' : `Ver todos (${rows.length})`}
        </button>
      )}
    </ReportCard>
  );
}

export default function SalesReportPage() {
  const period = usePeriod('30d');
  const [scope, setScope] = useState<ReportScope>('STORE');
  const [heat, setHeat] = useState<'orders' | 'revenue'>('orders');
  const [printing, setPrinting] = useState(false);
  const range = period.range;
  const { data: report, isLoading } = useSalesReport(scope, range?.from ?? '', range?.to ?? '');
  const donePrinting = useCallback(() => setPrinting(false), []);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <ReportHeader
        title="Vendas"
        subtitle={
          range ? `Dias de negócio de ${formatPeriod(range.from, range.to)}` : 'Carregando…'
        }
        actions={
          range && (
            <ReportTools
              report="sales"
              sections={SECTIONS}
              range={range}
              onPrint={() => setPrinting(true)}
            />
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <PeriodPicker period={period} />
        <ScopeSwitch value={scope} onChange={setScope} />
      </div>

      {isLoading || !report ? (
        <Skeleton className="h-96 rounded-card" />
      ) : (
        <>
          <KpiGrid>
            <KpiCard
              label="Faturamento"
              tone="blue"
              help="revenue"
              value={formatBRL(report.revenueCents)}
              support={`Produtos ${formatBRL(report.breakdown.netProductsCents)}`}
            />
            <KpiCard
              label="Pedidos"
              tone="green"
              help="orders"
              value={report.breakdown.orders.toLocaleString('pt-BR')}
            />
            <KpiCard
              label="Ticket médio"
              tone="purple"
              help="ticket"
              value={formatBRL(report.ticket.totalCents)}
              support={`Só produtos ${formatBRL(report.ticket.productsCents)}`}
            />
            <KpiCard
              label="Descontos"
              tone="orange"
              help="breakdown"
              value={formatBRL(report.breakdown.discountsCents)}
              support={`Estornos ${formatBRL(report.refundsCents)}`}
            />
          </KpiGrid>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <ReportCard
              title="Faturamento por dia"
              summary={`${report.days.length} dias com vendas`}
            >
              <DayColumns
                days={report.days.map((d) => ({
                  date: d.date,
                  value: d.revenueCents,
                  label: `${formatShortDate(d.date)} · ${d.orders} pedidos`,
                }))}
                format={formatBRL}
              />
            </ReportCard>
            <ReportCard title="Composição" help="breakdown">
              <Breakdown report={report} />
            </ReportCard>
          </div>

          {report.units.length > 0 && (
            <ReportCard title="Por unidade" summary={`${report.units.length} unidades`}>
              <BarList
                rows={report.units.map((u) => ({
                  key: u.storeId,
                  label: u.name,
                  value: u.revenueCents,
                  primary: formatBRL(u.revenueCents),
                  secondary: `${u.orders} ped.`,
                }))}
              />
            </ReportCard>
          )}

          <Products report={report} />

          <div className="grid gap-5 lg:grid-cols-3">
            <ReportCard title="Categorias" summary={`${report.categories.length} categorias`}>
              <BarList
                tone="green"
                rows={report.categories.map((c) => ({
                  key: c.categoryId ?? c.name,
                  label: c.name,
                  value: c.revenueCents,
                  primary: formatBRL(c.revenueCents),
                  secondary: `${c.sharePct.toLocaleString('pt-BR')}%`,
                }))}
              />
            </ReportCard>
            <ReportCard title="Formas de pagamento" help="received">
              <BarList
                tone="purple"
                rows={report.payments.map((p) => ({
                  key: p.method,
                  label: PAYMENT_METHOD_LABELS[p.method],
                  value: Math.max(0, p.netCents),
                  primary: formatBRL(p.netCents),
                  secondary: p.refundedCents
                    ? `estornos ${formatBRL(p.refundedCents)}`
                    : `${p.payments} pag.`,
                }))}
              />
            </ReportCard>
            <ReportCard title="Canais">
              <BarList
                rows={report.channels.map((c) => ({
                  key: c.channel,
                  label: REPORT_CHANNEL_LABELS[c.channel],
                  value: c.revenueCents,
                  primary: formatBRL(c.revenueCents),
                  secondary: `${c.orders} ped.`,
                }))}
              />
            </ReportCard>
          </div>

          <ReportCard
            title="Dia da semana × hora"
            summary="pedidos feitos em cada hora"
            actions={
              <Segmented
                label="Mostrar"
                value={heat}
                onChange={setHeat}
                options={[
                  { value: 'orders', label: 'Pedidos' },
                  { value: 'revenue', label: 'Valor' },
                ]}
              />
            }
          >
            <Heatmap
              grid={heat === 'orders' ? report.heatmap.orders : report.heatmap.revenueCents}
              format={heat === 'orders' ? (v) => `${v} pedidos` : formatBRL}
            />
          </ReportCard>

          <ReportCard title="Garçons" summary="contas de mesa">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-semibold">Garçom</th>
                    <th className="py-2 text-right font-semibold">Mesas</th>
                    <th className="py-2 text-right font-semibold">Itens</th>
                    <th className="py-2 text-right font-semibold">Valor dos itens</th>
                    <th className="py-2 text-right font-semibold">
                      Taxa de serviço <HelpTip topic="breakdown" label="Taxa de serviço" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.waiters.map((w) => (
                    <tr key={`${w.userId}:${w.name}`} className="border-t">
                      <td className="py-2 font-semibold">{w.name}</td>
                      <td className="tabular py-2 text-right">{w.tables}</td>
                      <td className="tabular py-2 text-right">{w.items}</td>
                      <td className="tabular py-2 text-right">{formatBRL(w.itemsCents)}</td>
                      <td className="tabular py-2 text-right">{formatBRL(w.serviceFeeCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportCard>
        </>
      )}

      {printing && report && (
        <PrintPortal onDone={donePrinting}>
          <ReportPrint
            title="Relatório de vendas"
            period={formatPeriod(report.from, report.to)}
            blocks={[
              {
                title: 'Composição do faturamento',
                columns: ['', 'Valor'],
                rows: [
                  ['Produtos líquidos', formatBRL(report.breakdown.netProductsCents)],
                  ['Taxa de serviço', formatBRL(report.breakdown.serviceFeeCents)],
                  ['Taxa de entrega', formatBRL(report.breakdown.deliveryFeeCents)],
                  ['Estornos', `− ${formatBRL(report.refundsCents)}`],
                  ['Faturamento', formatBRL(report.revenueCents)],
                  ['Pedidos', String(report.breakdown.orders)],
                  ['Ticket médio', formatBRL(report.ticket.totalCents)],
                ],
              },
              {
                title: 'Produtos (curva ABC, 40 primeiros)',
                columns: ['Produto', 'Qtd.', 'Faturamento', '%', 'Curva'],
                rows: report.products
                  .slice(0, 40)
                  .map((p) => [
                    p.name,
                    String(p.quantity),
                    formatBRL(p.revenueCents),
                    `${p.sharePct}%`,
                    p.abc,
                  ]),
              },
              {
                title: 'Formas de pagamento',
                columns: ['Forma', 'Recebido', 'Estornado', 'Líquido'],
                rows: report.payments.map((p) => [
                  PAYMENT_METHOD_LABELS[p.method],
                  formatBRL(p.receivedCents),
                  formatBRL(p.refundedCents),
                  formatBRL(p.netCents),
                ]),
              },
              {
                title: 'Canais',
                columns: ['Canal', 'Pedidos', 'Faturamento'],
                rows: report.channels.map((c) => [
                  REPORT_CHANNEL_LABELS[c.channel],
                  String(c.orders),
                  formatBRL(c.revenueCents),
                ]),
              },
            ]}
          />
        </PrintPortal>
      )}
    </div>
  );
}
