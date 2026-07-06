/*
  Warnings:

  - You are about to drop the column `crconBaseUrl` on the `settings` table. All the data in the column will be lost.
  - You are about to drop the column `defaultRecruitRoleId` on the `settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "settings" DROP COLUMN "crconBaseUrl",
DROP COLUMN "defaultRecruitRoleId",
ADD COLUMN     "rankRoles" JSONB NOT NULL DEFAULT '[]';
