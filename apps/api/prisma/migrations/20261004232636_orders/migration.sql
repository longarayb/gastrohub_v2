-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEOUT', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS', 'DIGITAL_MENU', 'WAITER_APP', 'IFOOD', 'NINETY_NINE_FOOD', 'AIQFOME', 'OPEN_DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('DRAFT', 'QUEUED', 'PREPARING', 'READY', 'SERVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('VALUE', 'PERCENT');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'MEAL_VOUCHER', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "serviceFeeOrderTypes" "OrderType"[] DEFAULT ARRAY['DINE_IN']::"OrderType"[];

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "areaId" TEXT,
    "name" TEXT NOT NULL,
    "seats" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "guests" INTEGER,
    "waiterId" TEXT,
    "openedById" TEXT,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableSessionTable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "sessionId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TableSessionTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "cep" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reference" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Courier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minOrderCents" INTEGER,
    "maxDiscountCents" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSequence" (
    "tenantId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,

    CONSTRAINT "OrderSequence_pkey" PRIMARY KEY ("tenantId","businessDate")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "businessDate" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "publicCode" TEXT NOT NULL,
    "type" "OrderType" NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'POS',
    "status" "OrderStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "externalDisplayId" TEXT,
    "externalPayload" JSONB,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "tableSessionId" TEXT,
    "tabLabel" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerDocument" TEXT,
    "deliveryAddress" JSONB,
    "courierId" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "itemDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "orderDiscountType" "DiscountType",
    "orderDiscountValue" INTEGER,
    "orderDiscountReason" TEXT,
    "orderDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "couponId" TEXT,
    "couponCode" TEXT,
    "couponDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "serviceFeeBps" INTEGER NOT NULL DEFAULT 0,
    "serviceFeeWaived" BOOLEAN NOT NULL DEFAULT false,
    "serviceFeeWaivedReason" TEXT,
    "serviceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "promoSavingsCents" INTEGER NOT NULL DEFAULT 0,
    "expectedPaymentMethod" "PaymentMethod",
    "changeForCents" INTEGER,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "estimatedReadyAt" TIMESTAMP(3),
    "createdById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRound" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "productId" TEXT,
    "snapshot" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "sizeName" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitFullPriceCents" INTEGER NOT NULL,
    "unitChargedPriceCents" INTEGER NOT NULL,
    "discountType" "DiscountType",
    "discountValue" INTEGER,
    "discountReason" TEXT,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "sectorId" TEXT,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receivedCents" INTEGER,
    "changeCents" INTEGER,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cashSessionId" TEXT,
    "externalRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMP(3),
    "canceledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_tenantId_sortOrder_idx" ON "Area"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "Table_tenantId_areaId_idx" ON "Table"("tenantId", "areaId");

-- CreateIndex
CREATE UNIQUE INDEX "Table_tenantId_name_key" ON "Table"("tenantId", "name");

-- CreateIndex
CREATE INDEX "TableSession_tenantId_closedAt_idx" ON "TableSession"("tenantId", "closedAt");

-- CreateIndex
CREATE INDEX "TableSessionTable_tenantId_tableId_leftAt_idx" ON "TableSessionTable"("tenantId", "tableId", "leftAt");

-- CreateIndex
CREATE INDEX "TableSessionTable_sessionId_idx" ON "TableSessionTable"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "CustomerAddress_tenantId_customerId_idx" ON "CustomerAddress"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "Courier_tenantId_idx" ON "Courier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenantId_code_key" ON "Coupon"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicCode_key" ON "Order"("publicCode");

-- CreateIndex
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_tableSessionId_idx" ON "Order"("tenantId", "tableSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_businessDate_number_key" ON "Order"("tenantId", "businessDate", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_idempotencyKey_key" ON "Order"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_source_externalId_key" ON "Order"("tenantId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRound_orderId_number_key" ON "OrderRound"("orderId", "number");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_orderId_idx" ON "OrderItem"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_sectorId_status_idx" ON "OrderItem"("tenantId", "sectorId", "status");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_tenantId_orderId_idx" ON "OrderStatusHistory"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_orderId_idx" ON "Payment"("tenantId", "orderId");

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSessionTable" ADD CONSTRAINT "TableSessionTable_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSessionTable" ADD CONSTRAINT "TableSessionTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "OrderRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Values are never negative (Prisma does not express CHECK constraints; they are not tracked for drift).
ALTER TABLE "Order" ADD CONSTRAINT "Order_values_check" CHECK (
  "number" > 0 AND "version" >= 0 AND "subtotalCents" >= 0 AND "itemDiscountCents" >= 0
  AND "orderDiscountCents" >= 0 AND "couponDiscountCents" >= 0 AND "serviceFeeBps" >= 0
  AND "serviceFeeCents" >= 0 AND "deliveryFeeCents" >= 0 AND "totalCents" >= 0
  AND "paidCents" >= 0 AND "promoSavingsCents" >= 0
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_values_check" CHECK (
  "quantity" >= 1 AND "unitFullPriceCents" >= 0 AND "unitChargedPriceCents" >= 0
  AND "discountCents" >= 0 AND "totalCents" >= 0
);
ALTER TABLE "OrderSequence" ADD CONSTRAINT "OrderSequence_values_check" CHECK ("lastNumber" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_values_check" CHECK ("value" >= 0 AND "usedCount" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_values_check" CHECK ("amountCents" > 0);
