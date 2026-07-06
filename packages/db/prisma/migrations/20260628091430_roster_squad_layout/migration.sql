/*
  Warnings:

  - A unique constraint covering the columns `[rosterId,discordId]` on the table `roster_slots` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[raidhelperEventId]` on the table `rosters` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "roster_slots" ADD COLUMN     "discordId" TEXT,
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "rosters" ADD COLUMN     "data" JSONB,
ADD COLUMN     "eventStartTime" TIMESTAMP(3),
ADD COLUMN     "eventTitle" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "roster_slots_rosterId_discordId_key" ON "roster_slots"("rosterId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "rosters_raidhelperEventId_key" ON "rosters"("raidhelperEventId");
