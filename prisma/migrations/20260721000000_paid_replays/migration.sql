-- Paid replays: the first play of a game each day is free, the rest cost CP.

-- Slot machine: more than one spin per day is now legal, so the once-per-day
-- unique constraint becomes a plain lookup index. "First one free" is enforced by
-- the Serializable count-then-insert in dailyReward.claim.
DROP INDEX IF EXISTS "daily_rewards_userId_day_key";
CREATE INDEX IF NOT EXISTS "daily_rewards_userId_day_idx" ON "daily_rewards"("userId", "day");
ALTER TABLE "daily_rewards" ADD COLUMN IF NOT EXISTS "costCp" INTEGER NOT NULL DEFAULT 0;

-- Petris: mirrors FlappyRun.entryCost. A run with entryCost > 0 banks no CP.
ALTER TABLE "TetrisRun" ADD COLUMN IF NOT EXISTS "entryCost" INTEGER NOT NULL DEFAULT 0;
