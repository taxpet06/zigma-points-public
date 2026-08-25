-- AlterEnum
ALTER TYPE "CosmeticKind" ADD VALUE 'TITLE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "equippedTitle" TEXT;
