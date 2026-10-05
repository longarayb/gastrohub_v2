import type { MenuItemSnapshot } from '../domain/menu-pricing.js';
import type {
  OrderItemStatus,
  OrderSource,
  OrderStatus,
  OrderType,
} from '../domain/order-status.js';
import type { Address } from '../schemas/common.js';
import type { PaymentMethod } from './schemas.js';

/** Response DTOs of the orders API. Dates are ISO strings; money in cents. */

export type OrderPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface OrderSummaryDto {
  id: string;
  number: number;
  publicCode: string;
  businessDate: string;
  type: OrderType;
  source: OrderSource;
  status: OrderStatus;
  version: number;
  tableNames: string[];
  tableSessionId: string | null;
  tabLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  neighborhood: string | null;
  courierName: string | null;
  itemCount: number;
  /** Items in a round not yet sent to the kitchen. */
  draftItemCount: number;
  totalCents: number;
  paymentStatus: OrderPaymentStatus;
  expectedPaymentMethod: PaymentMethod | null;
  notes: string | null;
  createdAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  updatedAt: string;
}

export interface OrderItemDto {
  id: string;
  roundId: string;
  roundNumber: number;
  productId: string | null;
  name: string;
  sizeName: string | null;
  quantity: number;
  unitFullPriceCents: number;
  unitChargedPriceCents: number;
  discountCents: number;
  discountReason: string | null;
  totalCents: number;
  sectorId: string | null;
  status: OrderItemStatus;
  notes: string | null;
  snapshot: MenuItemSnapshot;
  sentAt: string | null;
  readyAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface OrderRoundDto {
  id: string;
  number: number;
  sentAt: string | null;
}

export interface OrderHistoryDto {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userName: string | null;
  reason: string | null;
  createdAt: string;
}

export interface OrderDetailDto extends OrderSummaryDto {
  externalId: string | null;
  externalDisplayId: string | null;
  customerId: string | null;
  customerDocument: string | null;
  deliveryAddress: Address | null;
  courierId: string | null;
  subtotalCents: number;
  itemDiscountCents: number;
  orderDiscountType: 'VALUE' | 'PERCENT' | null;
  orderDiscountValue: number | null;
  orderDiscountReason: string | null;
  orderDiscountCents: number;
  couponCode: string | null;
  couponDiscountCents: number;
  serviceFeeBps: number;
  serviceFeeWaived: boolean;
  serviceFeeWaivedReason: string | null;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  promoSavingsCents: number;
  paidCents: number;
  changeForCents: number | null;
  estimatedReadyAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  rounds: OrderRoundDto[];
  items: OrderItemDto[];
  history: OrderHistoryDto[];
}

/** Realtime event payload: a notification, clients refetch what they need. */
export interface OrderEvent {
  id: string;
  number: number;
  version: number;
  status: OrderStatus;
  type: OrderType;
  source: OrderSource;
}

export const REALTIME_EVENTS = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  TABLES_UPDATED: 'tables.updated',
} as const;

export interface AreaDto {
  id: string;
  name: string;
  sortOrder: number;
}

export interface TableDto {
  id: string;
  name: string;
  areaId: string | null;
  areaName: string | null;
  seats: number | null;
  isActive: boolean;
  /** Open session on this table, if any. */
  session: {
    id: string;
    openedAt: string;
    tabs: { orderId: string; number: number; tabLabel: string | null; totalCents: number }[];
  } | null;
}

export interface CustomerAddressDto extends Address {
  id: string;
  label: string | null;
  isDefault: boolean;
}

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  document: string | null;
  email: string | null;
  notes: string | null;
  addresses: CustomerAddressDto[];
  orderCount: number;
  lastOrderAt: string | null;
}

export interface CourierDto {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
}

export interface CouponDto {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minOrderCents: number | null;
  maxDiscountCents: number | null;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}
