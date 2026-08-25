-- Rename enum
ALTER TYPE "InsmothafuckingllahRunStatus" RENAME TO "InsamotherfuckingllahRunStatus";

-- Rename table
ALTER TABLE "InsmothafuckingllahRun" RENAME TO "InsamotherfuckingllahRun";

-- Rename the relation reference on User table (the constraint doesn't rename automatically)
ALTER TABLE "InsamotherfuckingllahRun" RENAME CONSTRAINT "InsmothafuckingllahRun_userId_fkey" TO "InsamotherfuckingllahRun_userId_fkey";
