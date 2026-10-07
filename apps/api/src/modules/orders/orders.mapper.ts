import { randomBytes, randomInt } from 'node:crypto';
import {
  type Address,
  type CustomerRejectionReason,
  type DeliveryFailureReason,
  type MenuItemSnapshot,
  customerRejectionMessage,
  mapLinks,
} from '@app/shared';
import type {
  OrderDeliveryDto,
  OrderDetailDto,
  OrderEvent,
  OrderSummaryDto,
  PaymentDto,
  PaymentMethod,
} from '@app/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DbTx } from '../../core/tenancy/db.provider.js';

export const orderSummaryInclude = {
  tableSession: {
    include: {
      tables: { where: { leftAt: null }, include: { table: { select: { name: true } } } },
    },
  },
  courier: { select: { name: true } },
  items: { select: { status: true, quantity: true } },
  // Latest delivery attempt: a failed one is shown on the board until dispatched again.
  stops: {
    orderBy: { dispatchedAt: 'desc' },
    take: 1,
    select: { dispatchedAt: true, failedAt: true, failureReason: true, failureNote: true },
  },
} satisfies Prisma.OrderInclude;

export const orderDetailInclude = {
  ...orderSummaryInclude,
  rounds: { orderBy: { number: 'asc' } },
  items: { orderBy: [{ createdAt: 'asc' }, { sortOrder: 'asc' }], include: { round: true } },
  history: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  delivery: true,
  stops: {
    orderBy: { dispatchedAt: 'desc' },
    include: { run: { select: { courier: { select: { name: true } } } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderSummaryRow = Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>;
export type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toOrderSummary(o: OrderSummaryRow): OrderSummaryDto {
  const address = o.deliveryAddress as Address | null;
  const active = o.items.filter((i) => i.status !== 'CANCELED');
  const last = o.stops[0];
  return {
    id: o.id,
    number: o.number,
    publicCode: o.publicCode,
    businessDate: o.businessDate,
    type: o.type,
    source: o.source,
    status: o.status,
    version: o.version,
    tableNames: o.tableSession?.tables.map((t) => t.table.name) ?? [],
    tableSessionId: o.tableSessionId,
    tabLabel: o.tabLabel,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    neighborhood: address?.neighborhood ?? null,
    courierName: o.courier?.name ?? null,
    deliveryFailure:
      o.status === 'READY' && last?.failedAt && last.failureReason
        ? {
            reason: last.failureReason as DeliveryFailureReason,
            note: last.failureNote,
            at: last.failedAt.toISOString(),
          }
        : null,
    pixReportedAt: iso(o.pixReportedAt),
    itemCount: active.reduce((sum, i) => sum + i.quantity, 0),
    draftItemCount: active.filter((i) => i.status === 'DRAFT').length,
    totalCents: o.totalCents,
    paidCents: o.paidCents,
    paymentStatus: o.paymentStatus,
    expectedPaymentMethod: o.expectedPaymentMethod as PaymentMethod | null,
    notes: o.notes,
    createdAt: o.createdAt.toISOString(),
    acceptedAt: iso(o.acceptedAt),
    readyAt: iso(o.readyAt),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toOrderDetail(o: OrderDetailRow, userNames: Map<string, string>): OrderDetailDto {
  return {
    ...toOrderSummary(o),
    externalId: o.externalId,
    externalDisplayId: o.externalDisplayId,
    customerId: o.customerId,
    customerDocument: o.customerDocument,
    deliveryAddress: o.deliveryAddress as Address | null,
    courierId: o.courierId,
    subtotalCents: o.subtotalCents,
    itemDiscountCents: o.itemDiscountCents,
    orderDiscountType: o.orderDiscountType,
    orderDiscountValue: o.orderDiscountValue,
    orderDiscountReason: o.orderDiscountReason,
    orderDiscountCents: o.orderDiscountCents,
    couponCode: o.couponCode,
    couponDiscountCents: o.couponDiscountCents,
    serviceFeeBps: o.serviceFeeBps,
    serviceFeeWaived: o.serviceFeeWaived,
    serviceFeeWaivedReason: o.serviceFeeWaivedReason,
    serviceFeeCents: o.serviceFeeCents,
    deliveryFeeCents: o.deliveryFeeCents,
    promoSavingsCents: o.promoSavingsCents,
    balanceCents: Math.max(o.totalCents - o.paidCents, 0),
    changeForCents: o.changeForCents,
    estimatedReadyAt: iso(o.estimatedReadyAt),
    dispatchedAt: iso(o.dispatchedAt),
    deliveredAt: iso(o.deliveredAt),
    canceledAt: iso(o.canceledAt),
    cancelReason: o.cancelReason,
    rounds: o.rounds.map((r) => ({ id: r.id, number: r.number, sentAt: iso(r.sentAt) })),
    items: o.items.map((i) => ({
      id: i.id,
      roundId: i.roundId,
      roundNumber: i.round.number,
      productId: i.productId,
      name: i.name,
      sizeName: i.sizeName,
      quantity: i.quantity,
      unitFullPriceCents: i.unitFullPriceCents,
      unitChargedPriceCents: i.unitChargedPriceCents,
      discountCents: i.discountCents,
      discountReason: i.discountReason,
      totalCents: i.totalCents,
      sectorId: i.sectorId,
      status: i.status,
      notes: i.notes,
      snapshot: i.snapshot as unknown as MenuItemSnapshot,
      sentAt: iso(i.sentAt),
      readyAt: iso(i.readyAt),
      canceledAt: iso(i.canceledAt),
      cancelReason: i.cancelReason,
    })),
    history: o.history.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      userName: h.userId ? (userNames.get(h.userId) ?? null) : null,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    })),
    payments: o.payments.map((p) => toPaymentDto(p, userNames)),
    delivery: o.type === 'DELIVERY' ? toOrderDelivery(o) : null,
    rejection: o.customerRejectReason
      ? {
          reason: o.customerRejectReason as CustomerRejectionReason,
          customerMessage: customerRejectionMessage(
            o.customerRejectReason as CustomerRejectionReason,
            o.customerRejectText,
          ),
        }
      : null,
  };
}

function toOrderDelivery(o: OrderDetailRow): OrderDeliveryDto {
  const address = o.deliveryAddress as Address | null;
  const d = o.delivery;
  return {
    areaId: d?.areaId ?? null,
    areaName: d?.areaName ?? null,
    areaSource: d?.areaSource ?? 'NONE',
    etaMinutes: d?.etaMinutes ?? null,
    distanceMeters: d?.distanceMeters ?? null,
    suggestedFeeCents: d?.suggestedFeeCents ?? null,
    feeChangeReason: d?.feeChangeReason ?? null,
    attempts: d?.attempts ?? 0,
    links: address
      ? mapLinks({
          ...address,
          latitude: address.latitude ?? d?.latitude ?? null,
          longitude: address.longitude ?? d?.longitude ?? null,
        })
      : null,
    stops: o.stops.map((st) => ({
      id: st.id,
      runId: st.runId,
      courierName: st.run.courier.name,
      sequence: st.sequence,
      dispatchedAt: st.dispatchedAt.toISOString(),
      deliveredAt: iso(st.deliveredAt),
      failedAt: iso(st.failedAt),
      failureReason: st.failureReason as DeliveryFailureReason | null,
      failureNote: st.failureNote,
      collectedMethod: st.collectedMethod as PaymentMethod | null,
      collectedCents: st.collectedCents,
      receivedCents: st.receivedCents,
      changeCents: st.changeCents,
    })),
  };
}

export function toPaymentDto(
  p: Prisma.PaymentGetPayload<object>,
  userNames: Map<string, string>,
): PaymentDto {
  const name = (id: string | null) => (id ? (userNames.get(id) ?? null) : null);
  return {
    id: p.id,
    method: p.method,
    amountCents: p.amountCents,
    receivedCents: p.receivedCents,
    changeCents: p.changeCents,
    status: p.status,
    cashSessionId: p.cashSessionId,
    cardBrand: p.cardBrand as PaymentDto['cardBrand'],
    authorizationCode: p.authorizationCode,
    externalRef: p.externalRef,
    createdByName: name(p.createdById),
    createdAt: p.createdAt.toISOString(),
    refundedAt: iso(p.refundedAt),
    refundedByName: name(p.refundedById),
    refundReason: p.refundReason,
  };
}

export function toOrderEvent(o: {
  id: string;
  number: number;
  version: number;
  status: OrderEvent['status'];
  type: OrderEvent['type'];
  source: OrderEvent['source'];
}): OrderEvent {
  return {
    id: o.id,
    number: o.number,
    version: o.version,
    status: o.status,
    type: o.type,
    source: o.source,
  };
}

/**
 * Next daily number for (tenant, business date). Atomic: concurrent transactions wait on the
 * row lock; the number is not consumed if the surrounding transaction rolls back.
 */
export async function nextOrderNumber(
  tx: DbTx,
  tenantId: string,
  businessDate: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "OrderSequence" ("tenantId", "businessDate", "lastNumber")
    VALUES (${tenantId}, ${businessDate}, 1)
    ON CONFLICT ("tenantId", "businessDate")
    DO UPDATE SET "lastNumber" = "OrderSequence"."lastNumber" + 1
    RETURNING "lastNumber"`;
  return rows[0]!.lastNumber;
}

// Crockford base32 without ambiguous characters (no I, L, O, U).
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Unguessable token of the public tracking page (128 bits, base64url, D034). */
export function newTrackingToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Short, non-sequential public code (order reference, PIX txid; 8 chars ≈ 40 bits). */
export function newPublicCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
