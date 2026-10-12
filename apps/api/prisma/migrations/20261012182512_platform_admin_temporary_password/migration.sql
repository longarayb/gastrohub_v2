-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "temporaryPasswordExpiresAt" TIMESTAMP(3);
