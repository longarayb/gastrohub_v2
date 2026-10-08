-- CreateEnum
CREATE TYPE "PrinterConnection" AS ENUM ('NETWORK', 'USB', 'SHARED', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('UNKNOWN', 'OK', 'PAPER_OUT', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "PrintJobKind" AS ENUM ('KITCHEN_TICKET', 'CANCEL_SLIP', 'DELIVERY_COPY', 'PRE_BILL', 'CASH_CLOSE', 'COURIER_SETTLEMENT', 'TEST_PAGE');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'LEASED', 'PRINTED', 'HELD', 'DISCARDED');

-- AlterTable
ALTER TABLE "ProductionSector" ADD COLUMN     "printCopies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "printerId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "printCancelSlips" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "printCashPrinterId" TEXT,
ADD COLUMN     "printDeliveryCopies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "printDeliveryCopyOnAccept" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "printHoldAfterMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "PrintAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairingFailures" INTEGER NOT NULL DEFAULT 0,
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "version" TEXT,
    "hostname" TEXT,
    "os" TEXT,
    "memoryMb" DOUBLE PRECISION,
    "windowsPrinters" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connection" "PrinterConnection" NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "profileId" TEXT NOT NULL,
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "withoutAccents" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" "PrinterStatus" NOT NULL DEFAULT 'UNKNOWN',
    "statusDetail" TEXT,
    "statusAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "printerId" TEXT NOT NULL,
    "kind" "PrintJobKind" NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT,
    "orderId" TEXT,
    "reprintOfId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leasedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "failingSince" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "heldAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "discardedAt" TIMESTAMP(3),
    "discardedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintAgent_tokenHash_key" ON "PrintAgent"("tokenHash");

-- CreateIndex
CREATE INDEX "PrintAgent_tenantId_revokedAt_idx" ON "PrintAgent"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "Printer_tenantId_agentId_idx" ON "Printer"("tenantId", "agentId");

-- CreateIndex
CREATE INDEX "PrintJob_tenantId_printerId_status_nextAttemptAt_idx" ON "PrintJob"("tenantId", "printerId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PrintJob_tenantId_status_idx" ON "PrintJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PrintJob_tenantId_orderId_idx" ON "PrintJob"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "PrintJob_tenantId_createdAt_idx" ON "PrintJob"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_tenantId_dedupeKey_key" ON "PrintJob"("tenantId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "ProductionSector" ADD CONSTRAINT "ProductionSector_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
