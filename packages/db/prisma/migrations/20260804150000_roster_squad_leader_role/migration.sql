ALTER TABLE "settings" ADD COLUMN "squadLeaderRoleId" TEXT;

ALTER TABLE "rosters"
  ADD COLUMN "squadLeaderRoleId" TEXT,
  ADD COLUMN "squadLeaderRoleAssignedAt" TIMESTAMP(3),
  ADD COLUMN "squadLeaderRoleRemovedAt" TIMESTAMP(3);
