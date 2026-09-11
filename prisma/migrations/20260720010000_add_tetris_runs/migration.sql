-- CreateEnum
CREATE TYPE "TetrisRunStatus" AS ENUM ('ACTIVE', 'ENDED', 'ABANDONED');

-- CreateTable
CREATE TABLE "TetrisRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "TetrisRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "score" INTEGER NOT NULL DEFAULT 0,
    "linesCleared" INTEGER NOT NULL DEFAULT 0,
    "cpEarned" INTEGER NOT NULL DEFAULT 0,
    "dailyPrizeCp" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "TetrisRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TetrisRun_userId_day_idx" ON "TetrisRun"("userId", "day");

-- CreateIndex
CREATE INDEX "TetrisRun_day_score_idx" ON "TetrisRun"("day", "score" DESC);

-- AddForeignKey
ALTER TABLE "TetrisRun" ADD CONSTRAINT "TetrisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

