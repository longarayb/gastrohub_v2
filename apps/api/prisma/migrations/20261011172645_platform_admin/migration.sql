-- CreateEnum
CREATE TYPE "OrganizationOrigin" AS ENUM ('SIGNUP', 'ADMIN');

-- CreateEnum
CREATE TYPE "CustomerDocumentType" AS ENUM ('CNPJ', 'CPF');

-- CreateEnum
CREATE TYPE "PasswordTokenPurpose" AS ENUM ('RESET', 'INVITE');

-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('SUPERADMIN');

-- CreateEnum
CREATE TYPE "SignupMode" AS ENUM ('INVITE_ONLY', 'OPEN_TRIAL');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionChangeKind" AS ENUM ('CREATED', 'PLAN_CHANGED', 'PRICE_CHANGED', 'TRIAL_CHANGED', 'GRACE_CHANGED', 'SUSPENDED', 'REACTIVATED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlatformPaymentMethod" AS ENUM ('PIX', 'BOLETO', 'CARD', 'TRANSFER', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportAccessMode" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "supportSessionId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "addressCep" TEXT,
ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressNeighborhood" TEXT,
ADD COLUMN     "addressNumber" TEXT,
ADD COLUMN     "addressState" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "createdVia" "OrganizationOrigin" NOT NULL DEFAULT 'SIGNUP',
ADD COLUMN     "document" TEXT,
ADD COLUMN     "documentType" "CustomerDocumentType",
ADD COLUMN     "invoiceEmail" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "municipalRegistration" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "purpose" "PasswordTokenPurpose" NOT NULL DEFAULT 'RESET';

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PlatformAdminRole" NOT NULL DEFAULT 'SUPERADMIN',
    "totpSecretEnc" TEXT,
    "totpPendingSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastCounter" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRecoveryCode" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "adminId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "organizationId" TEXT,
    "storeId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "signupMode" "SignupMode" NOT NULL DEFAULT 'INVITE_ONLY',
    "signupPlanId" TEXT,
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "warnDaysBefore" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "storeLimit" INTEGER NOT NULL DEFAULT 1,
    "extraStorePriceCents" INTEGER,
    "modules" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsOn" TEXT,
    "billingStart" TEXT NOT NULL,
    "graceDays" INTEGER,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" "SubscriptionChangeKind" NOT NULL,
    "fromPlanId" TEXT,
    "toPlanId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "details" JSONB,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidOn" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PlatformPaymentMethod",
    "paymentNote" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "providerRef" TEXT,
    "providerUrl" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsAcceptance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mode" "SupportAccessMode" NOT NULL DEFAULT 'READ_ONLY',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE INDEX "PlatformRecoveryCode_adminId_idx" ON "PlatformRecoveryCode"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSession_tokenHash_key" ON "PlatformSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformSession_adminId_idx" ON "PlatformSession"("adminId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_organizationId_createdAt_idx" ON "PlatformAuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_action_createdAt_idx" ON "PlatformAuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "SubscriptionChange_subscriptionId_seq_idx" ON "SubscriptionChange"("subscriptionId", "seq");

-- CreateIndex
CREATE INDEX "PlatformInvoice_status_dueDate_idx" ON "PlatformInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PlatformInvoice_organizationId_dueDate_idx" ON "PlatformInvoice"("organizationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_subscriptionId_periodStart_key" ON "PlatformInvoice"("subscriptionId", "periodStart");

-- CreateIndex
CREATE INDEX "TermsAcceptance_organizationId_acceptedAt_idx" ON "TermsAcceptance"("organizationId", "acceptedAt");

-- CreateIndex
CREATE INDEX "SupportSession_storeId_endsAt_idx" ON "SupportSession"("storeId", "endsAt");

-- CreateIndex
CREATE INDEX "SupportSession_adminId_startedAt_idx" ON "SupportSession"("adminId", "startedAt");

-- AddForeignKey
ALTER TABLE "PlatformRecoveryCode" ADD CONSTRAINT "PlatformRecoveryCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions (Prisma cannot express them; not tracked for drift).

-- Platform audit is append-only (D041): no UPDATE or DELETE, whoever runs it.
-- TRUNCATE (test reset, seed) is a different statement and still works.
CREATE FUNCTION platform_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PlatformAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_append_only();

-- Money and limits.
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_values_check"
  CHECK ("priceCents" >= 0 AND "trialDays" >= 0 AND "storeLimit" >= 1
         AND ("extraStorePriceCents" IS NULL OR "extraStorePriceCents" >= 0));
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_values_check"
  CHECK ("priceCents" >= 0 AND ("graceDays" IS NULL OR "graceDays" >= 0));
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_amount_check"
  CHECK ("amountCents" >= 0);
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_paid_check"
  CHECK ("status" <> 'PAID' OR ("paidOn" IS NOT NULL AND "paymentMethod" IS NOT NULL));
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_values_check"
  CHECK ("trialDays" >= 0 AND "graceDays" >= 0 AND "warnDaysBefore" >= 0 AND "id" = 'default');

-- The single settings row.
INSERT INTO "PlatformSettings" ("id", "updatedAt") VALUES ('default', NOW());
