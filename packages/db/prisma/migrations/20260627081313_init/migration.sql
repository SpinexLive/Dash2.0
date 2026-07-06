-- CreateEnum
CREATE TYPE "RecruitStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('draft', 'posted', 'closed');

-- CreateEnum
CREATE TYPE "SlotResponse" AS ENUM ('pending', 'accepted', 'declined');

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "guildId" TEXT NOT NULL,
    "memberRoleId" TEXT,
    "selectableRoles" JSONB NOT NULL DEFAULT '[]',
    "recruitChannelId" TEXT,
    "defaultRecruitRoleId" TEXT,
    "crconBaseUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "serverNick" TEXT,
    "avatar" TEXT,
    "isGuildAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_accounts" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "platform" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" BIGINT NOT NULL,
    "roleId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "access_allowed_roles" (
    "roleId" TEXT NOT NULL,
    "addedBy" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_allowed_roles_pkey" PRIMARY KEY ("roleId")
);

-- CreateTable
CREATE TABLE "access_allowed_users" (
    "discordId" TEXT NOT NULL,
    "addedBy" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_allowed_users_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "members" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "currentRoleId" TEXT,
    "isMember" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_stats" (
    "userId" BIGINT NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "kpm" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_stats_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "recruits" (
    "id" BIGSERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "extractedGameId" TEXT,
    "rawApplication" TEXT,
    "status" "RecruitStatus" NOT NULL DEFAULT 'pending',
    "postedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "reviewedBy" BIGINT,

    CONSTRAINT "recruits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" BIGSERIAL NOT NULL,
    "map" TEXT,
    "result" TEXT,
    "playedAt" TIMESTAMP(3),
    "source" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_player_stats" (
    "id" BIGSERIAL NOT NULL,
    "matchId" BIGINT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" BIGINT,
    "team" TEXT,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "kpm" DECIMAL(6,2) NOT NULL DEFAULT 0,

    CONSTRAINT "match_player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosters" (
    "id" BIGSERIAL NOT NULL,
    "raidhelperEventId" TEXT,
    "channelId" TEXT,
    "messageId" TEXT,
    "status" "RosterStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_slots" (
    "id" BIGSERIAL NOT NULL,
    "rosterId" BIGINT NOT NULL,
    "userId" BIGINT,
    "position" TEXT,
    "response" "SlotResponse" NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "roster_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_discordId_key" ON "users"("discordId");

-- CreateIndex
CREATE INDEX "game_accounts_userId_idx" ON "game_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "game_accounts_platform_gameId_key" ON "game_accounts"("platform", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "members_userId_key" ON "members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "recruits_messageId_key" ON "recruits"("messageId");

-- CreateIndex
CREATE INDEX "recruits_status_idx" ON "recruits"("status");

-- CreateIndex
CREATE INDEX "match_player_stats_matchId_idx" ON "match_player_stats"("matchId");

-- CreateIndex
CREATE INDEX "match_player_stats_userId_idx" ON "match_player_stats"("userId");

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_stats" ADD CONSTRAINT "member_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "rosters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
