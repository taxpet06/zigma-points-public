-- CreateEnum
CREATE TYPE "CasinoGame" AS ENUM ('PLINKO', 'MINES', 'DICE', 'WHEEL', 'CHICKEN', 'AVIAMASTERS');

-- CreateEnum
CREATE TYPE "CasinoBetStatus" AS ENUM ('ACTIVE', 'SETTLED');

-- CreateTable
CREATE TABLE "casino_seeds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),

    CONSTRAINT "casino_seeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casino_bets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seedId" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "game" "CasinoGame" NOT NULL,
    "wager" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "state" JSONB,
    "multiplier" DOUBLE PRECISION,
    "payout" INTEGER,
    "status" "CasinoBetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "casino_bets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "casino_seeds_userId_revealedAt_idx" ON "casino_seeds"("userId", "revealedAt");

-- CreateIndex
CREATE INDEX "casino_bets_userId_createdAt_idx" ON "casino_bets"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "casino_bets_userId_status_idx" ON "casino_bets"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "casino_bets_seedId_nonce_key" ON "casino_bets"("seedId", "nonce");

-- AddForeignKey
ALTER TABLE "casino_seeds" ADD CONSTRAINT "casino_seeds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_seedId_fkey" FOREIGN KEY ("seedId") REFERENCES "casino_seeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

