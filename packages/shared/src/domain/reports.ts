import {
  DEFAULT_TIMEZONE,
  timeToMinutes,
  toLocalTime,
  weekdayOfDate,
  zonedTimeToInstant,
} from '../utils/datetime.js';
import type { OrderSource, OrderType } from './order-status.js';

/**
 * Report definitions (docs/DECISOES.md D038). One place for what "faturamento", "recebido",
 * "ticket médio" mean, used by the dashboard, the reports, the CSV export and the e2e that
 * reconciles them with the cash close and the delivery report.
 *
 * - An order counts on the business day it was **concluded** (`closedBusinessDate`), like the
 *   cash register: a table opened before midnight and closed after counts on the closing day.
 * - Faturamento = concluded orders (DELIVERED). Orders in progress and canceled ones stay out
 *   (canceled ones are in the losses report). A delivered order not paid yet counts and is also
 *   shown as "a receber".
 * - Refunds of concluded orders are subtracted on the business day of the refund (as the cash).
 */

// ---------------------------------------------------------------------------
// Sales channels

export const REPORT_CHANNELS = [
  'COUNTER',
  'TABLE',
  'DELIVERY',
  'DIGITAL_MENU',
  'MARKETPLACE',
] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

export const REPORT_CHANNEL_LABELS: Record<ReportChannel, string> = {
  COUNTER: 'Balcão',
  TABLE: 'Mesa',
  DELIVERY: 'Delivery próprio',
  DIGITAL_MENU: 'Cardápio digital',
  MARKETPLACE: 'Marketplaces',
};

const MARKETPLACES: readonly OrderSource[] = [
  'IFOOD',
  'NINETY_NINE_FOOD',
  'AIQFOME',
  'OPEN_DELIVERY',
];

/** Channel of an order: the source decides first (digital menu, marketplaces), then the type. */
export function reportChannelOf(type: OrderType, source: OrderSource): ReportChannel {
  if (source === 'DIGITAL_MENU') return 'DIGITAL_MENU';
  if (MARKETPLACES.includes(source)) return 'MARKETPLACE';
  if (type === 'DINE_IN') return 'TABLE';
  if (type === 'DELIVERY') return 'DELIVERY';
  return 'COUNTER';
}

// ---------------------------------------------------------------------------
// Sales breakdown

export interface OrderAmounts {
  subtotalCents: number;
  itemDiscountCents: number;
  orderDiscountCents: number;
  couponDiscountCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  totalCents: number;
}

export interface SalesBreakdown {
  orders: number;
  /** Price of the items not canceled, before any discount. */
  grossProductsCents: number;
  itemDiscountCents: number;
  orderDiscountCents: number;
  couponDiscountCents: number;
  discountsCents: number;
  /** Products after every discount (what the products sold for). */
  netProductsCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  /** What the customers were charged: net products + service fee + delivery fee. */
  totalCents: number;
}

export const emptyBreakdown = (): SalesBreakdown => ({
  orders: 0,
  grossProductsCents: 0,
  itemDiscountCents: 0,
  orderDiscountCents: 0,
  couponDiscountCents: 0,
  discountsCents: 0,
  netProductsCents: 0,
  serviceFeeCents: 0,
  deliveryFeeCents: 0,
  totalCents: 0,
});

/** Sums concluded orders. Same composition as `calculateOrderTotals`. */
export function salesBreakdown(orders: readonly OrderAmounts[]): SalesBreakdown {
  const b = emptyBreakdown();
  for (const o of orders) {
    b.orders += 1;
    b.grossProductsCents += o.subtotalCents + o.itemDiscountCents;
    b.itemDiscountCents += o.itemDiscountCents;
    b.orderDiscountCents += o.orderDiscountCents;
    b.couponDiscountCents += o.couponDiscountCents;
    b.serviceFeeCents += o.serviceFeeCents;
    b.deliveryFeeCents += o.deliveryFeeCents;
    b.totalCents += o.totalCents;
  }
  b.discountsCents = b.itemDiscountCents + b.orderDiscountCents + b.couponDiscountCents;
  b.netProductsCents = b.grossProductsCents - b.discountsCents;
  return b;
}

/** Same breakdown from totals already summed by the database (long periods). */
export function salesBreakdownFromSums(orders: number, sums: OrderAmounts): SalesBreakdown {
  const b = salesBreakdown([sums]);
  return { ...b, orders };
}

export function addBreakdowns(list: readonly SalesBreakdown[]): SalesBreakdown {
  const sum = emptyBreakdown();
  for (const b of list) {
    for (const key of Object.keys(sum) as (keyof SalesBreakdown)[]) sum[key] += b[key];
  }
  return sum;
}

export interface Revenue {
  breakdown: SalesBreakdown;
  /** Refunds of concluded orders made on this business day. */
  refundsCents: number;
  /** Faturamento total líquido = total of concluded orders − refunds of concluded orders. */
  revenueCents: number;
}

export const revenueOf = (breakdown: SalesBreakdown, refundsCents: number): Revenue => ({
  breakdown,
  refundsCents,
  revenueCents: breakdown.totalCents - refundsCents,
});

/** Average ticket in both views: what the customer paid, and products only. */
export function averageTicket(b: SalesBreakdown): { totalCents: number; productsCents: number } {
  if (!b.orders) return { totalCents: 0, productsCents: 0 };
  return {
    totalCents: Math.round(b.totalCents / b.orders),
    productsCents: Math.round(b.netProductsCents / b.orders),
  };
}

// ---------------------------------------------------------------------------
// Reconciliation with the cash registers

export interface ReconciliationInput {
  revenueCents: number;
  /** Concluded today, total minus everything ever paid on it (refunds do not reopen it). */
  receivableCents: number;
  /** Payments of orders concluded today received on other business days. */
  paidOnOtherDaysCents: number;
  /** Payments today of orders concluded on previous days (receivables collected). */
  fromPreviousDaysCents: number;
  /** Payments today of orders not concluded on this day (tables paying as they go), net of
   *  their refunds today. */
  forOpenOrdersCents: number;
  /** Payments today of canceled orders minus their refunds today (normally zero: a paid order
   *  is refunded before canceling). */
  canceledNetCents: number;
  /** Payments minus refunds of the business day, every method (cash registers + online). */
  receivedCents: number;
}

export interface Reconciliation extends ReconciliationInput {
  /** received − (revenue − receivable − paid on other days + from previous days + open + canceled).
   *  Always zero when the data is consistent; shown (and tested) to prove it. */
  differenceCents: number;
}

/**
 * Exact identity between what was sold and what was received on a business day:
 * received = revenue − receivable − paid on other days + from previous days + open + canceled.
 * Refunds of concluded orders are inside the revenue (D038), refunds of other orders inside
 * their line.
 */
export function reconcile(input: ReconciliationInput): Reconciliation {
  const explained =
    input.revenueCents -
    input.receivableCents -
    input.paidOnOtherDaysCents +
    input.fromPreviousDaysCents +
    input.forOpenOrdersCents +
    input.canceledNetCents;
  return { ...input, differenceCents: input.receivedCents - explained };
}

/** Start of a business day: first opening of that weekday (midnight without hours). */
export function businessDayStart(
  date: string,
  hours: readonly { weekday: number; opensAt: string }[],
  timeZone = DEFAULT_TIMEZONE,
): Date {
  const shifts = hours.filter((h) => h.weekday === weekdayOfDate(date));
  const minutes = shifts.length ? Math.min(...shifts.map((h) => timeToMinutes(h.opensAt))) : 0;
  return zonedTimeToInstant(date, minutes, timeZone);
}

/**
 * Same moment of another business day, to compare "until now": today at 14:00, 3 h after
 * opening → the comparison day 3 h after its own opening.
 */
export function sameMomentOn(
  date: string,
  reference: { date: string; now: Date },
  hours: readonly { weekday: number; opensAt: string }[],
  timeZone = DEFAULT_TIMEZONE,
): Date {
  const elapsed =
    reference.now.getTime() - businessDayStart(reference.date, hours, timeZone).getTime();
  return new Date(businessDayStart(date, hours, timeZone).getTime() + Math.max(elapsed, 0));
}

// ---------------------------------------------------------------------------
// Comparisons

/** For revenue "up" is better; for times and cancellations "down" is better. */
export type Better = 'up' | 'down';

export interface Comparison {
  current: number;
  previous: number;
  delta: number;
  /** null when there is nothing to compare with (previous zero). */
  deltaPct: number | null;
  trend: 'better' | 'worse' | 'same';
}

export function compare(current: number, previous: number, better: Better = 'up'): Comparison {
  const delta = current - previous;
  const deltaPct = previous ? Math.round((delta / Math.abs(previous)) * 1000) / 10 : null;
  const trend = delta === 0 ? 'same' : delta > 0 === (better === 'up') ? 'better' : 'worse';
  return { current, previous, delta, deltaPct, trend };
}

/** Business dates to compare a day with: same weekday 1 week ago, or the last `weeks` weeks. */
export function comparisonDates(date: string, mode: 'LAST_WEEK' | 'AVG_4_WEEKS'): string[] {
  const weeks = mode === 'LAST_WEEK' ? 1 : 4;
  const base = new Date(`${date}T12:00:00Z`);
  return Array.from({ length: weeks }, (_, i) => {
    const d = new Date(base.getTime() - (i + 1) * 7 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

export const averageOf = (values: readonly number[]): number =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

// ---------------------------------------------------------------------------
// ABC curve

export type AbcClass = 'A' | 'B' | 'C';
export const ABC_LIMITS = { A: 80, B: 95 } as const;

export interface AbcRow<T> {
  item: T;
  valueCents: number;
  /** Share of the total, in percent with one decimal. */
  sharePct: number;
  /** Cumulative share including this item. */
  cumulativePct: number;
  abc: AbcClass;
}

/**
 * Pareto classification by value: sorted from the largest; an item is A while the share
 * accumulated BEFORE it is under 80% (so the item that crosses 80% is still A), B under 95%,
 * C for the rest. Items with zero value are C.
 */
export function abcCurve<T>(items: readonly T[], value: (item: T) => number): AbcRow<T>[] {
  const total = items.reduce((sum, i) => sum + Math.max(0, value(i)), 0);
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  let before = 0;
  return sorted.map((item) => {
    const v = Math.max(0, value(item));
    const share = total ? (v / total) * 100 : 0;
    const abc: AbcClass =
      v === 0 ? 'C' : before < ABC_LIMITS.A ? 'A' : before < ABC_LIMITS.B ? 'B' : 'C';
    before += share;
    return {
      item,
      valueCents: v,
      sharePct: Math.round(share * 10) / 10,
      cumulativePct: Math.round(Math.min(before, 100) * 10) / 10,
      abc,
    };
  });
}

// ---------------------------------------------------------------------------
// Hour and weekday

/** Local hour (0–23) and weekday (0 = Sunday) of an instant in the store time zone. */
export function localHourAndWeekday(
  at: Date,
  timeZone?: string,
): { hour: number; weekday: number } {
  const local = toLocalTime(at, timeZone);
  return { hour: Math.floor(local.minutes / 60), weekday: local.weekday };
}

/** 7 × 24 matrix (weekday × hour) of a value summed over instants. */
export function heatmap(
  points: readonly { at: Date; value: number }[],
  timeZone?: string,
): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const p of points) {
    const { hour, weekday } = localHourAndWeekday(p.at, timeZone);
    grid[weekday]![hour]! += p.value;
  }
  return grid;
}

/** Totals per local hour (0–23). */
export function byHour(
  points: readonly { at: Date; value: number }[],
  timeZone?: string,
): number[] {
  const hours = Array<number>(24).fill(0);
  for (const p of points) hours[localHourAndWeekday(p.at, timeZone).hour]! += p.value;
  return hours;
}

// ---------------------------------------------------------------------------
// Durations (KDS and delivery times)

/** Percentile by linear interpolation (p in 0–100). */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return Math.round(sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low));
}

export interface DurationStats {
  count: number;
  /** Seconds. */
  medianSeconds: number | null;
  p90Seconds: number | null;
  averageSeconds: number | null;
  /** Share above the limit (e.g. the red alert of the sector), in percent. */
  overLimitPct: number | null;
}

export function durationStats(seconds: readonly number[], limitSeconds?: number): DurationStats {
  const valid = seconds.filter((s) => Number.isFinite(s) && s >= 0);
  return {
    count: valid.length,
    medianSeconds: percentile(valid, 50),
    p90Seconds: percentile(valid, 90),
    averageSeconds: valid.length
      ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
      : null,
    overLimitPct:
      limitSeconds && valid.length
        ? Math.round((valid.filter((s) => s > limitSeconds).length / valid.length) * 1000) / 10
        : null,
  };
}

// ---------------------------------------------------------------------------
// Help texts (the ⓘ of each indicator; same text as DECISOES.md D038)

export const REPORT_HELP = {
  revenue:
    'Soma dos pedidos concluídos no dia de negócio (entregues ou fechados), com a taxa de serviço e a de entrega, menos os estornos de pedidos concluídos feitos no dia. Pedido aberto num dia e concluído no outro conta no dia da conclusão, como no caixa. Pedidos em andamento e cancelados ficam de fora.',
  breakdown:
    'Produtos brutos (preço de tabela dos itens não cancelados) − descontos (de item, do pedido e de cupom) = produtos líquidos; + taxa de serviço + taxa de entrega = faturamento.',
  orders: 'Pedidos concluídos no dia de negócio. Na mesa, cada conta é um pedido.',
  ticket:
    'Faturamento ÷ pedidos concluídos. "Só produtos" desconsidera a taxa de serviço e a de entrega.',
  open: 'Pedidos ainda não concluídos (aguardando aceite, em preparo, prontos, em entrega e mesas abertas). Entram no faturamento quando forem concluídos.',
  canceled:
    'Pedidos cancelados no dia, com o valor que tinham ao cancelar. Não entram no faturamento; os detalhes estão em Controle de perdas.',
  receivable:
    'Deliveries entregues e ainda não pagos (ou pagos em parte). Já contam no faturamento; entram no recebido quando forem pagos.',
  received:
    'Pagamentos confirmados no dia, menos os estornos do dia, em todas as formas (caixas e online). Bate com a soma dos fechamentos de caixa mais os pagamentos online.',
  refunds: 'Estornos de pagamentos de pedidos concluídos, contados no dia em que foram feitos.',
  comparison:
    'Comparação com o mesmo dia da semana anterior até o mesmo horário (ou com a média das últimas 4 semanas, se escolhida).',
  abc: 'Curva ABC: produtos do maior para o menor faturamento. A = os que somam os primeiros 80%; B = até 95%; C = o restante.',
  prepTime:
    'Tempo do envio para a cozinha até o pronto no KDS. Mediana: metade dos itens fica abaixo. P90: 9 em cada 10 ficam abaixo.',
} as const;
export type ReportHelpKey = keyof typeof REPORT_HELP;
