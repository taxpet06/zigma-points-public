-- CreateTable
CREATE TABLE "flappy_days" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "cpEarned" INTEGER NOT NULL DEFAULT 0,
    "bestPipes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flappy_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flappy_days_userId_day_key" ON "flappy_days"("userId", "day");

-- AddForeignKey
ALTER TABLE "flappy_days" ADD CONSTRAINT "flappy_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
