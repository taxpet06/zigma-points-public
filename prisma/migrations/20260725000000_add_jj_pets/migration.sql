-- CreateTable
CREATE TABLE "jj_pets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressDay" TEXT NOT NULL,
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "lastFedDay" TEXT,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "claimedDay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jj_pets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jj_pets_userId_key" ON "jj_pets"("userId");

-- AddForeignKey
ALTER TABLE "jj_pets" ADD CONSTRAINT "jj_pets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
