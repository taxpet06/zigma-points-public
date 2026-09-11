-- AlterTable
ALTER TABLE "FlappyRun" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "InsamotherfuckingllahRun" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "SequenceRecallRun" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "TetrisRun" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "ZnakeRun" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "ZrossRun" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "termId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "termId" TEXT;

-- CreateIndex
CREATE INDEX "FlappyRun_termId_zpEarned_idx" ON "FlappyRun"("termId", "zpEarned" DESC);

-- CreateIndex
CREATE INDEX "InsamotherfuckingllahRun_termId_zpEarned_idx" ON "InsamotherfuckingllahRun"("termId", "zpEarned" DESC);

-- CreateIndex
CREATE INDEX "SequenceRecallRun_termId_zpEarned_idx" ON "SequenceRecallRun"("termId", "zpEarned" DESC);

-- CreateIndex
CREATE INDEX "TetrisRun_termId_score_idx" ON "TetrisRun"("termId", "score" DESC);

-- CreateIndex
CREATE INDEX "ZnakeRun_termId_zpEarned_idx" ON "ZnakeRun"("termId", "zpEarned" DESC);

-- CreateIndex
CREATE INDEX "ZrossRun_termId_zpEarned_idx" ON "ZrossRun"("termId", "zpEarned" DESC);

-- CreateIndex
CREATE INDEX "posts_termId_createdAt_idx" ON "posts"("termId", "createdAt");

-- CreateIndex
CREATE INDEX "tasks_termId_createdAt_idx" ON "tasks"("termId", "createdAt");

-- Backfill: rows created before this column existed get the term whose window
-- contains their creation instant. Runs use startedAt (the same instant `day` is
-- derived from, so a run can never be stamped into a different term than its
-- day-key); posts and tasks use createdAt. Rows outside every term window stay
-- null and rank all-time / show under "All terms" only.
--
-- One-shot: from here on the stamp is written at creation (lib/terms.ts), never
-- re-derived. Term windows must not overlap; if two ever did, the later-starting
-- one wins (the ORDER BY in the correlated subquery).
UPDATE "FlappyRun" r SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE r."startedAt" >= t."startsAt" AND r."startedAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "TetrisRun" r SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE r."startedAt" >= t."startsAt" AND r."startedAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "ZnakeRun" r SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE r."startedAt" >= t."startsAt" AND r."startedAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "ZrossRun" r SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE r."startedAt" >= t."startsAt" AND r."startedAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "SequenceRecallRun" r SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE r."startedAt" >= t."startsAt" AND r."startedAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "InsamotherfuckingllahRun" r SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE r."startedAt" >= t."startsAt" AND r."startedAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "posts" p SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE p."createdAt" >= t."startsAt" AND p."createdAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
UPDATE "tasks" k SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE k."createdAt" >= t."startsAt" AND k."createdAt" < t."endsAt"
  ORDER BY t."startsAt" DESC LIMIT 1
);
