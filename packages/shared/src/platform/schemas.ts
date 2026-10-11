import { z } from 'zod';
import { BILLING_INTERVALS, type BillingInterval } from '../domain/billing.js';
import {
  PLATFORM_MODULES,
  SIGNUP_MODE_LABELS,
  SUPPORT_SESSION_MINUTES,
  type PlatformModule,
  type SignupMode,
} from '../domain/platform.js';
import { zCEP, zCNPJ, zCents, zDocument, zEmail, zPhone, zSlug } from '../schemas/common.js';
import { zPassword } from '../auth/schemas.js';

/** Request schemas of the platform admin (apps/admin) and the related restaurant endpoints. */

const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => v || null);

/** Calendar date "YYYY-MM-DD" (always São Paulo for billing). */
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

const zReason = z.string().trim().min(5, 'Informe o motivo (mínimo de 5 caracteres)').max(300);
const zVersion = z.number({ error: 'Versão ausente' }).int().min(0);

export const zBillingInterval = z.enum(
  BILLING_INTERVALS as [BillingInterval, ...BillingInterval[]],
);
export const zPlatformModule = z.enum(PLATFORM_MODULES as [PlatformModule, ...PlatformModule[]]);
export const zSignupMode = z.enum(Object.keys(SIGNUP_MODE_LABELS) as [SignupMode, ...SignupMode[]]);

export const PLATFORM_PAYMENT_METHODS = [
  'PIX',
  'BOLETO',
  'CARD',
  'TRANSFER',
  'CASH',
  'OTHER',
] as const;
export type PlatformPaymentMethod = (typeof PLATFORM_PAYMENT_METHODS)[number];
export const PLATFORM_PAYMENT_METHOD_LABELS: Record<PlatformPaymentMethod, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CARD: 'Cartão',
  TRANSFER: 'Transferência',
  CASH: 'Dinheiro',
  OTHER: 'Outro',
};

// ---- Admin authentication (password, then TOTP or a recovery code) ----

export const platformLoginSchema = z.object({
  email: zEmail,
  password: z.string().min(1, 'Informe a senha'),
});
export type PlatformLoginInput = z.input<typeof platformLoginSchema>;

const zChallenge = z.string().min(20, 'Sessão de login inválida');
export const zTotpCode = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'O código tem 6 números'));

export const platformTotpSchema = z.object({ challenge: zChallenge, code: zTotpCode });
export const platformRecoverySchema = z.object({
  challenge: zChallenge,
  recoveryCode: z.string().trim().min(10, 'Código de recuperação inválido').max(20),
});
export const platformEnrollStartSchema = z.object({ challenge: zChallenge });

// ---- Customers (organization + stores + owner) ----

const customerAddressSchema = z.object({
  cep: zCEP,
  street: z.string().trim().min(1, 'Informe a rua'),
  number: z.string().trim().min(1, 'Informe o número'),
  complement: z.string().trim().optional().default(''),
  neighborhood: z.string().trim().min(1, 'Informe o bairro'),
  city: z.string().trim().min(1, 'Informe a cidade'),
  state: z.string().trim().length(2, 'UF inválida').toUpperCase(),
});

/** Organization data, including what the service invoice (NFS-e) needs. */
export const customerDataSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente').max(120),
  /** CNPJ or CPF of who pays (digits). */
  document: zDocument,
  legalName: z.string().trim().min(2, 'Informe a razão social ou o nome completo').max(160),
  municipalRegistration: zText(30),
  invoiceEmail: zEmail,
  contactName: z.string().trim().min(2, 'Informe o nome do contato').max(120),
  contactEmail: zEmail.optional().nullable(),
  contactPhone: zPhone,
  address: customerAddressSchema,
  notes: zText(1000),
});
export type CustomerDataInput = z.input<typeof customerDataSchema>;

export const createCustomerSchema = z.object({
  customer: customerDataSchema,
  store: z.object({
    tradeName: z.string().trim().min(2, 'Informe o nome fantasia').max(120),
    cnpj: zCNPJ,
    phone: zPhone,
    slug: zSlug.optional(),
  }),
  owner: z.object({
    name: z.string().trim().min(2, 'Informe o nome do dono').max(120),
    email: zEmail,
    phone: zPhone.optional(),
  }),
  subscription: z.object({
    planId: z.string().min(1, 'Escolha o plano'),
    /** Agreed price per period; empty = the plan price. */
    priceCents: zCents.optional().nullable(),
    /** Trial days; empty = the plan's trial. */
    trialDays: z.number().int().min(0).max(365).optional().nullable(),
    /** First day of the subscription (default: today in São Paulo). */
    startDate: zDate.optional().nullable(),
  }),
});
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;

export const customerActiveSchema = z.object({ active: z.boolean(), reason: zReason });

// ---- Plans ----

export const planSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome do plano').max(60),
    description: zText(300),
    priceCents: zCents,
    interval: zBillingInterval,
    trialDays: z.number().int().min(0).max(365).default(0),
    storeLimit: z.number().int().min(1, 'Mínimo de 1 unidade').max(500),
    extraStorePriceCents: zCents.optional().nullable(),
    modules: z.array(zPlatformModule).default([]),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).default(0),
  })
  .transform((p) => ({ ...p, modules: [...new Set(p.modules)] }));
export type PlanInput = z.input<typeof planSchema>;

// ---- Subscription changes (each one recorded in the history with the reason) ----

export const changePlanSchema = z.object({
  expectedVersion: zVersion,
  planId: z.string().min(1, 'Escolha o plano'),
  /** Empty = the new plan's price. */
  priceCents: zCents.optional().nullable(),
  reason: zReason,
});

export const changePriceSchema = z.object({
  expectedVersion: zVersion,
  priceCents: zCents,
  reason: zReason,
});

export const changeTrialSchema = z.object({
  expectedVersion: zVersion,
  /** New trial end (first due date); null ends the trial today. */
  trialEndsOn: zDate.nullable(),
  reason: zReason,
});

export const changeGraceSchema = z.object({
  expectedVersion: zVersion,
  /** Null = platform default. */
  graceDays: z.number().int().min(0).max(60).nullable(),
  reason: zReason,
});

export const subscriptionReasonSchema = z.object({ expectedVersion: zVersion, reason: zReason });

// ---- Invoices (manual control) ----

export const generateInvoicesSchema = z.object({
  /** Only one customer; empty = everyone. */
  organizationId: z.string().optional().nullable(),
});

export const markInvoicePaidSchema = z.object({
  expectedVersion: zVersion,
  paidOn: zDate,
  paymentMethod: z.enum(PLATFORM_PAYMENT_METHODS),
  note: zText(300),
});

export const cancelInvoiceSchema = z.object({ expectedVersion: zVersion, reason: zReason });

export const invoiceListQuerySchema = z.object({
  status: z.enum(['OPEN', 'OVERDUE', 'PAID', 'CANCELED', 'DUE_SOON']).optional(),
  organizationId: z.string().optional(),
});

// ---- Settings ----

export const platformSettingsSchema = z.object({
  signupMode: zSignupMode,
  signupPlanId: z.string().optional().nullable(),
  trialDays: z.number().int().min(0).max(90),
  graceDays: z.number().int().min(0).max(60),
  warnDaysBefore: z.number().int().min(0).max(30),
});
export type PlatformSettingsInput = z.input<typeof platformSettingsSchema>;

// ---- Support sessions ----

export const startSupportSchema = z
  .object({
    storeId: z.string().min(1, 'Escolha a unidade'),
    reason: z
      .string()
      .trim()
      .min(10, 'Descreva o motivo do acesso (mínimo de 10 caracteres)')
      .max(300),
    minutes: z
      .number()
      .int()
      .min(SUPPORT_SESSION_MINUTES.min)
      .max(SUPPORT_SESSION_MINUTES.max)
      .default(SUPPORT_SESSION_MINUTES.default),
    mode: z.enum(['READ_ONLY', 'READ_WRITE']).default('READ_ONLY'),
    /** READ_WRITE must be confirmed explicitly. */
    confirmWrite: z.boolean().optional(),
  })
  .refine((s) => s.mode === 'READ_ONLY' || s.confirmWrite === true, {
    message: 'Confirme o acesso com alterações',
    path: ['confirmWrite'],
  });
export type StartSupportInput = z.input<typeof startSupportSchema>;

// ---- Restaurant side ----

export const acceptTermsSchema = z.object({
  termsVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
});

/** First password of an invited user (same token flow as the password reset). */
export const acceptInviteSchema = z.object({
  token: z.string().min(20, 'Convite inválido'),
  password: zPassword,
});

export const platformAdminPasswordSchema = z.object({ password: zPassword });
