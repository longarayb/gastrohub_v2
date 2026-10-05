-- CreateEnum
CREATE TYPE "ProductionTaskStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProductionTaskKind" AS ENUM ('ITEM', 'COMBO_PART');

-- AlterTable
ALTER TABLE "ProductionSector" ADD COLUMN     "lateAfterMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "warnAfterMinutes" INTEGER NOT NULL DEFAULT 10;


-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "kind" "ProductionTaskKind" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "status" "ProductionTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "recallCount" INTEGER NOT NULL DEFAULT 0,
    "startedByUserId" TEXT,
    "startedByDeviceId" TEXT,
    "readyByUserId" TEXT,
    "readyByDeviceId" TEXT,

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KdsDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "sectorIds" TEXT[],
    "showsExpedition" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairingFailures" INTEGER NOT NULL DEFAULT 0,
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KdsDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionTask_tenantId_sectorId_status_idx" ON "ProductionTask"("tenantId", "sectorId", "status");

-- CreateIndex
CREATE INDEX "ProductionTask_tenantId_orderId_idx" ON "ProductionTask"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "ProductionTask_orderItemId_idx" ON "ProductionTask"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "KdsDevice_tokenHash_key" ON "KdsDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KdsDevice_tenantId_revokedAt_idx" ON "KdsDevice"("tenantId", "revokedAt");

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "OrderRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "ProductionSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: the store-wide late alert becomes each sector's red limit (yellow at half of it,
-- at least 1 minute), then the old column goes away (D027).
UPDATE "ProductionSector" ps
SET "lateAfterMinutes" = GREATEST(s."kdsLateAfterMinutes", 2),
    "warnAfterMinutes" = GREATEST(s."kdsLateAfterMinutes" / 2, 1)
FROM "Store" s
WHERE s.id = ps."tenantId";

ALTER TABLE "Store" DROP COLUMN "kdsLateAfterMinutes";

-- Values (Prisma does not express CHECK constraints; they are not tracked for drift).
ALTER TABLE "ProductionSector" ADD CONSTRAINT "ProductionSector_limits_check" CHECK (
  "warnAfterMinutes" >= 1 AND "lateAfterMinutes" > "warnAfterMinutes"
);
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_values_check" CHECK (
  "quantity" >= 1 AND "recallCount" >= 0
);
ALTER TABLE "KdsDevice" ADD CONSTRAINT "KdsDevice_values_check" CHECK ("pairingFailures" >= 0);
