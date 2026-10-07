import type {
  CartLineChange,
  CustomerRejectionReason,
  StoreOpenState,
  TrackingStep,
} from '../domain/digital-menu.js';
import type { OrderStatus } from '../domain/order-status.js';
import type { BusinessHour } from '../stores/schemas.js';
import type { DoorPaymentMethod } from './schemas.js';

/** Response DTOs of the digital menu (D032–D034). Dates are ISO strings; money in cents. */

/** The restaurant as the public menu shows it (its brand, never ours). */
export interface PublicStoreDto {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  /** "#rrggbb" or null (neutral theme). */
  brandColor: string | null;
  phone: string | null;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null;
  timezone: string;
  hours: BusinessHour[];
  /** Server clock when the page was built (the client recomputes open/closed with it). */
  serverTime: string;
  openState: StoreOpenState;
  /** The restaurant is receiving orders through the menu (can be paused while open). */
  accepting: boolean;
  takeoutEtaMinutes: number;
  /** Delivery offered (the restaurant has delivery areas). */
  delivers: boolean;
  minimumOrderCents: number;
  paymentMethods: DoorPaymentMethod[];
  privacyNotice: string;
  privacyVersion: string;
}

export interface PublicDeliveryQuoteDto {
  ok: boolean;
  /** Why it cannot deliver (out of area, paused area, address not found). */
  message: string | null;
  areaName: string | null;
  feeCents: number;
  etaMinutes: number | null;
  minimumOrderCents: number;
  belowMinimum: boolean;
  freeAboveCents: number | null;
  /** How much is missing for free delivery (null when not applicable). */
  missingForFreeCents: number | null;
}

export interface PublicCartPreviewDto {
  subtotalCents: number;
  discountCents: number;
  couponDiscountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  coupon: { code: string; applied: boolean; message: string | null } | null;
  delivery: PublicDeliveryQuoteDto | null;
  takeoutEtaMinutes: number;
  /** Items that cannot be ordered as they are (ran out, price changed). */
  changes: CartLineChange[];
  /** Ready to order (open, accepting, delivery ok, minimum reached). */
  canOrder: boolean;
  blockingMessage: string | null;
}

export interface PublicOrderCreatedDto {
  number: number;
  trackingToken: string;
}

/** Tracking page: only what the customer needs (no phone, no full address, no courier). */
export interface PublicTrackingDto {
  number: number;
  type: 'TAKEOUT' | 'DELIVERY';
  status: OrderStatus;
  version: number;
  createdAt: string;
  steps: TrackingStep[];
  estimatedAt: string | null;
  canceled: { message: string } | null;
  items: { name: string; quantity: number; details: string | null; totalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentMethod: DoorPaymentMethod | null;
  changeForCents: number | null;
  neighborhood: string | null;
  /** PIX at the door: static QR shown only after the restaurant accepts. */
  pix: { brCode: string; amountCents: number; txid: string } | null;
  pixReportedAt: string | null;
  paid: boolean;
  store: { name: string; phone: string | null; slug: string };
}

export interface DigitalMenuSettingsDto {
  slug: string;
  menuUrl: string;
  digitalMenuEnabled: boolean;
  autoAcceptDigitalOrders: boolean;
  brandColor: string | null;
  menuDescription: string | null;
  coverUrl: string | null;
  /** Custom text, or null when using the template below. */
  privacyNotice: string | null;
  privacyTemplate: string;
  limitPerPhoneOpen: number;
  limitPerPhoneDay: number;
  limitPerIpHour: number;
  limitStorePending: number;
}

export interface BlockedPhoneDto {
  id: string;
  phone: string;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Rejection data on the order detail (panel). */
export interface OrderRejectionDto {
  reason: CustomerRejectionReason;
  customerMessage: string;
}
