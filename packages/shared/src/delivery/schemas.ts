import { z } from 'zod';
import { DELIVERY_FAILURE_REASONS } from '../domain/delivery.js';
import { zPaymentMethod } from '../orders/schemas.js';
import { zAddress, zCents } from '../schemas/common.js';

/** Request schemas of delivery (D029–D031). */

const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => v || null);

// ---- Areas ----

export const deliveryAreaSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome da área').max(60),
    kind: z.enum(['NEIGHBORHOOD', 'RADIUS']).default('NEIGHBORHOOD'),
    /** Neighborhood names and variations. */
    neighborhoods: z
      .array(z.string().trim().min(2).max(80))
      .max(200)
      .default([])
      .transform((list) => [...new Map(list.map((n) => [n.toLowerCase(), n])).values()]),
    city: zText(80),
    radiusMeters: z.number().int().min(100).max(100_000).optional().nullable(),
    feeCents: zCents,
    etaMinutes: z.number().int().min(0).max(300),
    minimumOrderCents: zCents.optional().nullable(),
    freeAboveCents: zCents.optional().nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.kind === 'NEIGHBORHOOD' && a.neighborhoods.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe pelo menos um bairro',
        path: ['neighborhoods'],
      });
    }
    if (a.kind === 'RADIUS' && !a.radiusMeters) {
      ctx.addIssue({ code: 'custom', message: 'Informe o raio', path: ['radiusMeters'] });
    }
  });
export type DeliveryAreaInput = z.input<typeof deliveryAreaSchema>;

export const pauseAreaSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo').max(120),
  /** Optional automatic resume. */
  until: z.coerce.date().optional().nullable(),
});
export type PauseAreaInput = z.input<typeof pauseAreaSchema>;

export const addNeighborhoodSchema = z.object({
  name: z.string().trim().min(2, 'Informe o bairro').max(80),
});

export const deliveryQuoteSchema = z.object({
  address: zAddress,
  subtotalCents: zCents,
  /** Saved address of the customer (its coordinates are reused or stored). */
  customerAddressId: z.string().optional(),
});
export type DeliveryQuoteInput = z.input<typeof deliveryQuoteSchema>;

// ---- Dispatch, courier app ----

export const dispatchSchema = z.object({
  courierId: z.string().min(1, 'Escolha o entregador'),
  orders: z
    .array(z.object({ orderId: z.string().min(1), expectedVersion: z.number().int().min(0) }))
    .min(1, 'Selecione os pedidos')
    .max(20),
});
export type DispatchInput = z.input<typeof dispatchSchema>;

export const collectionSchema = z
  .object({
    method: zPaymentMethod,
    amountCents: zCents,
    /** Cash handed over by the customer (change = received − amount). */
    receivedCents: zCents.optional().nullable(),
    note: zText(200),
  })
  .refine((c) => c.method === 'CASH' || c.receivedCents == null, {
    message: 'Troco só em dinheiro',
    path: ['receivedCents'],
  })
  .refine((c) => c.receivedCents == null || c.receivedCents >= c.amountCents, {
    message: 'O valor recebido é menor que o valor cobrado',
    path: ['receivedCents'],
  });
export type CollectionInput = z.input<typeof collectionSchema>;

/** Courier app "Entregue": how the customer paid (required when the order has a balance). */
export const courierDeliverSchema = z.object({
  collection: collectionSchema.optional().nullable(),
});
export type CourierDeliverInput = z.input<typeof courierDeliverSchema>;

export const deliveryFailureSchema = z
  .object({
    reason: z.enum(DELIVERY_FAILURE_REASONS),
    note: zText(200),
  })
  .refine((f) => f.reason !== 'OTHER' || !!f.note, {
    message: 'Descreva o motivo',
    path: ['note'],
  });
export type DeliveryFailureInput = z.input<typeof deliveryFailureSchema>;

// ---- Couriers, settlement, payouts ----

export const courierPaySchema = z.object({
  perDeliveryCents: zCents,
  /** Share of the delivery fee in basis points (10000 = 100%). */
  feeShareBps: z.number().int().min(0).max(10_000),
  dailyCents: zCents,
});
export type CourierPayInput = z.input<typeof courierPaySchema>;

export const courierUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\D/g, '') : null)),
  isActive: z.boolean().default(true),
  /** User (role Entregador) who signs in to the courier app. */
  userId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  perDeliveryCents: zCents.optional().nullable(),
  feeShareBps: z.number().int().min(0).max(10_000).optional().nullable(),
  dailyCents: zCents.optional().nullable(),
});
export type CourierUpdateInput = z.input<typeof courierUpdateSchema>;

export const settlementSchema = z.object({
  courierId: z.string().min(1),
  runIds: z.array(z.string().min(1)).min(1, 'Selecione as saídas').max(50),
  /** How each delivered stop was paid (declared by the courier, confirmed here). */
  stops: z.array(z.object({ stopId: z.string().min(1), method: zPaymentMethod })).max(200),
  countedCashCents: zCents,
  countedCardCents: zCents,
  /** Pay now (register withdrawal); 0 = accumulate in the courier balance. */
  payNowCents: zCents.default(0),
  /** Deduct missing cash from what the restaurant owes the courier. */
  deductShortage: z.boolean().default(false),
  notes: zText(500),
});
export type SettlementInput = z.input<typeof settlementSchema>;

export const courierPayoutSchema = z.object({
  amountCents: zCents.refine((v) => v > 0, 'Informe o valor'),
  reason: zText(200),
});
export type CourierPayoutInput = z.input<typeof courierPayoutSchema>;

export const deliveryReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
});
