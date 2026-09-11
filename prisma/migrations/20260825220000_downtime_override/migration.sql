-- CreateTable
CREATE TABLE "downtime_override" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "forcedDown" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "downtime_override_pkey" PRIMARY KEY ("id")
);
