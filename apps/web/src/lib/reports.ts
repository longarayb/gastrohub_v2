import {
  type CompareMode,
  type DayReportDto,
  type LossesReportDto,
  type ReportKind,
  type ReportScope,
  type SalesReportDto,
  type TimesReportDto,
  addDaysToDate,
} from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, apiGet } from './api';

export const reportKeys = {
  all: ['reports'] as const,
  day: (scope: ReportScope, compare: CompareMode, date?: string) =>
    ['reports', 'day', scope, compare, date ?? 'current'] as const,
  sales: (scope: ReportScope, from: string, to: string) =>
    ['reports', 'sales', scope, from, to] as const,
  losses: (from: string, to: string) => ['reports', 'losses', from, to] as const,
  times: (from: string, to: string) => ['reports', 'times', from, to] as const,
};

/** Dashboard of the day: refetched on order events (realtime) and every minute. */
export const useDayReport = (query: { scope: ReportScope; compare: CompareMode; date?: string }) =>
  useQuery({
    queryKey: reportKeys.day(query.scope, query.compare, query.date),
    queryFn: () => apiGet<DayReportDto>('/reports/day', query),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

export const useSalesReport = (scope: ReportScope, from: string, to: string) =>
  useQuery({
    queryKey: reportKeys.sales(scope, from, to),
    queryFn: () => apiGet<SalesReportDto>('/reports/sales', { scope, from, to }),
    placeholderData: keepPreviousData,
  });

export const useLossesReport = (from: string, to: string) =>
  useQuery({
    queryKey: reportKeys.losses(from, to),
    queryFn: () => apiGet<LossesReportDto>('/reports/losses', { from, to }),
    placeholderData: keepPreviousData,
  });

export const useTimesReport = (from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: reportKeys.times(from, to),
    queryFn: () => apiGet<TimesReportDto>('/reports/times', { from, to }),
    placeholderData: keepPreviousData,
    enabled,
  });

/** Downloads one section of a report as CSV (Excel pt-BR). */
export async function downloadCsv(report: ReportKind, section: string, from: string, to: string) {
  const text = await api<string>(`/reports/${report}/csv`, { query: { from, to, section } });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report}-${section}-${from}-a-${to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Periods

export const PERIODS = [
  { id: 'today', label: 'Hoje', days: 1 },
  { id: '7d', label: '7 dias', days: 7 },
  { id: '30d', label: '30 dias', days: 30 },
  { id: '90d', label: '90 dias', days: 90 },
] as const;
export type PeriodId = (typeof PERIODS)[number]['id'] | 'month' | 'lastMonth' | 'custom';

/** Period ending on `today` (the current business date, from the server). */
export function periodRange(id: PeriodId, today: string): { from: string; to: string } {
  const preset = PERIODS.find((p) => p.id === id);
  if (preset) return { from: addDaysToDate(today, -(preset.days - 1)), to: today };
  if (id === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (id === 'lastMonth') {
    const firstOfMonth = `${today.slice(0, 8)}01`;
    const lastOfPrevious = addDaysToDate(firstOfMonth, -1);
    return { from: `${lastOfPrevious.slice(0, 8)}01`, to: lastOfPrevious };
  }
  return { from: today, to: today };
}

const longDate = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

export const formatLongDate = (date: string) => longDate.format(new Date(`${date}T12:00:00Z`));
export const formatShortDate = (date: string) => shortDate.format(new Date(`${date}T12:00:00Z`));
export const formatPeriod = (from: string, to: string) =>
  from === to ? formatShortDate(from) : `${formatShortDate(from)} a ${formatShortDate(to)}`;

/** "1h 05min" / "12 min" from seconds. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
}
