import { z } from 'zod';

/** Report queries (D038). Dates are business dates (YYYY-MM-DD). */

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

/** Longest period of a report (one year). */
export const MAX_REPORT_DAYS = 366;

export const REPORT_SCOPES = ['STORE', 'NETWORK'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export const COMPARE_MODES = ['LAST_WEEK', 'AVG_4_WEEKS'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const dayReportQuerySchema = z.object({
  /** Business date; the current one when omitted. */
  date: zDate.optional(),
  compare: z.enum(COMPARE_MODES).default('LAST_WEEK'),
  scope: z.enum(REPORT_SCOPES).default('STORE'),
});
export type DayReportQuery = z.input<typeof dayReportQuerySchema>;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

export const periodQuerySchema = z
  .object({
    from: zDate,
    to: zDate,
    scope: z.enum(REPORT_SCOPES).default('STORE'),
  })
  .refine((q) => q.from <= q.to, { message: 'A data inicial é depois da final', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) <= MAX_REPORT_DAYS, {
    message: 'Escolha um período de até 1 ano',
    path: ['from'],
  });
export type PeriodQuery = z.input<typeof periodQuerySchema>;

/** CSV sections of each report. */
export const CSV_SECTIONS = {
  sales: ['products', 'categories', 'payments', 'channels', 'days', 'hours', 'waiters'],
  losses: ['events', 'users'],
  times: ['sectors', 'products'],
} as const;
export type ReportKind = keyof typeof CSV_SECTIONS;

export const csvQuerySchema = z
  .object({
    from: zDate,
    to: zDate,
    section: z.string().min(1),
  })
  .refine((q) => q.from <= q.to && daysBetween(q.from, q.to) <= MAX_REPORT_DAYS, {
    message: 'Período inválido',
    path: ['from'],
  });
