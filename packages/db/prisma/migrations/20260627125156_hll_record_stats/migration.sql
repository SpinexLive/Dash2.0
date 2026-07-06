-- CreateTable
CREATE TABLE "hll_record_stats" (
    "userId" BIGINT NOT NULL,
    "gameId" TEXT NOT NULL,
    "kpm" DECIMAL(6,2),
    "kdr" DECIMAL(6,2),
    "duelStrength" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hll_record_stats_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "hll_record_stats" ADD CONSTRAINT "hll_record_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
