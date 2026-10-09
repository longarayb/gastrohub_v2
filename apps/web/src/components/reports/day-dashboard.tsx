'use client';

import {
  type CompareMode,
  type DayReportDto,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  REPORT_CHANNEL_LABELS,
  type ReportScope,
  formatBRL,
} from '@app/shared';
import { Skeleton } from '@app/ui/components/misc';
import { cn } from '@app/ui/lib/utils';
import { useState } from 'react';
import { formatLongDate, formatShortDate, useDayReport } from '@/lib/reports';
import { AttentionStrip, BarList, HourColumns } from './charts';
import { ComparisonLine, HelpTip, KpiCard, KpiGrid, ReportCard } from './kpi';
import { ReportHeader, ScopeSwitch, Segmented } from './report-header';

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });

function againstLabel(day: DayReportDto): string {
  if (day.comparison.mode === 'AVG_4_WEEKS') return 'média das 4 semanas';
  const date = day.comparison.dates[0]!;
  const weekday = WEEKDAY.format(new Date(`${date}T12:00:00Z`)).replace('-feira', '');
  return `${weekday} passada${day.comparison.untilSameTime ? ', até agora' : ''}`;
}

function TicketCard({ day, against }: { day: DayReportDto; against: string }) {
  const [view, setView] = useState<'total' | 'products'>('total');
  const value = view === 'total' ? day.ticket.totalCents : day.ticket.productsCents;
  const comparison = view === 'total' ? day.comparison.ticketTotal : day.comparison.ticketProducts;
  return (
    <KpiCard
      label="Ticket médio"
      tone="purple"
      help="ticket"
      value={formatBRL(value)}
      support={view === 'total' ? 'com taxas' : 'só produtos'}
      comparison={<ComparisonLine comparison={comparison} against={against} />}
      action={
        <button
          type="button"
          onClick={() => setView((v) => (v === 'total' ? 'products' : 'total'))}
          aria-label={view === 'total' ? 'Ver só produtos' : 'Ver total com taxas'}
          className="h-11 rounded-lg px-2 text-xs font-semibold text-accent-blue hover:bg-muted"
        >
          {view === 'total' ? 'Só produtos' : 'Total'}
        </button>
      }
    />
  );
}

/** Dashboard of the day (D038): live numbers, comparison, attention now, channels, hours. */
export function DayDashboard() {
  const [compare, setCompare] = useState<CompareMode>('LAST_WEEK');
  const [scope, setScope] = useState<ReportScope>('STORE');
  const { data: day, isLoading, isFetching } = useDayReport({ scope, compare });

  if (isLoading || !day) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-36 flex-[1_1_230px] rounded-card" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  const against = againstLabel(day);
  const b = day.breakdown;
  const attention = day.attention;
  const channelsTotal = day.channels.reduce((t, c) => t + c.orders, 0);

  return (
    <div className={cn('space-y-5 transition-opacity', isFetching && 'opacity-90')}>
      <ReportHeader
        title={scope === 'NETWORK' ? 'Rede · hoje' : 'Hoje'}
        subtitle={`${formatLongDate(day.date)} · dia de negócio ${formatShortDate(day.date)}`}
        actions={
          <>
            <ScopeSwitch value={scope} onChange={setScope} />
            <Segmented
              label="Comparar com"
              value={compare}
              onChange={setCompare}
              options={[
                { value: 'LAST_WEEK', label: 'Semana passada' },
                { value: 'AVG_4_WEEKS', label: 'Média 4 semanas' },
              ]}
            />
          </>
        }
      />

      <KpiGrid>
        <KpiCard
          label="Faturamento"
          tone="blue"
          help="revenue"
          value={formatBRL(day.revenueCents)}
          support={
            <span className="tabular">
              Produtos {formatBRL(b.netProductsCents)} · serviço {formatBRL(b.serviceFeeCents)} ·
              entrega {formatBRL(b.deliveryFeeCents)}
              {day.refundsCents > 0 && ` · estornos −${formatBRL(day.refundsCents)}`}
            </span>
          }
          comparison={<ComparisonLine comparison={day.comparison.revenue} against={against} />}
        />
        <KpiCard
          label="Pedidos"
          tone="green"
          help="orders"
          value={b.orders.toLocaleString('pt-BR')}
          support="concluídos"
          comparison={<ComparisonLine comparison={day.comparison.orders} against={against} />}
        />
        <TicketCard day={day} against={against} />
        <KpiCard
          label="Em aberto"
          tone="orange"
          help="open"
          value={day.open.orders.toLocaleString('pt-BR')}
          support={`${formatBRL(day.open.totalCents)} a concluir`}
        />
        <KpiCard
          label="Cancelados"
          tone="critical"
          help="canceled"
          value={day.canceled.orders.toLocaleString('pt-BR')}
          support={formatBRL(day.canceled.totalCents)}
          comparison={<ComparisonLine comparison={day.comparison.canceled} against={against} />}
        />
      </KpiGrid>

      {attention && (
        <AttentionStrip
          items={[
            {
              key: 'pending',
              count: attention.pendingAcceptance,
              label: 'aguardando aceite',
              href: '/pedidos',
              level: 'attention',
            },
            {
              key: 'late',
              count: attention.lateTickets,
              label: 'tickets atrasados na cozinha',
              href: '/kds',
              level: 'critical',
            },
            {
              key: 'printers',
              count: attention.printersOffline,
              label: 'impressoras com problema',
              href: '/configuracoes/impressao',
              level: 'critical',
            },
            {
              key: 'soldout',
              count: attention.soldOut,
              label: 'itens esgotados',
              href: '/cardapio',
              level: 'attention',
            },
          ]}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <ReportCard
          title="Vendas por canal"
          summary={`${day.channels.length} canais · ${channelsTotal} pedidos`}
        >
          <BarList
            rows={day.channels.map((c) => ({
              key: c.channel,
              label: REPORT_CHANNEL_LABELS[c.channel],
              value: c.revenueCents,
              primary: formatBRL(c.revenueCents),
              secondary: `${c.orders} ped.`,
            }))}
          />
        </ReportCard>
        <ReportCard
          title="Mais vendidos"
          summary={`${day.topProducts.reduce((t, p) => t + p.quantity, 0)} itens`}
        >
          <BarList
            tone="green"
            rows={day.topProducts.map((p) => ({
              key: p.productId ?? p.name,
              label: p.name,
              value: p.revenueCents,
              primary: formatBRL(p.revenueCents),
              secondary: `${p.quantity} un.`,
            }))}
          />
        </ReportCard>
      </div>

      <ReportCard title="Pedidos por hora" summary={`hoje × ${against}`}>
        <HourColumns
          today={day.hours.today}
          compare={day.hours.compare}
          todayLabel="Hoje"
          compareLabel={
            day.comparison.mode === 'AVG_4_WEEKS' ? 'Média 4 semanas' : 'Semana passada'
          }
        />
      </ReportCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ReportCard title="Recebido" help="received" summary={formatBRL(day.received.cents)}>
          <BarList
            tone="purple"
            rows={[...day.received.byMethod]
              .sort((a, x) => x.cents - a.cents)
              .map((m) => ({
                key: m.method,
                label: PAYMENT_METHOD_LABELS[m.method],
                value: Math.max(0, m.cents),
                primary: formatBRL(m.cents),
              }))}
          />
          <Reconciliation day={day} />
        </ReportCard>
        <ReportCard
          title="Pedidos por status"
          summary={`${day.statuses.reduce((t, s) => t + s.orders, 0)} hoje`}
        >
          <BarList
            tone="orange"
            rows={day.statuses.map((s) => ({
              key: s.status,
              label: ORDER_STATUS_LABELS[s.status],
              value: s.orders,
              primary: s.orders,
            }))}
          />
        </ReportCard>
      </div>

      {day.units.length > 0 && (
        <ReportCard title="Por unidade" summary={`${day.units.length} unidades`}>
          <BarList
            rows={day.units.map((u) => ({
              key: u.storeId,
              label: u.name,
              value: u.revenueCents,
              primary: formatBRL(u.revenueCents),
              secondary: `${u.orders} ped. · ${u.open} abertos`,
            }))}
          />
        </ReportCard>
      )}
    </div>
  );
}

/** Why sold and received differ (D038): an exact identity, line by line. */
function Reconciliation({ day }: { day: DayReportDto }) {
  const r = day.reconciliation;
  const lines: [string, number, string?][] = [
    ['Faturamento', r.revenueCents],
    ['− A receber (entregues não pagos)', -r.receivableCents, 'receivable'],
    ['− Pago em outros dias (pedidos concluídos hoje)', -r.paidOnOtherDaysCents],
    ['+ Recebido de pedidos de dias anteriores', r.fromPreviousDaysCents],
    ['+ Recebido de pedidos ainda abertos', r.forOpenOrdersCents],
    ['+ Pedidos cancelados (pagos e estornados)', r.canceledNetCents],
  ];
  return (
    <details className="mt-4 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center gap-1 font-semibold">
        Por que o recebido é diferente do faturamento?
      </summary>
      <table className="mt-2 w-full">
        <tbody>
          {lines
            .filter(([, v], i) => i === 0 || v !== 0)
            .map(([label, value, help]) => (
              <tr key={label}>
                <td className="py-1 text-muted-foreground">
                  {label}
                  {help === 'receivable' && <HelpTip topic="receivable" label="A receber" />}
                </td>
                <td className="tabular py-1 text-right">{formatBRL(value)}</td>
              </tr>
            ))}
          <tr className="border-t font-bold">
            <td className="py-1">= Recebido</td>
            <td className="tabular py-1 text-right">{formatBRL(r.receivedCents)}</td>
          </tr>
          {r.differenceCents !== 0 && (
            <tr className="text-signal-critical">
              <td className="py-1">Diferença (avise o suporte)</td>
              <td className="tabular py-1 text-right">{formatBRL(r.differenceCents)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </details>
  );
}
