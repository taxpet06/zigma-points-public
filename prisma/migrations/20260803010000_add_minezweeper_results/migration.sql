-- CreateTable
CREATE TABLE "minezweeper_results" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "won" BOOLEAN NOT NULL,
    "zp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "minezweeper_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "minezweeper_results_userId_day_key" ON "minezweeper_results"("userId", "day");

-- AddForeignKey
ALTER TABLE "minezweeper_results" ADD CONSTRAINT "minezweeper_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
