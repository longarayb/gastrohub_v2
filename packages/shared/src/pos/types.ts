import type { CashCountLine, CashMovementType, CashSessionStatus } from '../domain/cash-session.js';
import type { CardBrand, PaymentStatus } from '../domain/payments.js';
import type { PixKeyType } from '../domain/pix.js';
import type { OrderSummaryDto } from '../orders/types.js';
import type { PaymentMethod } from '../orders/schemas.js';

/** Response DTOs of the cash register and payments API. Dates are ISO strings; money in cents. */

export interface PaymentDto {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  receivedCents: number | null;
  changeCents: number | null;
  status: PaymentStatus;
  cashSessionId: string | null;
  cardBrand: CardBrand | null;
  authorizationCode: string | null;
  externalRef: string | null;
  createdByName: string | null;
  createdAt: string;
  refundedAt: string | null;
  refundedByName: string | null;
  refundReason: string | null;
}

export interface CashMethodTotalsDto {
  method: PaymentMethod;
  receivedCents: number;
  refundedCents: number;
  expectedCents: number;
}

export interface CashTotalsDto {
  suppliesCents: number;
  withdrawalsCents: number;
  expectedCashCents: number;
  expectedCents: number;
  methods: CashMethodTotalsDto[];
}

export interface CashSessionDto {
  id: string;
  businessDate: string;
  status: CashSessionStatus;
  operatorId: string;
  operatorName: string;
  openingCents: number;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  closingNotes: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  version: number;
  paymentCount: number;
  /**
   * Live totals. Null while the register is open in blind-close mode for operators without
   * `cash:manage` (they count without seeing what the system expects).
   */
  totals: CashTotalsDto | null;
  /** Closing count (closed registers only). */
  counts: CashCountLine[];
  differenceCents: number | null;
}

export interface CashMovementDto {
  id: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  createdByName: string | null;
  createdAt: string;
}

/** A payment received or refunded in a register (closing report). */
export interface CashPaymentRowDto {
  id: string;
  orderId: string;
  orderNumber: number;
  businessDate: string;
  method: PaymentMethod;
  amountCents: number;
  changeCents: number | null;
  status: PaymentStatus;
  /** received = entered this register; refunded = the refund left this register. */
  kind: 'received' | 'refunded';
  at: string;
}

export interface CashSessionDetailDto extends CashSessionDto {
  movements: CashMovementDto[];
  payments: CashPaymentRowDto[];
}

/** The current user's register and whether the store uses blind closing. */
export interface CurrentCashDto {
  session: CashSessionDetailDto | null;
  blindClose: boolean;
}

export interface PixChargeDto {
  brCode: string;
  amountCents: number;
  txid: string;
  keyType: PixKeyType;
  key: string;
  merchantName: string;
  merchantCity: string;
}

export interface PixSettingsDto {
  pixKeyType: PixKeyType | null;
  pixKey: string | null;
  pixMerchantName: string | null;
  pixMerchantCity: string | null;
}

/** Delivery order delivered with an open balance (the courier still has to settle). */
export interface ReceivableDto extends OrderSummaryDto {
  balanceCents: number;
}
