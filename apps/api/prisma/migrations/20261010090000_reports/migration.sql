-- Reports (D038): business day of conclusion of the orders and of each payment and refund.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "closedBusinessDate" TEXT;

-- Existing concluded or canceled orders: the day of their number (best approximation).
UPDATE "Order" SET "closedBusinessDate" = "businessDate" WHERE "status" IN ('DELIVERED', 'CANCELED');

-- AlterTable: added nullable, filled, then required.
ALTER TABLE "Payment" ADD COLUMN     "businessDate" TEXT,
ADD COLUMN     "refundBusinessDate" TEXT;

-- Payments: the day of the cash register that received them (matches the cash close), else
-- the day of the order (online payments).
UPDATE "Payment" p SET "businessDate" = COALESCE(
  (SELECT s."businessDate" FROM "CashSession" s WHERE s."id" = p."cashSessionId"),
  (SELECT o."businessDate" FROM "Order" o WHERE o."id" = p."orderId")
);
UPDATE "Payment" p SET "refundBusinessDate" = COALESCE(
  (SELECT s."businessDate" FROM "CashSession" s WHERE s."id" = p."refundSessionId"),
  p."businessDate"
) WHERE p."refundedAt" IS NOT NULL;

ALTER TABLE "Payment" ALTER COLUMN "businessDate" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_action_createdAt_idx" ON "AuditLog"("tenantId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_closedBusinessDate_status_idx" ON "Order"("tenantId", "closedBusinessDate", "status");

-- CreateIndex
CREATE INDEX "Payment_tenantId_businessDate_idx" ON "Payment"("tenantId", "businessDate");

-- CreateIndex
CREATE INDEX "Payment_tenantId_refundBusinessDate_idx" ON "Payment"("tenantId", "refundBusinessDate");

-- CreateIndex
CREATE INDEX "ProductionTask_tenantId_sentAt_idx" ON "ProductionTask"("tenantId", "sentAt");
