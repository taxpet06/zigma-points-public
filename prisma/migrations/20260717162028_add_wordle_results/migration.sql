-- CreateTable
CREATE TABLE "wordle_results" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "won" BOOLEAN NOT NULL,
    "tries" INTEGER NOT NULL,
    "cp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wordle_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wordle_results_userId_day_key" ON "wordle_results"("userId", "day");

-- AddForeignKey
ALTER TABLE "wordle_results" ADD CONSTRAINT "wordle_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
