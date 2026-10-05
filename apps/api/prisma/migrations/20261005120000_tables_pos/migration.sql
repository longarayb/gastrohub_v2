-- CreateEnum
CREATE TYPE "PixKeyType" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('SUPPLY', 'WITHDRAWAL');

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'REFUNDED');
ALTER TABLE "public"."Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "public"."PaymentStatus_old";
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';
COMMIT;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "cancelReason",
DROP COLUMN "canceledAt",
DROP COLUMN "canceledById",
ADD COLUMN     "authorizationCode" TEXT,
ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundSessionId" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedById" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "blindCashClose" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" "PixKeyType",
ADD COLUMN     "pixMerchantCity" TEXT,
ADD COLUMN     "pixMerchantName" TEXT;

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "billRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "businessDate" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openOperatorId" TEXT,
    "openingCents" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closingNotes" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "sessionId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSessionCount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "sessionId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "expectedCents" INTEGER NOT NULL,
    "countedCents" INTEGER NOT NULL,
    "differenceCents" INTEGER NOT NULL,

    CONSTRAINT "CashSessionCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashSession_tenantId_status_idx" ON "CashSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CashSession_tenantId_businessDate_idx" ON "CashSession"("tenantId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_tenantId_openOperatorId_key" ON "CashSession"("tenantId", "openOperatorId");

-- CreateIndex
CREATE INDEX "CashMovement_tenantId_sessionId_idx" ON "CashMovement"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "CashSessionCount_tenantId_sessionId_idx" ON "CashSessionCount"("tenantId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSessionCount_sessionId_method_key" ON "CashSessionCount"("sessionId", "method");

-- CreateIndex
CREATE INDEX "Payment_tenantId_cashSessionId_idx" ON "Payment"("tenantId", "cashSessionId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_refundSessionId_idx" ON "Payment"("tenantId", "refundSessionId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundSessionId_fkey" FOREIGN KEY ("refundSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSessionCount" ADD CONSTRAINT "CashSessionCount_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Values (Prisma does not express CHECK constraints; they are not tracked for drift).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cash_check" CHECK (
  ("receivedCents" IS NULL OR "receivedCents" >= "amountCents")
  AND ("changeCents" IS NULL OR "changeCents" >= 0)
);
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_values_check" CHECK (
  "openingCents" >= 0 AND "version" >= 0
  -- openOperatorId is the operator while open and null once closed (one open per operator).
  AND (("status" = 'OPEN' AND "openOperatorId" = "operatorId")
    OR ("status" = 'CLOSED' AND "openOperatorId" IS NULL))
);
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_values_check" CHECK ("amountCents" > 0);
ALTER TABLE "CashSessionCount" ADD CONSTRAINT "CashSessionCount_values_check" CHECK (
  "countedCents" >= 0 AND "differenceCents" = "countedCents" - "expectedCents"
);
