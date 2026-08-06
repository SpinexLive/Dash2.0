CREATE TABLE "connected_servers" (
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "connected_servers_pkey" PRIMARY KEY ("guildId")
);
