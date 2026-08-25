/*
  Warnings:

  - You are about to drop the `flappy_days` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "CosmeticKind" AS ENUM ('BACKGROUND', 'RING');

-- DropForeignKey
ALTER TABLE "flappy_days" DROP CONSTRAINT "flappy_days_userId_fkey";

-- DropIndex
DROP INDEX "FlappyRun_day_cpEarned_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "equippedBackground" TEXT,
ADD COLUMN     "equippedRing" TEXT;

-- DropTable
DROP TABLE "flappy_days";

-- CreateTable
CREATE TABLE "cosmetic_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "CosmeticKind" NOT NULL,
    "pricePaid" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cosmetic_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cosmetic_purchases_userId_idx" ON "cosmetic_purchases"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cosmetic_purchases_userId_slug_key" ON "cosmetic_purchases"("userId", "slug");

-- CreateIndex
CREATE INDEX "FlappyRun_day_cpEarned_idx" ON "FlappyRun"("day", "cpEarned" DESC);

-- AddForeignKey
ALTER TABLE "cosmetic_purchases" ADD CONSTRAINT "cosmetic_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
