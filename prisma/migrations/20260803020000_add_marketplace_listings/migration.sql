-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED');

-- AlterTable
ALTER TABLE "cosmetic_purchases" ADD COLUMN     "escrowed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "cosmeticPurchaseId" TEXT;

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "cosmeticPurchaseId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "buyerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_status_idx" ON "listings"("status");

-- CreateIndex
CREATE INDEX "listings_sellerId_status_idx" ON "listings"("sellerId", "status");

-- CreateIndex
CREATE INDEX "transfers_cosmeticPurchaseId_idx" ON "transfers"("cosmeticPurchaseId");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cosmeticPurchaseId_fkey" FOREIGN KEY ("cosmeticPurchaseId") REFERENCES "cosmetic_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_cosmeticPurchaseId_fkey" FOREIGN KEY ("cosmeticPurchaseId") REFERENCES "cosmetic_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
