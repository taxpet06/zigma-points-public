-- CreateEnum
CREATE TYPE "FlappyRunStatus" AS ENUM ('ACTIVE', 'ENDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "FlappyRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "FlappyRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "entryCost" INTEGER NOT NULL DEFAULT 5,
    "cpEarned" INTEGER NOT NULL DEFAULT 0,
    "eatsClaimed" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "FlappyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlappyRun_userId_day_idx" ON "FlappyRun"("userId", "day");

-- CreateIndex
CREATE INDEX "FlappyRun_day_cpEarned_idx" ON "FlappyRun"("day" DESC, "cpEarned" DESC);

-- AddForeignKey
ALTER TABLE "FlappyRun" ADD CONSTRAINT "FlappyRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
