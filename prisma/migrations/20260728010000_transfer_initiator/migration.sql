-- Both directions now need the counterparty's approval, so a PENDING row must record
-- who created it — the approver is whichever party did NOT.

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "initiatedById" TEXT;

-- Backfill: every PENDING row today is a Request (Sends moved ZP immediately and were
-- written APPROVED), so the initiator is the payee. This covers 100% of rows the app
-- ever reads the column on. Settled rows stay NULL — a Send and an approved Request are
-- indistinguishable after the fact, and nothing reads the initiator once a row settles.
UPDATE "transfers" SET "initiatedById" = "toUserId" WHERE "status" = 'PENDING';
