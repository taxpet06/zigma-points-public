-- Circulation serials for cosmetics + duplicates become ownable.
--
-- Backfill note: copies that were rolled BEFORE this migration and forfeited as
-- duplicates left no row behind, so they are unknowable and simply don't exist in
-- circulation. Every surviving row gets a serial in acquisition order.

-- AlterTable (nullable first so existing rows can be backfilled)
ALTER TABLE "cosmetic_purchases" ADD COLUMN     "mintNumber" INTEGER;

-- Backfill: serials 1..N per slug, oldest acquisition first. id breaks createdAt ties.
UPDATE "cosmetic_purchases" AS cp
SET "mintNumber" = seq.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY "createdAt", id) AS rn
    FROM "cosmetic_purchases"
) AS seq
WHERE cp.id = seq.id;

ALTER TABLE "cosmetic_purchases" ALTER COLUMN "mintNumber" SET NOT NULL;

-- DropIndex: a user may now hold multiple copies of the same slug
DROP INDEX "cosmetic_purchases_userId_slug_key";

-- CreateIndex: serials are unique per slug — the new concurrent-mint race guard
CREATE UNIQUE INDEX "cosmetic_purchases_slug_mintNumber_key" ON "cosmetic_purchases"("slug", "mintNumber");
