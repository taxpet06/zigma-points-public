-- AlterTable
ALTER TABLE "InsamotherfuckingllahRun" RENAME CONSTRAINT "InsmothafuckingllahRun_pkey" TO "InsamotherfuckingllahRun_pkey";

-- CreateTable
CREATE TABLE "bomb_axa_wins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "bombs" INTEGER NOT NULL,
    "zp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bomb_axa_wins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bomb_axa_wins_userId_day_key" ON "bomb_axa_wins"("userId", "day");

-- AddForeignKey
ALTER TABLE "bomb_axa_wins" ADD CONSTRAINT "bomb_axa_wins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "InsmothafuckingllahRun_day_zpEarned_idx" RENAME TO "InsamotherfuckingllahRun_day_zpEarned_idx";

-- RenameIndex
ALTER INDEX "InsmothafuckingllahRun_userId_day_idx" RENAME TO "InsamotherfuckingllahRun_userId_day_idx";
