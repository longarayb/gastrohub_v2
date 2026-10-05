import { z } from 'zod';
import { CARD_BRANDS } from '../domain/payments.js';
import {
  PIX_KEY_TYPES,
  PIX_MERCHANT_CITY_MAX,
  PIX_MERCHANT_NAME_MAX,
  normalizePixKey,
} from '../domain/pix.js';
import { zPaymentMethod } from '../orders/schemas.js';
import { zCents } from '../schemas/common.js';

/** Request schemas of the cash register, payments, bill split and table operations. */

const zVersion = z.number({ error: 'Versão ausente' }).int().min(0);
const zReason = (message: string) =>
  z.string({ error: message }).trim().min(3, message).max(300, 'Máximo de 300 caracteres');
const zOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => v || null);

// ---- Cash register ----

export const openCashSessionSchema = z.object({
  /** Opening float (troco inicial). */
  openingCents: zCents,
});
export type OpenCashSessionInput = z.input<typeof openCashSessionSchema>;

export const cashMovementSchema = z.object({
  type: z.enum(['SUPPLY', 'WITHDRAWAL']),
  amountCents: zCents.refine((v) => v > 0, 'Informe o valor'),
  reason: zReason('Informe o motivo'),
});
export type CashMovementInput = z.input<typeof cashMovementSchema>;

export const closeCashSessionSchema = z.object({
  expectedVersion: zVersion,
  /** Counted amount per method (methods not informed count as zero). */
  counts: z
    .array(z.object({ method: zPaymentMethod, countedCents: zCents }))
    .max(10)
    .refine((list) => new Set(list.map((c) => c.method)).size === list.length, {
      message: 'Forma de pagamento repetida',
    }),
  notes: zOptionalText(500),
});
export type CloseCashSessionInput = z.input<typeof closeCashSessionSchema>;

export const reopenCashSessionSchema = z.object({
  expectedVersion: zVersion,
  reason: zReason('Informe o motivo da reabertura'),
});
export type ReopenCashSessionInput = z.input<typeof reopenCashSessionSchema>;

export const cashSessionListQuerySchema = z.object({
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

// ---- Payments ----

export const createPaymentSchema = z
  .object({
    /** Order version the operator saw. */
    expectedVersion: zVersion,
    method: zPaymentMethod,
    amountCents: zCents.refine((v) => v > 0, 'Informe o valor'),
    /** Cash handed over (cash only); the change is computed by the API. */
    receivedCents: zCents.optional().nullable(),
    cardBrand: z.enum(CARD_BRANDS).optional().nullable(),
    authorizationCode: z
      .string()
      .trim()
      .max(30, 'Máximo de 30 caracteres')
      .regex(/^[A-Za-z0-9-]*$/, 'Use letras, números ou hífen')
      .optional()
      .nullable()
      .transform((v) => v || null),
    /** Marketplace/online payment id. */
    externalRef: zOptionalText(100),
  })
  .superRefine((p, ctx) => {
    const card =
      p.method === 'CREDIT_CARD' || p.method === 'DEBIT_CARD' || p.method === 'MEAL_VOUCHER';
    if (!card && (p.cardBrand || p.authorizationCode)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Bandeira e autorização só em pagamentos com cartão',
        path: ['cardBrand'],
      });
    }
    if (p.method !== 'CASH' && p.receivedCents != null && p.receivedCents !== p.amountCents) {
      ctx.addIssue({
        code: 'custom',
        message: 'Troco só em pagamentos em dinheiro',
        path: ['receivedCents'],
      });
    }
  });
export type CreatePaymentInput = z.input<typeof createPaymentSchema>;

export const refundPaymentSchema = z.object({
  expectedVersion: zVersion,
  reason: zReason('Informe o motivo do estorno'),
});
export type RefundPaymentInput = z.input<typeof refundPaymentSchema>;

export const pixChargeQuerySchema = z.object({
  /** Amount of this PIX (defaults to the balance), e.g. one share of an even split. */
  amountCents: z.coerce.number().int().positive().optional(),
});

// ---- Moving items and tabs ----

export const moveItemsSchema = z
  .object({
    expectedVersion: zVersion,
    items: z
      .array(z.object({ itemId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
      .min(1, 'Selecione os itens')
      .max(100),
    /** Existing tab of the same table session... */
    targetOrderId: z.string().optional(),
    targetExpectedVersion: zVersion.optional(),
    /** ...or a new tab on the same table session. */
    newTabLabel: zOptionalText(60),
  })
  .superRefine((v, ctx) => {
    // Moving to an existing tab needs the version the operator saw of it too.
    if (v.targetOrderId && v.targetExpectedVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Versão da conta de destino ausente',
        path: ['targetExpectedVersion'],
      });
    }
  });
export type MoveItemsInput = z.input<typeof moveItemsSchema>;

export const transferOrderSchema = z.object({
  expectedVersion: zVersion,
  /** Destination table (joins its open session or opens a new one). */
  tableId: z.string().min(1, 'Selecione a mesa'),
});
export type TransferOrderInput = z.input<typeof transferOrderSchema>;

export const changeTableSchema = z.object({
  fromTableId: z.string().min(1),
  toTableId: z.string().min(1, 'Selecione a mesa'),
});
export type ChangeTableInput = z.input<typeof changeTableSchema>;

export const mergeSessionsSchema = z.object({
  /** Session whose tables and tabs move into this one (it is closed). */
  sourceSessionId: z.string().min(1, 'Selecione a mesa'),
});
export type MergeSessionsInput = z.input<typeof mergeSessionsSchema>;

export const splitSessionSchema = z.object({
  /** Table that leaves the session. */
  tableId: z.string().min(1, 'Selecione a mesa'),
  /** Tabs that go with it (a new session); the others stay. */
  orderIds: z.array(z.string().min(1)).max(50).default([]),
});
export type SplitSessionInput = z.input<typeof splitSessionSchema>;

// ---- Store PIX key ----

export const pixSettingsSchema = z
  .object({
    pixKeyType: z.enum(PIX_KEY_TYPES).nullable(),
    pixKey: zOptionalText(77),
    pixMerchantName: zOptionalText(60),
    pixMerchantCity: zOptionalText(60),
  })
  .transform((v, ctx) => {
    if (!v.pixKeyType) {
      return { pixKeyType: null, pixKey: null, pixMerchantName: null, pixMerchantCity: null };
    }
    const key = normalizePixKey(v.pixKeyType, v.pixKey ?? '');
    if (!key) {
      ctx.addIssue({ code: 'custom', message: 'Chave PIX inválida para o tipo', path: ['pixKey'] });
      return z.NEVER;
    }
    if (!v.pixMerchantName) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe o nome do recebedor',
        path: ['pixMerchantName'],
      });
      return z.NEVER;
    }
    if (!v.pixMerchantCity) {
      ctx.addIssue({ code: 'custom', message: 'Informe a cidade', path: ['pixMerchantCity'] });
      return z.NEVER;
    }
    return {
      pixKeyType: v.pixKeyType,
      pixKey: key,
      pixMerchantName: v.pixMerchantName.slice(0, PIX_MERCHANT_NAME_MAX),
      pixMerchantCity: v.pixMerchantCity.slice(0, PIX_MERCHANT_CITY_MAX),
    };
  });
export type PixSettingsInput = z.input<typeof pixSettingsSchema>;
