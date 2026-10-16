-- CreateEnum
CREATE TYPE "PushChannel" AS ENUM ('WEB', 'FCM');

-- AlterTable
ALTER TABLE "DeliveryStop" ADD COLUMN     "closedActionId" TEXT;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "channel" "PushChannel" NOT NULL DEFAULT 'WEB',
ALTER COLUMN "p256dh" DROP NOT NULL,
ALTER COLUMN "auth" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "client" TEXT;
