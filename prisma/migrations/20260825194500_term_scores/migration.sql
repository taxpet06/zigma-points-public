-- CreateTable
CREATE TABLE "term_scores" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "community" DOUBLE PRECISION NOT NULL,
    "economy" DOUBLE PRECISION NOT NULL,
    "games" DOUBLE PRECISION NOT NULL,
    "consistency" DOUBLE PRECISION NOT NULL,
    "collection" DOUBLE PRECISION NOT NULL,
    "betting" DOUBLE PRECISION NOT NULL,
    "activeDays" INTEGER NOT NULL,
    "zpEarned" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "term_scores_termId_rank_idx" ON "term_scores"("termId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "term_scores_termId_userId_key" ON "term_scores"("termId", "userId");

-- AddForeignKey
ALTER TABLE "term_scores" ADD CONSTRAINT "term_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
