-- Corrects the backfill in 20260825165754_add_term_id_stamps.
--
-- That migration matched a row to the term whose WINDOW contained it:
--   createdAt >= t.startsAt AND createdAt < t.endsAt
-- The runtime rule (currentTermId, src/lib/terms.ts) is different and deliberately so:
-- the current term is the most recent term that has STARTED, with no endsAt bound —
-- "a term whose endsAt has passed is still current until the next one begins".
--
-- Rows created in that gap (past a term's endsAt, before any successor starts) were
-- therefore left NULL, while an identical row created after deploy is stamped. NULL is
-- not harmless: isCurrentTerm(null) is false whenever a term exists, so those rows go
-- permanently read-only (reply.createReply FORBIDDEN, bet.placeBet rejected) and drop
-- out of the term feed filter and every term leaderboard.
--
-- This fills only the rows the first pass left NULL, using the runtime rule. Rows from
-- before the very first term stay NULL, which is correct: currentTermId() is null then
-- too, so isCurrentTerm(null) is TRUE and they stay writable.
--
-- Idempotent (WHERE termId IS NULL), so it is safe if it ever re-runs.
UPDATE "FlappyRun" r SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= r."startedAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE r."termId" IS NULL;
UPDATE "TetrisRun" r SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= r."startedAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE r."termId" IS NULL;
UPDATE "ZnakeRun" r SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= r."startedAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE r."termId" IS NULL;
UPDATE "ZrossRun" r SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= r."startedAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE r."termId" IS NULL;
UPDATE "SequenceRecallRun" r SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= r."startedAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE r."termId" IS NULL;
UPDATE "InsamotherfuckingllahRun" r SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= r."startedAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE r."termId" IS NULL;
UPDATE "posts" p SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= p."createdAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE p."termId" IS NULL;
UPDATE "tasks" k SET "termId" = (
  SELECT t.id FROM "terms" t WHERE t."startsAt" <= k."createdAt"
  ORDER BY t."startsAt" DESC LIMIT 1
) WHERE k."termId" IS NULL;
