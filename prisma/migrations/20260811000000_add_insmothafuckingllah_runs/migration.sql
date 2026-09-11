-- CreateEnum
CREATE TYPE "InsmothafuckingllahRunStatus" AS ENUM ('ACTIVE', 'ENDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "InsmothafuckingllahRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" "InsmothafuckingllahRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "entryCost" INTEGER NOT NULL DEFAULT 0,
    "zpEarned" INTEGER NOT NULL DEFAULT 0,
    "killsClaimed" INTEGER NOT NULL DEFAULT 0,
    "dailyPrizeZp" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "InsmothafuckingllahRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InsmothafuckingllahRun_userId_day_idx" ON "InsmothafuckingllahRun"("userId", "day");

-- CreateIndex
CREATE INDEX "InsmothafuckingllahRun_day_zpEarned_idx" ON "InsmothafuckingllahRun"("day", "zpEarned" DESC);

-- AddForeignKey
ALTER TABLE "InsmothafuckingllahRun" ADD CONSTRAINT "InsmothafuckingllahRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
