import type {
  AbcClass,
  Comparison,
  DurationStats,
  ReportChannel,
  SalesBreakdown,
} from '../domain/reports.js';
import type { Reconciliation } from '../domain/reports.js';
import type { OrderStatus } from '../domain/order-status.js';
import type { PaymentMethod } from '../orders/payment-methods.js';
import type { CompareMode } from './schemas.js';

/** Response DTOs of the reports (D038). Money in cents, dates ISO. */

export interface ReportUnit {
  storeId: string;
  name: string;
}

export interface ChannelRow {
  channel: ReportChannel;
  orders: number;
  revenueCents: number;
}

export interface TopProductRow {
  productId: string | null;
  name: string;
  quantity: number;
  /** Value of the items (after item discounts; the order discount is not spread). */
  revenueCents: number;
}

export interface AttentionNow {
  pendingAcceptance: number;
  lateTickets: number;
  printersOffline: number;
  soldOut: number;
}

export interface DayComparison {
  mode: CompareMode;
  /** Business dates compared with. */
  dates: string[];
  /** Comparison until the same moment of the business day (only for the current day). */
  untilSameTime: boolean;
  revenue: Comparison;
  orders: Comparison;
  ticketTotal: Comparison;
  ticketProducts: Comparison;
  canceled: Comparison;
}

export interface DayReportDto {
  scope: 'STORE' | 'NETWORK';
  units: (ReportUnit & { revenueCents: number; orders: number; open: number })[];
  date: string;
  /** Business day still running (live data, "Atenção agora"). */
  isCurrent: boolean;
  serverTime: string;
  breakdown: SalesBreakdown;
  refundsCents: number;
  revenueCents: number;
  ticket: { totalCents: number; productsCents: number };
  open: { orders: number; totalCents: number };
  canceled: { orders: number; totalCents: number };
  receivable: { orders: number; cents: number };
  received: { cents: number; byMethod: { method: PaymentMethod; cents: number }[] };
  reconciliation: Reconciliation;
  comparison: DayComparison;
  channels: ChannelRow[];
  statuses: { status: OrderStatus; orders: number }[];
  topProducts: TopProductRow[];
  /** Orders created per local hour (0–23): this day and the comparison (average). */
  hours: { today: number[]; compare: number[] };
  attention: AttentionNow | null;
}

export interface ProductSalesRow extends TopProductRow {
  categoryName: string;
  sharePct: number;
  cumulativePct: number;
  abc: AbcClass;
}

export interface CategorySalesRow {
  categoryId: string | null;
  name: string;
  quantity: number;
  revenueCents: number;
  sharePct: number;
}

export interface PaymentMethodRow {
  method: PaymentMethod;
  receivedCents: number;
  refundedCents: number;
  netCents: number;
  payments: number;
}

export interface WaiterRow {
  userId: string | null;
  name: string;
  /** Items sent by this user (rounds), value after item discounts. */
  itemsCents: number;
  items: number;
  tables: number;
  /** Service fee of the tables this user served. */
  serviceFeeCents: number;
}

export interface SalesReportDto {
  scope: 'STORE' | 'NETWORK';
  units: (ReportUnit & { revenueCents: number; orders: number })[];
  from: string;
  to: string;
  breakdown: SalesBreakdown;
  refundsCents: number;
  revenueCents: number;
  ticket: { totalCents: number; productsCents: number };
  days: { date: string; orders: number; revenueCents: number }[];
  products: ProductSalesRow[];
  categories: CategorySalesRow[];
  payments: PaymentMethodRow[];
  channels: ChannelRow[];
  /** weekday (0 = Sunday) × hour: orders and revenue of orders created then. */
  heatmap: { orders: number[][]; revenueCents: number[][] };
  waiters: WaiterRow[];
  /** Server time spent (for the performance budget of D038). */
  elapsedMs: number;
}

export const LOSS_KINDS = [
  'ORDER_CANCELED',
  'ITEM_CANCELED',
  'REFUND',
  'DISCOUNT',
  'SERVICE_FEE_REMOVED',
  'REPRINT',
  'CASH_DIFFERENCE',
  'CASH_REOPENED',
] as const;
export type LossKind = (typeof LOSS_KINDS)[number];

export const LOSS_KIND_LABELS: Record<LossKind, string> = {
  ORDER_CANCELED: 'Pedido cancelado',
  ITEM_CANCELED: 'Item cancelado',
  REFUND: 'Estorno',
  DISCOUNT: 'Desconto',
  SERVICE_FEE_REMOVED: 'Taxa de serviço retirada',
  REPRINT: 'Reimpressão',
  CASH_DIFFERENCE: 'Diferença de caixa',
  CASH_REOPENED: 'Caixa reaberto',
};

export interface LossEvent {
  kind: LossKind;
  at: string;
  businessDate: string;
  userId: string | null;
  userName: string;
  reason: string | null;
  /** Money involved (difference can be negative: missing cash). */
  cents: number;
  orderId: string | null;
  orderNumber: number | null;
  description: string;
  /** Canceled after being sent to the kitchen (or printed): the strongest signal. */
  afterProduction: boolean;
}

export interface LossUserRow {
  userId: string | null;
  name: string;
  counts: Partial<Record<LossKind, number>>;
  cents: Partial<Record<LossKind, number>>;
  afterProduction: number;
}

export interface LossesReportDto {
  from: string;
  to: string;
  /** The most recent events (up to 500 on screen); `eventCount` has them all. */
  events: LossEvent[];
  eventCount: number;
  totals: { kind: LossKind; count: number; cents: number }[];
  users: LossUserRow[];
  reasons: { kind: LossKind; reason: string; count: number; cents: number }[];
}

export interface TimesRow {
  /** Sector or product. */
  id: string | null;
  name: string;
  sectorName?: string;
  wait: DurationStats;
  prep: DurationStats;
  total: DurationStats;
}

export interface TimesReportDto {
  from: string;
  to: string;
  sectors: (TimesRow & { lateAfterMinutes: number })[];
  products: TimesRow[];
}
