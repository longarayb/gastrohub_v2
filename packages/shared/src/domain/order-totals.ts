/**
 * Order totals. Pure, integer cents only.
 *
 * Calculation order (approved in docs/DECISOES.md D019):
 *  1. line gross = unit charged price (promo already applied) × quantity
 *  2. item discount (value, or % of the line gross) → line total (≥ 0)
 *  3. subtotal = Σ line totals (canceled lines excluded)
 *  4. order discount (value, or % of the subtotal), capped at the subtotal
 *  5. coupon (fixed, or % of what is left), capped at what is left; minimum order checked on
 *     the subtotal
 *  6. items net = subtotal − order discount − coupon (≥ 0)
 *  7. service fee = % of items net (never on the delivery fee or on itself)
 *  8. total = items net + service fee + delivery fee
 *
 * Rounding: each percentage is converted to cents where it is applied, rounding half up
 * (`applyBasisPoints`); everything after that adds whole cents, so no fractions accumulate.
 */

import { applyBasisPoints } from '../utils/money.js';
import type { OrderType } from './order-status.js';

export const DiscountType = { VALUE: 'VALUE', PERCENT: 'PERCENT' } as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

/** VALUE = cents; PERCENT = basis points (1000 = 10%). */
export interface DiscountInput {
  type: DiscountType;
  value: number;
}

export interface CouponRule {
  type: 'PERCENT' | 'FIXED';
  /** PERCENT: basis points; FIXED: cents. */
  value: number;
  minOrderCents?: number | null;
  maxDiscountCents?: number | null;
}

export interface OrderLineInput {
  quantity: number;
  unitChargedPriceCents: number;
  /** Price without promotions (for the informative promo savings). */
  unitFullPriceCents?: number;
  discount?: DiscountInput | null;
  canceled?: boolean;
}

export interface OrderTotalsInput {
  lines: readonly OrderLineInput[];
  orderDiscount?: DiscountInput | null;
  coupon?: CouponRule | null;
  /** Service fee in basis points (0 when it does not apply or was removed). */
  serviceFeeBps?: number;
  deliveryFeeCents?: number;
}

export interface LineTotals {
  grossCents: number;
  discountCents: number;
  totalCents: number;
}

export interface OrderTotals {
  lines: LineTotals[];
  itemsGrossCents: number;
  itemDiscountCents: number;
  subtotalCents: number;
  orderDiscountCents: number;
  couponDiscountCents: number;
  /** Why the coupon gave no discount (minimum not reached), when applicable. */
  couponMessage: string | null;
  itemsNetCents: number;
  serviceFeeBps: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  /** Informative: how much promotions saved (full price − charged price). */
  promoSavingsCents: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} inválido`);
}

/** Discount in cents over `base`, never above it. */
export function discountAmount(base: number, discount: DiscountInput | null | undefined): number {
  if (!discount || base <= 0) return 0;
  assertNonNegativeInt(discount.value, 'Desconto');
  if (discount.type === 'PERCENT') {
    if (discount.value > 10_000) throw new RangeError('Desconto acima de 100%');
    return clamp(applyBasisPoints(base, discount.value), 0, base);
  }
  return clamp(discount.value, 0, base);
}

export function calculateLine(line: OrderLineInput): LineTotals {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new RangeError('Quantidade inválida');
  }
  assertNonNegativeInt(line.unitChargedPriceCents, 'Preço');
  const grossCents = line.unitChargedPriceCents * line.quantity;
  const discountCents = discountAmount(grossCents, line.discount);
  return { grossCents, discountCents, totalCents: grossCents - discountCents };
}

function couponAmount(
  coupon: CouponRule | null | undefined,
  subtotal: number,
  remaining: number,
): { cents: number; message: string | null } {
  if (!coupon) return { cents: 0, message: null };
  assertNonNegativeInt(coupon.value, 'Cupom');
  if (coupon.minOrderCents != null && subtotal < coupon.minOrderCents) {
    return { cents: 0, message: 'Pedido abaixo do valor mínimo do cupom' };
  }
  let cents =
    coupon.type === 'PERCENT'
      ? applyBasisPoints(remaining, Math.min(coupon.value, 10_000))
      : coupon.value;
  if (coupon.maxDiscountCents != null) cents = Math.min(cents, coupon.maxDiscountCents);
  return { cents: clamp(cents, 0, remaining), message: null };
}

export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  const deliveryFeeCents = input.deliveryFeeCents ?? 0;
  const serviceFeeBps = input.serviceFeeBps ?? 0;
  assertNonNegativeInt(deliveryFeeCents, 'Taxa de entrega');
  assertNonNegativeInt(serviceFeeBps, 'Taxa de serviço');

  const active = input.lines.filter((l) => !l.canceled);
  const lines = input.lines.map((l) =>
    l.canceled ? { grossCents: 0, discountCents: 0, totalCents: 0 } : calculateLine(l),
  );

  const itemsGrossCents = lines.reduce((sum, l) => sum + l.grossCents, 0);
  const itemDiscountCents = lines.reduce((sum, l) => sum + l.discountCents, 0);
  const subtotalCents = itemsGrossCents - itemDiscountCents;

  const orderDiscountCents = discountAmount(subtotalCents, input.orderDiscount);
  const afterOrderDiscount = subtotalCents - orderDiscountCents;
  const coupon = couponAmount(input.coupon, subtotalCents, afterOrderDiscount);
  const itemsNetCents = afterOrderDiscount - coupon.cents;

  const serviceFeeCents = applyBasisPoints(itemsNetCents, serviceFeeBps);
  const promoSavingsCents = active.reduce(
    (sum, l) =>
      sum +
      Math.max(
        0,
        ((l.unitFullPriceCents ?? l.unitChargedPriceCents) - l.unitChargedPriceCents) * l.quantity,
      ),
    0,
  );

  return {
    lines,
    itemsGrossCents,
    itemDiscountCents,
    subtotalCents,
    orderDiscountCents,
    couponDiscountCents: coupon.cents,
    couponMessage: coupon.message,
    itemsNetCents,
    serviceFeeBps,
    serviceFeeCents,
    deliveryFeeCents,
    totalCents: itemsNetCents + serviceFeeCents + deliveryFeeCents,
    promoSavingsCents,
  };
}

// ---------------------------------------------------------------------------
// Fees per order type

export interface ServiceFeeConfig {
  /** Basis points (1000 = 10%). */
  serviceFeeBps: number;
  /** Order types the fee applies to by default (store setting; default: dine-in only). */
  serviceFeeOrderTypes: readonly OrderType[];
}

/** Service fee for a new order: the store percentage when the type is configured, else 0. */
export function defaultServiceFeeBps(type: OrderType, config: ServiceFeeConfig): number {
  return config.serviceFeeOrderTypes.includes(type) ? config.serviceFeeBps : 0;
}

/** Effective service fee of an order: removed (waived) on customer request → 0. */
export function effectiveServiceFeeBps(orderBps: number, waived: boolean): number {
  return waived ? 0 : orderBps;
}

/** Delivery fee only exists on delivery orders. */
export function effectiveDeliveryFeeCents(type: OrderType, deliveryFeeCents: number): number {
  return type === 'DELIVERY' ? deliveryFeeCents : 0;
}
