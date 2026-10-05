-- CreateEnum
CREATE TYPE "DeliveryAreaKind" AS ENUM ('NEIGHBORHOOD', 'RADIUS');

-- CreateEnum
CREATE TYPE "DeliveryAreaSource" AS ENUM ('AUTO', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "DeliveryRunStatus" AS ENUM ('OUT', 'RETURNED', 'SETTLED');

-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('CUSTOMER_ABSENT', 'ADDRESS_NOT_FOUND', 'REFUSED', 'OTHER');

-- CreateEnum
CREATE TYPE "CourierLedgerType" AS ENUM ('EARNING', 'PAYOUT', 'SHORTAGE');

-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "dailyCents" INTEGER,
ADD COLUMN     "feeShareBps" INTEGER,
ADD COLUMN     "perDeliveryCents" INTEGER;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "courierDailyCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "courierFeeShareBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "courierPerDeliveryCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeliveryArea" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "kind" "DeliveryAreaKind" NOT NULL,
    "neighborhoods" TEXT[],
    "city" TEXT,
    "radiusMeters" INTEGER,
    "feeCents" INTEGER NOT NULL,
    "etaMinutes" INTEGER NOT NULL,
    "minimumOrderCents" INTEGER,
    "freeAboveCents" INTEGER,
    "pausedReason" TEXT,
    "pausedUntil" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "areaId" TEXT,
    "areaName" TEXT,
    "areaSource" "DeliveryAreaSource" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "etaMinutes" INTEGER,
    "suggestedFeeCents" INTEGER,
    "feeChangeReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "courierId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "status" "DeliveryRunStatus" NOT NULL DEFAULT 'OUT',
    "openCourierId" TEXT,
    "departedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "createdById" TEXT,

    CONSTRAINT "DeliveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryStop" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "runId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" "DeliveryFailureReason",
    "failureNote" TEXT,
    "collectedMethod" "PaymentMethod",
    "collectedCents" INTEGER,
    "receivedCents" INTEGER,
    "changeCents" INTEGER,
    "collectedNote" TEXT,

    CONSTRAINT "DeliveryStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "courierId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "settledById" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveries" INTEGER NOT NULL,
    "failedDeliveries" INTEGER NOT NULL,
    "deliveryFeesCents" INTEGER NOT NULL,
    "expectedCashCents" INTEGER NOT NULL,
    "countedCashCents" INTEGER NOT NULL,
    "cashDifferenceCents" INTEGER NOT NULL,
    "expectedCardCents" INTEGER NOT NULL,
    "countedCardCents" INTEGER NOT NULL,
    "cardDifferenceCents" INTEGER NOT NULL,
    "otherCents" INTEGER NOT NULL,
    "perDeliveryCents" INTEGER NOT NULL,
    "feeShareCents" INTEGER NOT NULL,
    "dailyCents" INTEGER NOT NULL,
    "earningsCents" INTEGER NOT NULL,
    "previousBalanceCents" INTEGER NOT NULL,
    "payoutCents" INTEGER NOT NULL,
    "shortageDeductedCents" INTEGER NOT NULL,
    "newBalanceCents" INTEGER NOT NULL,
    "courierOwesCents" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "CourierSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "courierId" TEXT NOT NULL,
    "type" "CourierLedgerType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "settlementId" TEXT,
    "cashSessionId" TEXT,
    "cashMovementId" TEXT,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryArea_tenantId_sortOrder_idx" ON "DeliveryArea"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDelivery_orderId_key" ON "OrderDelivery"("orderId");

-- CreateIndex
CREATE INDEX "OrderDelivery_tenantId_areaId_idx" ON "OrderDelivery"("tenantId", "areaId");

-- CreateIndex
CREATE INDEX "DeliveryRun_tenantId_courierId_status_idx" ON "DeliveryRun"("tenantId", "courierId", "status");

-- CreateIndex
CREATE INDEX "DeliveryRun_tenantId_businessDate_idx" ON "DeliveryRun"("tenantId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRun_tenantId_openCourierId_key" ON "DeliveryRun"("tenantId", "openCourierId");

-- CreateIndex
CREATE INDEX "DeliveryStop_tenantId_orderId_idx" ON "DeliveryStop"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "DeliveryStop_runId_idx" ON "DeliveryStop"("runId");

-- CreateIndex
CREATE INDEX "CourierSettlement_tenantId_courierId_settledAt_idx" ON "CourierSettlement"("tenantId", "courierId", "settledAt");

-- CreateIndex
CREATE INDEX "CourierSettlement_tenantId_businessDate_idx" ON "CourierSettlement"("tenantId", "businessDate");

-- CreateIndex
CREATE INDEX "CourierLedgerEntry_tenantId_courierId_createdAt_idx" ON "CourierLedgerEntry"("tenantId", "courierId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderDelivery" ADD CONSTRAINT "OrderDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDelivery" ADD CONSTRAINT "OrderDelivery_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "DeliveryArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CourierSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlement" ADD CONSTRAINT "CourierSettlement_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierLedgerEntry" ADD CONSTRAINT "CourierLedgerEntry_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Values (Prisma does not express CHECK constraints; they are not tracked for drift).
ALTER TABLE "DeliveryArea" ADD CONSTRAINT "DeliveryArea_values_check" CHECK (
  "feeCents" >= 0 AND "etaMinutes" >= 0
  AND ("minimumOrderCents" IS NULL OR "minimumOrderCents" >= 0)
  AND ("freeAboveCents" IS NULL OR "freeAboveCents" >= 0)
  AND ("kind" = 'NEIGHBORHOOD' OR ("radiusMeters" IS NOT NULL AND "radiusMeters" > 0))
);
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_open_check" CHECK (
  ("status" = 'OUT' AND "openCourierId" = "courierId")
  OR ("status" <> 'OUT' AND "openCourierId" IS NULL)
);
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_values_check" CHECK (
  NOT ("deliveredAt" IS NOT NULL AND "failedAt" IS NOT NULL)
  AND ("collectedCents" IS NULL OR "collectedCents" >= 0)
  AND ("changeCents" IS NULL OR "changeCents" >= 0)
);
ALTER TABLE "Store" ADD CONSTRAINT "Store_courier_pay_check" CHECK (
  "courierPerDeliveryCents" >= 0 AND "courierFeeShareBps" BETWEEN 0 AND 10000
  AND "courierDailyCents" >= 0
);
ALTER TABLE "Courier" ADD CONSTRAINT "Courier_pay_check" CHECK (
  ("perDeliveryCents" IS NULL OR "perDeliveryCents" >= 0)
  AND ("feeShareBps" IS NULL OR "feeShareBps" BETWEEN 0 AND 10000)
  AND ("dailyCents" IS NULL OR "dailyCents" >= 0)
);
