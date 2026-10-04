-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('DINE_IN', 'COUNTER', 'DELIVERY', 'DIGITAL_MENU');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('STANDARD', 'PIZZA');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('STANDARD', 'SIZED');

-- CreateTable
CREATE TABLE "ProductionSector" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionSector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "CategoryKind" NOT NULL DEFAULT 'STANDARD',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" TIMESTAMP(3),
    "channels" "SalesChannel"[] DEFAULT ARRAY['DINE_IN', 'COUNTER', 'DELIVERY', 'DIGITAL_MENU']::"SalesChannel"[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "categoryId" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL DEFAULT 'STANDARD',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageKey" TEXT,
    "thumbKey" TEXT,
    "priceCents" INTEGER,
    "promoPriceCents" INTEGER,
    "sku" TEXT,
    "externalCode" TEXT,
    "sectorId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" TIMESTAMP(3),
    "channels" "SalesChannel"[] DEFAULT ARRAY['DINE_IN', 'COUNTER', 'DELIVERY', 'DIGITAL_MENU']::"SalesChannel"[],
    "searchText" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Size" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "categoryId" TEXT,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maxFlavors" INTEGER NOT NULL DEFAULT 1,
    "slices" INTEGER,
    "externalCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Size_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSizePrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "productId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "promoPriceCents" INTEGER,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" TIMESTAMP(3),

    CONSTRAINT "ProductSizePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" TIMESTAMP(3),
    "sku" TEXT,
    "externalCode" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOptionSizePrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "optionId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "ModifierOptionSizePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroupLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "groupId" TEXT NOT NULL,
    "categoryId" TEXT,
    "productId" TEXT,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModifierGroupLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "categoryId" TEXT,
    "productId" TEXT,
    "weekday" INTEGER NOT NULL,
    "opensAt" TEXT NOT NULL,
    "closesAt" TEXT NOT NULL,

    CONSTRAINT "AvailabilitySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionSector_tenantId_sortOrder_idx" ON "ProductionSector"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_tenantId_sortOrder_idx" ON "Category"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_tenantId_categoryId_sortOrder_idx" ON "Product"("tenantId", "categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_tenantId_deletedAt_idx" ON "Product"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "Size_tenantId_categoryId_idx" ON "Size"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "Size_tenantId_productId_idx" ON "Size"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "ProductSizePrice_tenantId_idx" ON "ProductSizePrice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSizePrice_productId_sizeId_key" ON "ProductSizePrice"("productId", "sizeId");

-- CreateIndex
CREATE INDEX "ModifierGroup_tenantId_idx" ON "ModifierGroup"("tenantId");

-- CreateIndex
CREATE INDEX "ModifierOption_tenantId_groupId_sortOrder_idx" ON "ModifierOption"("tenantId", "groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "ModifierOptionSizePrice_tenantId_idx" ON "ModifierOptionSizePrice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierOptionSizePrice_optionId_sizeId_key" ON "ModifierOptionSizePrice"("optionId", "sizeId");

-- CreateIndex
CREATE INDEX "ModifierGroupLink_tenantId_groupId_idx" ON "ModifierGroupLink"("tenantId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroupLink_categoryId_groupId_key" ON "ModifierGroupLink"("categoryId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroupLink_productId_groupId_key" ON "ModifierGroupLink"("productId", "groupId");

-- CreateIndex
CREATE INDEX "AvailabilitySchedule_tenantId_categoryId_idx" ON "AvailabilitySchedule"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "AvailabilitySchedule_tenantId_productId_idx" ON "AvailabilitySchedule"("tenantId", "productId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "ProductionSector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Size" ADD CONSTRAINT "Size_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Size" ADD CONSTRAINT "Size_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSizePrice" ADD CONSTRAINT "ProductSizePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSizePrice" ADD CONSTRAINT "ProductSizePrice_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOptionSizePrice" ADD CONSTRAINT "ModifierOptionSizePrice_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ModifierOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOptionSizePrice" ADD CONSTRAINT "ModifierOptionSizePrice_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroupLink" ADD CONSTRAINT "ModifierGroupLink_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroupLink" ADD CONSTRAINT "ModifierGroupLink_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroupLink" ADD CONSTRAINT "ModifierGroupLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySchedule" ADD CONSTRAINT "AvailabilitySchedule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySchedule" ADD CONSTRAINT "AvailabilitySchedule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner (Prisma cannot express CHECK constraints; they are not tracked for drift).
ALTER TABLE "Size" ADD CONSTRAINT "Size_one_owner_check"
  CHECK (("categoryId" IS NULL) <> ("productId" IS NULL));
ALTER TABLE "ModifierGroupLink" ADD CONSTRAINT "ModifierGroupLink_one_owner_check"
  CHECK (("categoryId" IS NULL) <> ("productId" IS NULL));
ALTER TABLE "AvailabilitySchedule" ADD CONSTRAINT "AvailabilitySchedule_one_owner_check"
  CHECK (("categoryId" IS NULL) <> ("productId" IS NULL));

-- Sanity checks on values.
ALTER TABLE "Product" ADD CONSTRAINT "Product_prices_check"
  CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
ALTER TABLE "ProductSizePrice" ADD CONSTRAINT "ProductSizePrice_price_check" CHECK ("priceCents" >= 0);
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_values_check"
  CHECK ("priceCents" >= 0 AND "maxQuantity" >= 1);
ALTER TABLE "ModifierGroupLink" ADD CONSTRAINT "ModifierGroupLink_limits_check"
  CHECK ("minSelect" >= 0 AND "maxSelect" >= 1 AND "minSelect" <= "maxSelect");
ALTER TABLE "Size" ADD CONSTRAINT "Size_flavors_check" CHECK ("maxFlavors" BETWEEN 1 AND 8);
ALTER TABLE "AvailabilitySchedule" ADD CONSTRAINT "AvailabilitySchedule_weekday_check"
  CHECK ("weekday" BETWEEN 0 AND 6);
