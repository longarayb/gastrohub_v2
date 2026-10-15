-- CreateEnum
CREATE TYPE "GeoSource" AS ENUM ('GEOCODER', 'MANUAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "GeoPrecision" AS ENUM ('HOUSE', 'STREET');

-- CreateEnum
CREATE TYPE "RouteSource" AS ENUM ('OSRM', 'STRAIGHT');

-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomerAddress" ADD COLUMN     "geoPrecision" "GeoPrecision",
ADD COLUMN     "geoSource" "GeoSource";

-- AlterTable
ALTER TABLE "DeliveryRun" ADD COLUMN     "routeDistanceMeters" INTEGER,
ADD COLUMN     "routeDurationSeconds" INTEGER,
ADD COLUMN     "routeGeometry" JSONB,
ADD COLUMN     "routeSource" "RouteSource";

-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN     "etaAt" TIMESTAMP(3),
ADD COLUMN     "legDistanceMeters" INTEGER,
ADD COLUMN     "legDurationSeconds" INTEGER;

-- AlterTable
ALTER TABLE "OrderDelivery" ADD COLUMN     "geoPrecision" "GeoPrecision",
ADD COLUMN     "geoSource" "GeoSource",
ADD COLUMN     "geocodedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "key" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "precision" "GeoPrecision",
    "source" "GeoSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierPosition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "runId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "speedMps" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeocodeCache_tenantId_key_key" ON "GeocodeCache"("tenantId", "key");

-- CreateIndex
CREATE INDEX "CourierPosition_tenantId_runId_recordedAt_idx" ON "CourierPosition"("tenantId", "runId", "recordedAt");

-- CreateIndex
CREATE INDEX "CourierPosition_recordedAt_idx" ON "CourierPosition"("recordedAt");
