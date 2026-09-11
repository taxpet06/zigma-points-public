-- CreateEnum
CREATE TYPE "ZrossRunStatus" AS ENUM ('ACTIVE', 'ENDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "ZrossRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "ZrossRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "entryCost" INTEGER NOT NULL DEFAULT 0,
    "zpEarned" INTEGER NOT NULL DEFAULT 0,
    "pickupsClaimed" INTEGER NOT NULL DEFAULT 0,
    "dailyPrizeZp" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ZrossRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZrossRun_userId_day_idx" ON "ZrossRun"("userId", "day");

-- CreateIndex
CREATE INDEX "ZrossRun_day_zpEarned_idx" ON "ZrossRun"("day", "zpEarned" DESC);

-- AddForeignKey
ALTER TABLE "ZrossRun" ADD CONSTRAINT "ZrossRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
