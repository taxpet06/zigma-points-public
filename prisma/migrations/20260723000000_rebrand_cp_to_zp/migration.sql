-- Rebrand: Cigma Points -> Zigma Points, CP -> ZP.
--
-- Column renames only: no type changes, no data movement, no drops. Postgres
-- RENAME COLUMN is a catalog-only operation, so this is instant even on large
-- tables and preserves every existing balance.
--
-- Hand-written on purpose. `prisma migrate dev` diffs the schema and emits
-- DROP COLUMN + ADD COLUMN for a rename, which would zero every user's balance.

ALTER TABLE "users" RENAME COLUMN "cigmaPoints" TO "zigmaPoints";

ALTER TABLE "posts" RENAME COLUMN "cpAmount" TO "zpAmount";

ALTER TABLE "tasks" RENAME COLUMN "cpReward" TO "zpReward";

ALTER TABLE "task_completions" RENAME COLUMN "awardedCp" TO "awardedZp";

ALTER TABLE "daily_rewards" RENAME COLUMN "cp" TO "zp";
ALTER TABLE "daily_rewards" RENAME COLUMN "costCp" TO "costZp";

ALTER TABLE "wordle_results" RENAME COLUMN "cp" TO "zp";

ALTER TABLE "FlappyRun" RENAME COLUMN "cpEarned" TO "zpEarned";
ALTER TABLE "FlappyRun" RENAME COLUMN "dailyPrizeCp" TO "dailyPrizeZp";

ALTER TABLE "TetrisRun" RENAME COLUMN "cpEarned" TO "zpEarned";
ALTER TABLE "TetrisRun" RENAME COLUMN "dailyPrizeCp" TO "dailyPrizeZp";

-- Index name is derived from its columns, so Prisma expects it to follow the
-- rename or it reports drift on the next migrate. TetrisRun has no equivalent
-- index (its leaderboard index is on `score`), so there is nothing to rename there.
ALTER INDEX "FlappyRun_day_cpEarned_idx" RENAME TO "FlappyRun_day_zpEarned_idx";
