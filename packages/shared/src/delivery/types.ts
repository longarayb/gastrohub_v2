import type {
  CourierStatus,
  DeliveryAreaKind,
  DeliveryFailureReason,
  DeliveryQuote,
} from '../domain/delivery.js';
import type { OrderStatus } from '../domain/order-status.js';
import type { PaymentMethod } from '../orders/schemas.js';
import type { Address } from '../schemas/common.js';

/** Response DTOs of delivery (D029–D031). Dates are ISO strings; money in cents. */

export interface DeliveryAreaDto {
  id: string;
  name: string;
  kind: DeliveryAreaKind;
  neighborhoods: string[];
  city: string | null;
  radiusMeters: number | null;
  feeCents: number;
  etaMinutes: number;
  minimumOrderCents: number | null;
  freeAboveCents: number | null;
  pausedReason: string | null;
  pausedUntil: string | null;
  /** Paused right now (an expired pause is not). */
  paused: boolean;
  sortOrder: number;
}

export interface UnmatchedNeighborhoodDto {
  neighborhood: string;
  city: string;
  occurrences: number;
  lastSeenAt: string;
}

export interface DeliveryQuoteDto {
  /** Area found for the address, or null (out of area, paused or needs a manual choice). */
  area: { id: string; name: string; matchedBy: 'NEIGHBORHOOD' | 'RADIUS' } | null;
  quote: DeliveryQuote | null;
  /** Why there is no area (shown to the operator). */
  message: string | null;
  reason: 'PAUSED' | 'OUT_OF_AREA' | 'NEEDS_COORDINATES' | 'NO_AREAS' | null;
  coordinates: { latitude: number; longitude: number } | null;
  distanceMeters: number | null;
  /** Areas for a manual choice (paused ones flagged). */
  areas: {
    id: string;
    name: string;
    feeCents: number;
    etaMinutes: number;
    minimumOrderCents: number | null;
    freeAboveCents: number | null;
    paused: boolean;
  }[];
  /** Store minimum, used when an area has none (manual choice in the composer). */
  storeMinimumCents: number;
}

export interface DeliveryStopDto {
  id: string;
  runId: string;
  courierName: string;
  sequence: number;
  dispatchedAt: string;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: DeliveryFailureReason | null;
  failureNote: string | null;
  collectedMethod: PaymentMethod | null;
  collectedCents: number | null;
  receivedCents: number | null;
  changeCents: number | null;
}

/** Delivery block of an order detail. */
export interface OrderDeliveryDto {
  areaId: string | null;
  areaName: string | null;
  areaSource: 'AUTO' | 'MANUAL' | 'NONE';
  etaMinutes: number | null;
  distanceMeters: number | null;
  suggestedFeeCents: number | null;
  feeChangeReason: string | null;
  attempts: number;
  links: { google: string; waze: string } | null;
  stops: DeliveryStopDto[];
}

export interface CourierDetailDto {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  userId: string | null;
  userName: string | null;
  status: CourierStatus;
  /** Running balance: positive = the restaurant owes the courier. */
  balanceCents: number;
  perDeliveryCents: number | null;
  feeShareBps: number | null;
  dailyCents: number | null;
  openRun: { id: string; departedAt: string; stops: number; delivered: number } | null;
  pendingSettlementRuns: number;
}

export interface CourierPaySettingsDto {
  perDeliveryCents: number;
  feeShareBps: number;
  dailyCents: number;
}

/** Courier app: one stop of the signed-in courier's open route (only what the delivery needs). */
export interface CourierAppStopDto {
  stopId: string;
  orderNumber: number;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  customerName: string | null;
  customerPhone: string | null;
  address: Address | null;
  links: { google: string; waze: string } | null;
  notes: string | null;
  /** What to charge (balance of the order) and how the customer said they would pay. */
  chargeCents: number;
  expectedPaymentMethod: PaymentMethod | null;
  changeForCents: number | null;
  collectedMethod: PaymentMethod | null;
  collectedCents: number | null;
  receivedCents: number | null;
  changeCents: number | null;
  failureReason: DeliveryFailureReason | null;
  /** The customer said they paid by PIX: confirm, do not charge again. */
  pixReportedAt: string | null;
}

export interface CourierAppDto {
  courier: { id: string; name: string } | null;
  run: { id: string; departedAt: string; stops: CourierAppStopDto[] } | null;
}

export interface SettlementStopDto {
  stopId: string;
  runId: string;
  orderId: string;
  orderNumber: number;
  customerName: string | null;
  status: 'DELIVERED' | 'FAILED';
  failureReason: DeliveryFailureReason | null;
  orderStatus: OrderStatus;
  balanceCents: number;
  deliveryFeeCents: number;
  /** Declared by the courier or expected by the order (cash when unknown). */
  method: PaymentMethod;
  declared: boolean;
  receivedCents: number | null;
  changeCents: number | null;
}

export interface SettlementPreviewDto {
  courier: { id: string; name: string };
  /** Runs not settled yet; a run with pending stops (still on route) cannot be settled. */
  runs: {
    id: string;
    departedAt: string;
    returnedAt: string | null;
    stops: number;
    pending: number;
  }[];
  stops: SettlementStopDto[];
  earnings: {
    perDeliveryCents: number;
    feeShareCents: number;
    dailyCents: number;
    totalCents: number;
  };
  includesDaily: boolean;
  previousBalanceCents: number;
}

export interface SettlementDto {
  id: string;
  courierName: string;
  settledAt: string;
  settledByName: string | null;
  deliveries: number;
  failedDeliveries: number;
  deliveryFeesCents: number;
  expectedCashCents: number;
  countedCashCents: number;
  cashDifferenceCents: number;
  expectedCardCents: number;
  countedCardCents: number;
  cardDifferenceCents: number;
  otherCents: number;
  perDeliveryCents: number;
  feeShareCents: number;
  dailyCents: number;
  earningsCents: number;
  previousBalanceCents: number;
  payoutCents: number;
  shortageDeductedCents: number;
  newBalanceCents: number;
  courierOwesCents: number;
  notes: string | null;
}

export interface CourierLedgerEntryDto {
  id: string;
  type: 'EARNING' | 'PAYOUT' | 'SHORTAGE';
  amountCents: number;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
  balanceAfterCents: number;
}

export interface DeliveryReportRowDto {
  key: string;
  name: string;
  deliveries: number;
  failures: number;
  avgDeliveryMinutes: number | null;
  avgTotalMinutes: number | null;
  late: number;
}

export interface DeliveryReportDto {
  from: string;
  to: string;
  orders: number;
  productsCents: number;
  deliveryFeesCents: number;
  byArea: DeliveryReportRowDto[];
  byCourier: DeliveryReportRowDto[];
  /** Who owes whom: balance now (restaurant owes) and missing cash in the period (courier owes). */
  balances: { courierId: string; name: string; balanceCents: number; courierOwesCents: number }[];
}
