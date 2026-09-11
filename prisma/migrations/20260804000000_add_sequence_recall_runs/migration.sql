-- CreateEnum
CREATE TYPE "SequenceRecallRunStatus" AS ENUM ('ACTIVE', 'ENDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "SequenceRecallRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "SequenceRecallRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "entryCost" INTEGER NOT NULL DEFAULT 0,
    "zpEarned" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "round" INTEGER NOT NULL DEFAULT 1,
    "roundInputStartedAt" TIMESTAMP(3),
    "dailyPrizeZp" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SequenceRecallRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SequenceRecallRun_userId_day_idx" ON "SequenceRecallRun"("userId", "day");

-- CreateIndex
CREATE INDEX "SequenceRecallRun_day_zpEarned_idx" ON "SequenceRecallRun"("day", "zpEarned" DESC);

-- AddForeignKey
ALTER TABLE "SequenceRecallRun" ADD CONSTRAINT "SequenceRecallRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
