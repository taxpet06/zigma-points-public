-- AlterTable
ALTER TABLE "terms" ADD COLUMN     "winnerId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hasCrown" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "terms_winnerId_idx" ON "terms"("winnerId");

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
