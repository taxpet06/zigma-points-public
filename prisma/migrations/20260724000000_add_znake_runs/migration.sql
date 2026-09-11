-- CreateEnum
CREATE TYPE "ZnakeRunStatus" AS ENUM ('ACTIVE', 'ENDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "ZnakeRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "ZnakeRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "entryCost" INTEGER NOT NULL DEFAULT 0,
    "zpEarned" INTEGER NOT NULL DEFAULT 0,
    "applesClaimed" INTEGER NOT NULL DEFAULT 0,
    "dailyPrizeZp" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ZnakeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZnakeRun_userId_day_idx" ON "ZnakeRun"("userId", "day");

-- CreateIndex
CREATE INDEX "ZnakeRun_day_zpEarned_idx" ON "ZnakeRun"("day", "zpEarned" DESC);

-- AddForeignKey
ALTER TABLE "ZnakeRun" ADD CONSTRAINT "ZnakeRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
