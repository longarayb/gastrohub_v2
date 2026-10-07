import { z } from 'zod';
import { CUSTOMER_REJECTION_REASONS, isHexColor, isMobilePhone } from '../domain/digital-menu.js';
import { orderItemInputSchema } from '../orders/schemas.js';
import { zAddress, zCents, zPhone } from '../schemas/common.js';

/** Request schemas of the digital menu (docs/DECISOES.md D032–D034). */

const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => v || null);

/** Paid at the door or at the counter in this stage (online payment comes later). */
export const DOOR_PAYMENT_METHODS = [
  'CASH',
  'PIX',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'MEAL_VOUCHER',
] as const;
export type DoorPaymentMethod = (typeof DOOR_PAYMENT_METHODS)[number];

export const publicCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(80),
  phone: zPhone.refine(isMobilePhone, { message: 'Informe um celular com DDD' }),
});

/** Cart preview: server-side totals, coupon and delivery quote (the client never decides). */
export const publicCartSchema = z
  .object({
    type: z.enum(['TAKEOUT', 'DELIVERY']),
    items: z.array(orderItemInputSchema).min(1, 'Seu carrinho está vazio').max(50),
    couponCode: zText(40),
    deliveryAddress: zAddress.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.type === 'DELIVERY' && !c.deliveryAddress) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe o endereço de entrega',
        path: ['deliveryAddress'],
      });
    }
  });
export type PublicCartInput = z.input<typeof publicCartSchema>;
export type PublicCartData = z.output<typeof publicCartSchema>;

export const publicOrderSchema = z
  .object({
    type: z.enum(['TAKEOUT', 'DELIVERY']),
    items: z.array(orderItemInputSchema).min(1, 'Seu carrinho está vazio').max(50),
    couponCode: zText(40),
    deliveryAddress: zAddress.optional(),
    customer: publicCustomerSchema,
    expectedPaymentMethod: z.enum(DOOR_PAYMENT_METHODS, {
      message: 'Escolha a forma de pagamento',
    }),
    changeForCents: zCents.optional().nullable(),
    notes: zText(300),
    /** LGPD: the privacy notice must be accepted (recorded with its version). */
    acceptPrivacy: z.literal(true, { message: 'Aceite o aviso de privacidade para continuar' }),
    marketingOptIn: z.boolean().default(false),
    /** Total the customer saw: a different server total answers 409 with the new values. */
    expectedTotalCents: zCents,
    /** Honeypot: hidden field that people never fill. */
    website: z.string().max(200).optional().default(''),
    /** When the checkout was opened (ms since epoch): bots submit instantly. */
    formStartedAt: z.number().int().nonnegative(),
  })
  .superRefine((o, ctx) => {
    if (o.type === 'DELIVERY' && !o.deliveryAddress) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe o endereço de entrega',
        path: ['deliveryAddress'],
      });
    }
    if (o.changeForCents != null && o.expectedPaymentMethod !== 'CASH') {
      ctx.addIssue({
        code: 'custom',
        message: 'Troco só para pagamento em dinheiro',
        path: ['changeForCents'],
      });
    }
    if (o.changeForCents != null && o.changeForCents < o.expectedTotalCents) {
      ctx.addIssue({
        code: 'custom',
        message: 'O valor para troco é menor que o total',
        path: ['changeForCents'],
      });
    }
  });
export type PublicOrderInput = z.input<typeof publicOrderSchema>;
export type PublicOrderData = z.output<typeof publicOrderSchema>;

// ---- Panel ----

/** Refuse a digital menu order: reason for the customer + internal note (never shown). */
export const rejectOrderSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    reason: z.enum(CUSTOMER_REJECTION_REASONS, { message: 'Escolha o motivo' }),
    reasonText: zText(200),
    internalNote: zText(300),
    blockPhone: z.boolean().default(false),
  })
  .refine((r) => r.reason !== 'OTHER' || !!r.reasonText, {
    message: 'Escreva o motivo que o cliente vai ver',
    path: ['reasonText'],
  });
export type RejectOrderInput = z.input<typeof rejectOrderSchema>;

export const blockedPhoneSchema = z.object({
  phone: zPhone,
  reason: zText(200),
});
export type BlockedPhoneInput = z.input<typeof blockedPhoneSchema>;

export const digitalMenuSettingsSchema = z.object({
  digitalMenuEnabled: z.boolean(),
  autoAcceptDigitalOrders: z.boolean(),
  brandColor: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || isHexColor(v), { message: 'Cor inválida (use #RRGGBB)' }),
  menuDescription: zText(300),
  /** Null = the template (filled with the store data). */
  privacyNotice: zText(4000),
  limitPerPhoneOpen: z.number().int().min(1).max(20),
  limitPerPhoneDay: z.number().int().min(1).max(100),
  limitPerIpHour: z.number().int().min(5).max(1000),
  limitStorePending: z.number().int().min(1).max(200),
});
export type DigitalMenuSettingsInput = z.input<typeof digitalMenuSettingsSchema>;
