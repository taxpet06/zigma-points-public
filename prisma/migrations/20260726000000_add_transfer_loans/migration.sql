-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "interestPct" INTEGER,
ADD COLUMN     "repaidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "transfers_status_dueAt_idx" ON "transfers"("status", "dueAt");
