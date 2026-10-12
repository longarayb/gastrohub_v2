import { type BusinessHour } from './opening-hours.js';
import { currentBusinessDay } from './business-day.js';
import {
  DEFAULT_TIMEZONE,
  addDaysToDate,
  timeToMinutes,
  toBusinessDate,
  weekdayOfDate,
  zonedTimeToInstant,
} from '../utils/datetime.js';

/**
 * Platform billing rules (plans, subscriptions, invoices and the read-only mode for overdue
 * customers). Pure functions shared by the API (source of truth), the admin app and the
 * restaurant panel banners. Money in integer cents; due dates are calendar dates
 * ("YYYY-MM-DD") always in America/Sao_Paulo, whatever the store's timezone.
 */

export const BILLING_TIMEZONE = DEFAULT_TIMEZONE;

export const BillingInterval = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
} as const;
export type BillingInterval = (typeof BillingInterval)[keyof typeof BillingInterval];
export const BILLING_INTERVALS = Object.values(BillingInterval);

export const BILLING_INTERVAL_MONTHS: Record<BillingInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

export const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = {
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  YEARLY: 'Anual',
};

/** Platform defaults (configurable by the platform admin; grace also per customer). */
export const BILLING_DEFAULTS = {
  /** Days before the due date when the restaurant panel starts warning. */
  warnDaysBefore: 5,
  /** Days after the due date before read-only mode (still only at a safe moment). */
  graceDays: 7,
  /** Trial length of the open signup. */
  trialDays: 14,
  /** Invoices are generated this many days before their due date. */
  generateDaysAhead: 10,
} as const;

/**
 * Without opening hours the store may be working at any time of the day: read-only mode
 * starts at 04:00 local time, the quietest moment of a restaurant day.
 */
export const READ_ONLY_FALLBACK_MINUTES = 4 * 60;

// ---------------------------------------------------------------------------
// Calendar helpers

const parse = (date: string) => date.split('-').map(Number) as [number, number, number];
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Adds months to a calendar date keeping the billing anchor day, clamped to the month length:
 * anchor 31 → 2026-01-31, 2026-02-28, 2026-03-31.
 */
export function addMonthsToDate(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parse(date);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole days from `from` to `to` (calendar dates; negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [parse(from), parse(to)];
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

/** Calendar date in São Paulo of an instant (due dates and grace always use it). */
export const billingDate = (now: Date): string => toBusinessDate(now, BILLING_TIMEZONE);

/** Start (00:00 in São Paulo) of a calendar date. */
export const billingDayStart = (date: string): Date =>
  zonedTimeToInstant(date, 0, BILLING_TIMEZONE);

// ---------------------------------------------------------------------------
// Amounts

export interface PlanPricing {
  /** Price of one billing period (already with the customer's negotiated price, if any). */
  priceCents: number;
  /** Stores included in the price. */
  storeLimit: number;
  /** Price per store above the limit, per period. `null` = the limit is hard. */
  extraStorePriceCents: number | null;
}

export interface SubscriptionCharge {
  baseCents: number;
  extraStores: number;
  extraCents: number;
  totalCents: number;
}

function assertCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} inválido`);
}

/** Amount of one period for an organization with `activeStores` stores. */
export function subscriptionCharge(plan: PlanPricing, activeStores: number): SubscriptionCharge {
  assertCents(plan.priceCents, 'Preço');
  if (plan.extraStorePriceCents != null)
    assertCents(plan.extraStorePriceCents, 'Valor por unidade');
  const extraStores = Math.max(0, activeStores - plan.storeLimit);
  // Over a hard limit (stores created before a downgrade): nothing extra is charged.
  const extraCents =
    plan.extraStorePriceCents == null ? 0 : extraStores * plan.extraStorePriceCents;
  return {
    baseCents: plan.priceCents,
    extraStores: plan.extraStorePriceCents == null ? 0 : extraStores,
    extraCents,
    totalCents: plan.priceCents + extraCents,
  };
}

/** pt-BR reason why one more store cannot be created, or null when it can. */
export function storeLimitError(plan: PlanPricing, activeStores: number): string | null {
  if (activeStores < plan.storeLimit || plan.extraStorePriceCents != null) return null;
  return plan.storeLimit === 1
    ? 'O plano contratado inclui 1 unidade. Fale com o suporte para mudar de plano.'
    : `O plano contratado inclui ${plan.storeLimit} unidades. Fale com o suporte para mudar de plano.`;
}

/** Monthly equivalent of a period amount (MRR), rounded half up. */
export function monthlyEquivalentCents(totalCents: number, interval: BillingInterval): number {
  return Math.round(totalCents / BILLING_INTERVAL_MONTHS[interval]);
}

// ---------------------------------------------------------------------------
// Periods

export interface BillingPeriod {
  periodStart: string;
  /** Last day covered (inclusive). */
  periodEnd: string;
  /** Charged in advance: due on the first day of the period. */
  dueDate: string;
}

export interface BillingSchedule {
  /** First billed day (the trial end, or the start date without trial). */
  billingStart: string;
  interval: BillingInterval;
}

/** The n-th billing period (0-based) of a schedule; the anchor is the billing start day. */
export function billingPeriod(schedule: BillingSchedule, index: number): BillingPeriod {
  const months = BILLING_INTERVAL_MONTHS[schedule.interval];
  const anchor = parse(schedule.billingStart)[2];
  const start = addMonthsToDate(schedule.billingStart, index * months, anchor);
  const next = addMonthsToDate(schedule.billingStart, (index + 1) * months, anchor);
  return { periodStart: start, periodEnd: addDaysToDate(next, -1), dueDate: start };
}

/**
 * Periods that should have an invoice by `today` (due within `daysAhead`) and do not have
 * one yet. `billedStarts` = period starts already invoiced (paid, open or canceled).
 * Stops at `endsOn` (cancellation) when given.
 */
export function periodsToInvoice(
  schedule: BillingSchedule,
  options: {
    today: string;
    billedStarts: ReadonlySet<string>;
    daysAhead?: number;
    endsOn?: string | null;
  },
): BillingPeriod[] {
  const limit = addDaysToDate(
    options.today,
    options.daysAhead ?? BILLING_DEFAULTS.generateDaysAhead,
  );
  const result: BillingPeriod[] = [];
  for (let i = 0; i < 1200; i++) {
    const period = billingPeriod(schedule, i);
    if (period.dueDate > limit) break;
    if (options.endsOn && period.periodStart >= options.endsOn) break;
    if (!options.billedStarts.has(period.periodStart)) result.push(period);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Overdue, grace and read-only mode

export type ReadOnlyReason = 'OVERDUE' | 'SUSPENDED' | 'CANCELED';

export interface BillingTimelineInput {
  /** Trial ends at the start of this date (the first invoice is due on it). */
  trialEndsOn: string | null;
  /** Oldest unpaid due date (open invoices; the trial end when it expired unpaid). */
  oldestUnpaidDueDate: string | null;
  /** Next due date not yet paid (warning before it is due). */
  nextDueDate: string | null;
  /** Manual suspension by the platform admin. */
  suspendedAt: Date | null;
  canceledAt: Date | null;
  graceDays: number;
  warnDaysBefore: number;
  now: Date;
}

export interface BillingTimeline {
  today: string;
  trialActive: boolean;
  /** Days until `nextDueDate` (0 = today); null when nothing is due. */
  daysToDue: number | null;
  /** Days since the oldest unpaid due date (≥ 1 when overdue). */
  daysOverdue: number;
  /** Last day of the grace period (calendar date in São Paulo). */
  graceEndsOn: string | null;
  /** From this instant read-only mode may start (at the next safe moment of each store). */
  readOnlyEligibleAt: Date | null;
  readOnlyReason: ReadOnlyReason | null;
}

/** Billing situation of an organization, independent of each store's opening hours. */
export function billingTimeline(input: BillingTimelineInput): BillingTimeline {
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0) {
    throw new RangeError('Tolerância inválida');
  }
  const today = billingDate(input.now);
  const trialActive = !!input.trialEndsOn && today < input.trialEndsOn;

  const daysOverdue =
    input.oldestUnpaidDueDate && today > input.oldestUnpaidDueDate
      ? daysBetween(input.oldestUnpaidDueDate, today)
      : 0;
  const graceEndsOn = input.oldestUnpaidDueDate
    ? addDaysToDate(input.oldestUnpaidDueDate, input.graceDays)
    : null;

  const candidates: { at: Date; reason: ReadOnlyReason }[] = [];
  if (graceEndsOn) {
    candidates.push({ at: billingDayStart(addDaysToDate(graceEndsOn, 1)), reason: 'OVERDUE' });
  }
  if (input.suspendedAt) candidates.push({ at: input.suspendedAt, reason: 'SUSPENDED' });
  if (input.canceledAt) candidates.push({ at: input.canceledAt, reason: 'CANCELED' });
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = candidates[0] ?? null;

  return {
    today,
    trialActive,
    daysToDue: input.nextDueDate ? daysBetween(today, input.nextDueDate) : null,
    daysOverdue,
    graceEndsOn,
    readOnlyEligibleAt: first?.at ?? null,
    readOnlyReason: first?.reason ?? null,
  };
}

/**
 * First safe moment for read-only mode at or after `eligibleAt` for one store: never in the
 * middle of a business day. If the store's business day is under way (a shift of that day
 * already started, including breaks between lunch and dinner and shifts past midnight), it
 * waits until that business day ends; if the store has not opened yet, it starts right away.
 * Without opening hours: the next 04:00 local time.
 */
export function readOnlyStartsAt(
  eligibleAt: Date,
  hours: readonly BusinessHour[],
  timeZone = DEFAULT_TIMEZONE,
): Date {
  if (hours.length === 0) {
    const date = toBusinessDate(eligibleAt, timeZone);
    const sameDay = zonedTimeToInstant(date, READ_ONLY_FALLBACK_MINUTES, timeZone);
    return sameDay.getTime() >= eligibleAt.getTime()
      ? sameDay
      : zonedTimeToInstant(addDaysToDate(date, 1), READ_ONLY_FALLBACK_MINUTES, timeZone);
  }
  const day = currentBusinessDay(hours, eligibleAt, timeZone);
  const shifts = hours.filter((h) => h.weekday === weekdayOfDate(day.date));
  const firstOpen = Math.min(
    ...shifts.map((h) =>
      zonedTimeToInstant(day.date, timeToMinutes(h.opensAt), timeZone).getTime(),
    ),
  );
  return firstOpen <= eligibleAt.getTime() ? day.endsAt : eligibleAt;
}

/** SCHEDULED: read-only mode already decided (manual suspension or cancellation) but not started. */
export type BillingLevel = 'OK' | 'TRIAL' | 'DUE_SOON' | 'OVERDUE' | 'SCHEDULED' | 'READ_ONLY';

export interface StoreBillingAccess {
  level: BillingLevel;
  /** New sales are blocked. */
  readOnly: boolean;
  /** When read-only mode starts (or started) for this store. */
  readOnlyFrom: Date | null;
  readOnlyReason: ReadOnlyReason | null;
  daysToDue: number | null;
  daysOverdue: number;
  trialEndsOn: string | null;
  dueDate: string | null;
}

/** What one store's panel shows and allows (banners and the read-only mode). */
export function storeBillingAccess(
  input: BillingTimelineInput & { hours: readonly BusinessHour[]; timeZone?: string },
): StoreBillingAccess {
  const t = billingTimeline(input);
  const readOnlyFrom = t.readOnlyEligibleAt
    ? readOnlyStartsAt(t.readOnlyEligibleAt, input.hours, input.timeZone)
    : null;
  const readOnly = !!readOnlyFrom && input.now.getTime() >= readOnlyFrom.getTime();

  let level: BillingLevel = 'OK';
  if (readOnly) level = 'READ_ONLY';
  else if (t.daysOverdue > 0) level = 'OVERDUE';
  else if (readOnlyFrom && t.readOnlyReason !== 'OVERDUE') level = 'SCHEDULED';
  else if (t.trialActive) level = 'TRIAL';
  else if (t.daysToDue != null && t.daysToDue <= input.warnDaysBefore) level = 'DUE_SOON';

  return {
    level,
    readOnly,
    readOnlyFrom,
    readOnlyReason: t.readOnlyReason,
    daysToDue: t.daysToDue,
    daysOverdue: t.daysOverdue,
    trialEndsOn: input.trialEndsOn,
    dueDate: t.daysOverdue > 0 ? input.oldestUnpaidDueDate : input.nextDueDate,
  };
}

// ---------------------------------------------------------------------------
// Admin view

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  SUSPENDED: 'SUSPENDED',
  CANCELED: 'CANCELED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativo',
  PAST_DUE: 'Atrasado',
  SUSPENDED: 'Somente leitura',
  CANCELED: 'Cancelado',
};

/** Organization status in the admin app (read-only counts once eligible, before each store's boundary). */
export function subscriptionStatus(input: BillingTimelineInput): SubscriptionStatus {
  const t = billingTimeline(input);
  if (input.canceledAt && input.canceledAt.getTime() <= input.now.getTime()) return 'CANCELED';
  if (t.readOnlyEligibleAt && t.readOnlyEligibleAt.getTime() <= input.now.getTime()) {
    return 'SUSPENDED';
  }
  if (t.daysOverdue > 0) return 'PAST_DUE';
  if (t.trialActive) return 'TRIALING';
  return 'ACTIVE';
}

/** Monthly recurring revenue: paying customers only (active and overdue in grace). */
export function monthlyRecurringRevenue(
  subscriptions: readonly {
    status: SubscriptionStatus;
    totalCents: number;
    interval: BillingInterval;
  }[],
): number {
  return subscriptions
    .filter((s) => s.status === 'ACTIVE' || s.status === 'PAST_DUE')
    .reduce((sum, s) => sum + monthlyEquivalentCents(s.totalCents, s.interval), 0);
}
