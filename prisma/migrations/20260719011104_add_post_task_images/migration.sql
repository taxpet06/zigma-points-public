-- AlterTable
ALTER TABLE "posts" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
