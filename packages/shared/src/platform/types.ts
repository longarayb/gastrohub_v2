import type {
  BillingInterval,
  BillingLevel,
  ReadOnlyReason,
  SubscriptionStatus,
} from '../domain/billing.js';
import type { PlatformModule, SignupMode, SupportAccessMode } from '../domain/platform.js';
import type { Role } from '../auth/permissions.js';
import type { PlatformPaymentMethod } from './schemas.js';

/** Response DTOs of the platform admin API. Dates are ISO strings; calendar dates "YYYY-MM-DD". */

export interface PlatformAdminDto {
  id: string;
  name: string;
  email: string;
  role: 'SUPERADMIN';
  totpEnabled: boolean;
  recoveryCodesLeft: number;
  lastLoginAt: string | null;
}

/** Step of the admin login: the password is never enough. */
export type PlatformLoginStep =
  { step: 'TOTP'; challenge: string } | { step: 'ENROLL'; challenge: string };

export interface PlatformEnrollment {
  /** Base32 secret (to type manually) and the otpauth:// link (QR code). */
  secret: string;
  otpauthUrl: string;
}

export interface PlatformSessionDto {
  accessToken: string;
  expiresIn: number;
  admin: PlatformAdminDto;
  /** Shown once, right after enrolling the authenticator (or regenerating). */
  recoveryCodes?: string[];
}

export interface PlanDto {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: BillingInterval;
  trialDays: number;
  storeLimit: number;
  extraStorePriceCents: number | null;
  modules: PlatformModule[];
  isActive: boolean;
  sortOrder: number;
  subscribers: number;
}

export interface CustomerListItemDto {
  id: string;
  name: string;
  document: string | null;
  status: SubscriptionStatus | null;
  planName: string | null;
  stores: number;
  ownerEmail: string | null;
  /** Amount of the next period (base + extra stores). */
  periodCents: number | null;
  interval: BillingInterval | null;
  nextDueDate: string | null;
  daysOverdue: number;
  trialEndsOn: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerStoreDto {
  id: string;
  tradeName: string;
  slug: string;
  cnpj: string;
  isActive: boolean;
  createdAt: string;
  /** Read-only mode start for this store (it depends on its opening hours). */
  readOnlyFrom: string | null;
  readOnly: boolean;
}

export interface CustomerUserDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  /** Invited and has not set a password yet. */
  invitePending: boolean;
  memberships: { storeId: string; storeName: string; role: Role; isActive: boolean }[];
}

export interface SubscriptionChangeDto {
  kind:
    | 'CREATED'
    | 'PLAN_CHANGED'
    | 'PRICE_CHANGED'
    | 'TRIAL_CHANGED'
    | 'GRACE_CHANGED'
    | 'SUSPENDED'
    | 'REACTIVATED'
    | 'CANCELED';
  fromPlanName: string | null;
  toPlanName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  adminName: string | null;
  createdAt: string;
}

export interface SubscriptionDto {
  id: string;
  version: number;
  status: SubscriptionStatus;
  plan: PlanDto;
  priceCents: number;
  interval: BillingInterval;
  startedAt: string;
  trialEndsOn: string | null;
  billingStart: string;
  graceDays: number | null;
  effectiveGraceDays: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  charge: { baseCents: number; extraStores: number; extraCents: number; totalCents: number };
  monthlyCents: number;
  nextDueDate: string | null;
  oldestUnpaidDueDate: string | null;
  daysOverdue: number;
  graceEndsOn: string | null;
  readOnlyEligibleAt: string | null;
  readOnlyReason: ReadOnlyReason | null;
  changes: SubscriptionChangeDto[];
}

export type InvoiceDisplayStatus = 'OPEN' | 'DUE_SOON' | 'OVERDUE' | 'PAID' | 'CANCELED';

export interface PlatformInvoiceDto {
  id: string;
  version: number;
  organizationId: string;
  customerName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountCents: number;
  details: { baseCents: number; extraStores: number; extraCents: number; planName: string } | null;
  status: 'OPEN' | 'PAID' | 'CANCELED';
  displayStatus: InvoiceDisplayStatus;
  daysOverdue: number;
  paidOn: string | null;
  paymentMethod: PlatformPaymentMethod | null;
  paymentNote: string | null;
  provider: string;
  providerUrl: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface TermsAcceptanceDto {
  termsVersion: string;
  privacyVersion: string;
  userName: string | null;
  ip: string | null;
  acceptedAt: string;
  current: boolean;
}

export interface SupportSessionDto {
  id: string;
  adminName: string | null;
  organizationId: string;
  customerName: string | null;
  storeId: string;
  storeName: string | null;
  reason: string;
  mode: SupportAccessMode;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  active: boolean;
}

export interface CustomerDetailDto {
  id: string;
  name: string;
  isActive: boolean;
  createdVia: 'SIGNUP' | 'ADMIN';
  documentType: 'CNPJ' | 'CPF' | null;
  document: string | null;
  legalName: string | null;
  municipalRegistration: string | null;
  invoiceEmail: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: {
    cep: string;
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null;
  notes: string | null;
  createdAt: string;
  stores: CustomerStoreDto[];
  users: CustomerUserDto[];
  subscription: SubscriptionDto | null;
  invoices: PlatformInvoiceDto[];
  terms: TermsAcceptanceDto | null;
  supportSessions: SupportSessionDto[];
}

export interface PlatformAuditEntryDto {
  seq: string;
  adminName: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  organizationId: string | null;
  customerName: string | null;
  storeId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface PlatformOverviewDto {
  counts: Record<SubscriptionStatus, number> & { total: number; withoutSubscription: number };
  mrrCents: number;
  dueSoon: PlatformInvoiceDto[];
  overdue: PlatformInvoiceDto[];
  /** Customers whose trial ends in the next days. */
  trialsEnding: { id: string; name: string; trialEndsOn: string }[];
  activity: PlatformAuditEntryDto[];
  recentCustomers: {
    id: string;
    name: string;
    createdVia: 'SIGNUP' | 'ADMIN';
    createdAt: string;
  }[];
}

export interface PlatformSettingsDto {
  signupMode: SignupMode;
  signupPlanId: string | null;
  trialDays: number;
  graceDays: number;
  warnDaysBefore: number;
}

// ---- Restaurant side ----

/** Billing banner of the restaurant panel (owner/manager see amounts; everyone sees read-only). */
export interface StoreBillingNoticeDto {
  level: BillingLevel;
  readOnly: boolean;
  readOnlyFrom: string | null;
  readOnlyReason: ReadOnlyReason | null;
  daysToDue: number | null;
  daysOverdue: number;
  dueDate: string | null;
  trialEndsOn: string | null;
  /** Only for owner and manager. */
  amountCents: number | null;
}

export interface StoreNoticesDto {
  billing: StoreBillingNoticeDto | null;
  support: { reason: string; mode: SupportAccessMode; endsAt: string } | null;
  /** The owner must accept the platform terms (new organization or new version). */
  termsRequired: { termsVersion: string; privacyVersion: string } | null;
  /** Plan modules (the panel hides what is not included). Null = no subscription (all). */
  modules: PlatformModule[] | null;
}

/** Signup availability for the public /cadastro page. */
export interface SignupStatusDto {
  mode: SignupMode;
  trialDays: number;
}
