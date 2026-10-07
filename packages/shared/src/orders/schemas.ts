import { z } from 'zod';
import {
  ORDER_STATUSES,
  ORDER_TYPES,
  type OrderStatus,
  type OrderType,
} from '../domain/order-status.js';
import { zAddress, zCents, zPhone } from '../schemas/common.js';

/** Request schemas of the orders module (API validation + panel forms). */

const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const zOrderType = z.enum(ORDER_TYPES as [OrderType, ...OrderType[]]);
export const zOrderStatus = z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]);

export { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from './payment-methods.js';
import { PAYMENT_METHODS } from './payment-methods.js';
export const zPaymentMethod = z.enum(PAYMENT_METHODS);

/** VALUE in cents; PERCENT in basis points (1000 = 10%). */
export const zDiscount = z
  .object({
    type: z.enum(['VALUE', 'PERCENT']),
    value: z.number().int().min(0, 'Desconto inválido'),
  })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 10_000, {
    message: 'Desconto acima de 100%',
    path: ['value'],
  });
export type DiscountData = z.output<typeof zDiscount>;

/** Version the client saw (optimistic concurrency). */
const zVersion = z.number({ error: 'Versão do pedido ausente' }).int().min(0);

export const orderItemModifierSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
  quantity: z.number().int().min(1).max(20).default(1),
});

/**
 * One item. Regular products: `productId` (+ `sizeId` for sized products).
 * Pizzas: `pizza` with the category size and 1..N flavors.
 * Prices are never accepted from the client; the API prices from the menu.
 */
export const orderItemInputSchema = z
  .object({
    productId: z.string().optional(),
    sizeId: z.string().optional(),
    pizza: z
      .object({
        categoryId: z.string().min(1),
        sizeId: z.string().min(1),
        flavors: z
          .array(z.object({ productId: z.string().min(1), note: zText(140) }))
          .min(1, 'Escolha pelo menos um sabor')
          .max(8),
      })
      .optional(),
    quantity: z.number().int().min(1, 'Quantidade mínima 1').max(99, 'Quantidade máxima 99'),
    modifiers: z.array(orderItemModifierSchema).max(50).default([]),
    notes: zText(280),
    discount: zDiscount.optional().nullable(),
    discountReason: zText(200),
  })
  .refine((i) => !!i.productId !== !!i.pizza, {
    message: 'Informe o produto ou a pizza',
    path: ['productId'],
  });
export type OrderItemInput = z.input<typeof orderItemInputSchema>;
export type OrderItemData = z.output<typeof orderItemInputSchema>;

export const orderCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente').max(120),
  phone: zPhone,
  document: zText(20),
});

export const createOrderSchema = z
  .object({
    type: zOrderType,
    /** Dine-in: table to open (or join) a session on. */
    tableId: z.string().optional(),
    /** Dine-in: add a new tab to an existing table session. */
    tableSessionId: z.string().optional(),
    tabLabel: zText(60),
    customerId: z.string().optional(),
    customer: orderCustomerSchema.optional(),
    deliveryAddress: zAddress.optional(),
    /** Delivery fee typed by the operator; omitted = the fee of the area (D029). */
    deliveryFeeCents: zCents.optional(),
    /** Area chosen by hand when the address could not be resolved (geocoding failed). */
    deliveryAreaId: z.string().optional(),
    /** Required when the fee is lower than the area fee. */
    deliveryFeeReason: zText(200),
    items: z.array(orderItemInputSchema).max(100).default([]),
    /** Dine-in: send the first round to the kitchen right away (default). */
    sendNow: z.boolean().default(true),
    orderDiscount: zDiscount.optional().nullable(),
    orderDiscountReason: zText(200),
    couponCode: zText(40),
    waiveServiceFee: z.boolean().default(false),
    serviceFeeWaivedReason: zText(200),
    notes: zText(500),
    expectedPaymentMethod: zPaymentMethod.optional().nullable(),
    changeForCents: zCents.optional().nullable(),
  })
  .superRefine((o, ctx) => {
    if (o.type === 'DINE_IN' && !o.tableId && !o.tableSessionId) {
      ctx.addIssue({ code: 'custom', message: 'Selecione a mesa', path: ['tableId'] });
    }
    if (o.type !== 'DINE_IN' && o.items.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Adicione pelo menos um item', path: ['items'] });
    }
    if (o.type === 'DELIVERY') {
      if (!o.customerId && !o.customer) {
        ctx.addIssue({ code: 'custom', message: 'Informe o cliente', path: ['customer'] });
      }
      if (!o.deliveryAddress) {
        ctx.addIssue({
          code: 'custom',
          message: 'Informe o endereço de entrega',
          path: ['deliveryAddress'],
        });
      }
    }
    if (o.waiveServiceFee && !o.serviceFeeWaivedReason) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe o motivo para retirar a taxa de serviço',
        path: ['serviceFeeWaivedReason'],
      });
    }
    if (o.changeForCents != null && o.expectedPaymentMethod !== 'CASH') {
      ctx.addIssue({
        code: 'custom',
        message: 'Troco só para pagamento em dinheiro',
        path: ['changeForCents'],
      });
    }
  });
export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type CreateOrderData = z.output<typeof createOrderSchema>;

/** Adds a round of items to an open tab (dine-in). */
export const addItemsSchema = z.object({
  expectedVersion: zVersion,
  items: z.array(orderItemInputSchema).min(1, 'Adicione pelo menos um item').max(100),
  /** Send this round to the kitchen now (otherwise items stay as draft). */
  send: z.boolean().default(true),
});
export type AddItemsInput = z.input<typeof addItemsSchema>;

export const sendRoundSchema = z.object({ expectedVersion: zVersion });

export const changeStatusSchema = z
  .object({
    expectedVersion: zVersion,
    status: zOrderStatus,
    reason: zText(300),
  })
  .refine((v) => v.status !== 'CANCELED' || !!v.reason, {
    message: 'Informe o motivo do cancelamento',
    path: ['reason'],
  });
export type ChangeStatusInput = z.input<typeof changeStatusSchema>;

export const cancelItemSchema = z.object({
  expectedVersion: zVersion,
  reason: zText(300),
});
export type CancelItemInput = z.input<typeof cancelItemSchema>;

export const orderDiscountSchema = z
  .object({
    expectedVersion: zVersion,
    discount: zDiscount.nullable(),
    reason: zText(200),
  })
  .refine((v) => !v.discount || !!v.reason, {
    message: 'Informe o motivo do desconto',
    path: ['reason'],
  });

export const serviceFeeSchema = z
  .object({
    expectedVersion: zVersion,
    waived: z.boolean(),
    reason: zText(200),
  })
  .refine((v) => !v.waived || !!v.reason, {
    message: 'Informe o motivo para retirar a taxa de serviço',
    path: ['reason'],
  });

export const assignCourierSchema = z.object({
  expectedVersion: zVersion,
  courierId: z.string().nullable(),
});

export const orderListQuerySchema = z.object({
  /** Comma-separated statuses. */
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(zOrderStatus).optional()),
  type: zOrderType.optional(),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Only orders not finished (plus today's finished, for the board). */
  board: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  q: z.string().trim().max(60).optional(),
  tableSessionId: z.string().optional(),
  /** Delivered deliveries with an open balance ("a receber"). */
  receivable: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type OrderListQuery = z.input<typeof orderListQuerySchema>;

// ---- Tables ----
export const areaSchema = z.object({ name: z.string().trim().min(1, 'Informe o nome').max(60) });
export const tableSchema = z.object({
  name: z.string().trim().min(1, 'Informe o número ou nome da mesa').max(30),
  areaId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  seats: z.number().int().min(1).max(100).optional().nullable(),
  isActive: z.boolean().default(true),
});
export type TableInput = z.input<typeof tableSchema>;

// ---- Customers ----
export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: zPhone,
  document: zText(20),
  email: zText(120),
  notes: zText(500),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const customerAddressSchema = zAddress.extend({
  label: zText(40),
  isDefault: z.boolean().default(false),
});

export const courierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: zPhone.optional().or(z.literal('').transform(() => undefined)),
  isActive: z.boolean().default(true),
});

// ---- Coupons ----
export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'Mínimo de 3 caracteres')
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letras, números, hífen ou sublinhado')
      .transform((v) => v.toUpperCase()),
    type: z.enum(['PERCENT', 'FIXED']),
    /** PERCENT: basis points; FIXED: cents. */
    value: z.number().int().min(1, 'Informe o valor do cupom'),
    minOrderCents: zCents.optional().nullable(),
    maxDiscountCents: zCents.optional().nullable(),
    validFrom: z.coerce.date().optional().nullable(),
    validUntil: z.coerce.date().optional().nullable(),
    usageLimit: z.number().int().min(1).optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== 'PERCENT' || c.value <= 10_000, {
    message: 'Percentual acima de 100%',
    path: ['value'],
  });
export type CouponInput = z.input<typeof couponSchema>;
