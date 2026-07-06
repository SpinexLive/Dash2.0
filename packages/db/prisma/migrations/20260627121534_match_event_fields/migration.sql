-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "eventName" TEXT,
ADD COLUMN     "eventType" TEXT,
ADD COLUMN     "opponent" TEXT,
ADD COLUMN     "url" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "matchChannelId" TEXT;
