-- CreateTable
CREATE TABLE "term_poopers" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_poopers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "term_poopers_termId_idx" ON "term_poopers"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "term_poopers_termId_userId_key" ON "term_poopers"("termId", "userId");

-- AddForeignKey
ALTER TABLE "term_poopers" ADD CONSTRAINT "term_poopers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
