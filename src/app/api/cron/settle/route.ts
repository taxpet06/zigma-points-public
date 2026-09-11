// Cron settlement route — called by cron-job.org every 15 minutes.
// Vercel Hobby plan only supports once-daily cron jobs, so external scheduling
// via cron-job.org (free tier) is used instead of vercel.json crons.
// Authorization: Bearer ${CRON_SECRET} header required — set in cron-job.org job config.

import { after } from "next/server"
import { downtimeState } from "@/lib/downtime"
import { db, runSerializable } from "@/lib/db"
import { settlePost } from "@/lib/settlement"
import { notifyZpChange } from "@/lib/notifications"
import { repayment } from "@/lib/validation/transfer"
import { scoreEndedTerms, unscoredEndedTerms } from "@/lib/scoring-run"
import { resetPassedTermBoundaries } from "@/lib/term-reset"

// Vercel's default function budget is 10s. This route does the settlement sweep, the
// Serializable loan sweep AND (on the tick after a term closes) a full Zigma Maxxer
// scoring pass, which measures ~3s against production. A platform timeout is not
// catchable by the try/catch below and would roll back the settlement transaction, so
// the ceiling is raised explicitly rather than left to chance on the one tick a term
// is decided. Vercel caps this to whatever the plan actually allows.
export const maxDuration = 60

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const secret = authHeader?.replace("Bearer ", "")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }


  // NOT gated off during downtime. The term ends, and everything outstanding closes out
  // with it — see the query below. An early return here would instead leave every post
  // whose voting window ran into the break sitting unsettled for the whole three weeks,
  // then dump the lot into one $transaction on the first tick of the next term: last
  // term's votes moving ZP weeks late, inside a term they have nothing to do with.
  const { down } = await downtimeState()
  const now = new Date()

  // "Is the term over?" is answered by the TERM ROW, read fresh — never by `down`.
  //
  // Two reasons, both of which move real ZP if you get them wrong:
  //
  //  1. `down` is now admin-overridable (admin.setDowntime). An admin closing the app
  //     mid-term to test the closed-door page would otherwise trip the final sweep and
  //     settle EVERY open post early, on whatever votes it happened to have.
  //  2. `down` is cached for up to TTL_MS (lib/downtime.ts), while scoreEndedTerms below
  //     reads `endsAt <= now` fresh. At a term boundary the two could disagree on the one
  //     tick that matters: no sweep, but scoring runs — writing a permanent board from
  //     pre-settlement balances. Both now read the same fresh row, so they cannot.
  const currentTerm = await db.term.findFirst({
    where: { startsAt: { lte: now } },
    orderBy: { startsAt: "desc" },
    select: { endsAt: true },
  })
  const termOver = currentTerm !== null && currentTerm.endsAt <= now
  // Non-null exactly when the sweep applies — carries the cutoff into the query below.
  const termEndsAt = termOver ? currentTerm!.endsAt : null

  const expiredPosts = await db.post.findMany({
    where: {
      settled: false,
      type: { in: ["AWARD", "DEDUCT"] },
      OR: [
        // The normal rule: a post settles when its own voting window closes.
        { votingEndsAt: { lte: now } },
        // Plus the end-of-term sweep. A post whose window would have run PAST the end of
        // the term settles with the term instead of outliving it — but only if it
        // existed before the term closed.
        //
        // That `createdAt` bound is load-bearing, not decoration. This used to be an
        // unbounded "settle everything" once the term was over, which was self-limiting
        // only because nobody could post during a break. An admin can now reopen the app
        // mid-interim (admin.setDowntime), and without the bound every post made after
        // the reopen would be settled by the very next 15-minute tick — on whatever
        // votes it had, which for a minutes-old post is usually none, i.e. Rejected.
        ...(termEndsAt ? [{ createdAt: { lte: termEndsAt } }] : []),
      ],
    },
    select: {
      id: true,
      authorId: true,
      type: true,
      zpAmount: true,
      targets: { select: { userId: true } },
      votes: { select: { type: true } },
    },
  })

  // No early return on zero expired posts — the loan sweep below must run every cycle.
  if (expiredPosts.length > 0) {
    // Array-form $transaction — a pure batch with no read-then-write gap, so the interactive
    // form buys nothing here. (The adapter is the WebSocket driver and does support it.)
    // D-03: settle all expired posts in one batch; at MVP scale well within 10s Vercel timeout.
    // Cast type narrowly — the WHERE filter guarantees only AWARD/DEDUCT posts are returned.
    const ops = expiredPosts.flatMap((post) =>
      settlePost(post as typeof post & { type: "AWARD" | "DEDUCT" }),
    )
    await db.$transaction(ops)

    // Non-blocking: notify targets of Awarded posts after the response is sent (T-x04-02).
    // Recompute the Awarded outcome inline — same rule used in settlePost (agreeCount > disagreeCount).
    // Silent once the app is closed: the ZP still moves and the outcome is on the post
    // when people come back, but a push that lands someone on /downtime is noise. This
    // one DOES key on `down` and not termOver — it is about whether the app looks shut,
    // which is exactly what the admin override changes.
    if (!down) after(() => {
      for (const post of expiredPosts) {
        const agree = post.votes.filter((v) => v.type === "AGREE").length
        const disagree = post.votes.filter((v) => v.type === "DISAGREE").length
        if (agree > disagree) {
          for (const target of post.targets) {
            void notifyZpChange(target.userId)
          }
          void notifyZpChange(post.authorId) // author earns zpAmount back when their post passes
        }
      }
    })
  }

  // Loan sweep — collect principal + interest from borrowers whose payback date has passed.
  // Piggybacked here rather than in a third cron route: Vercel Hobby allows only 2.
  //
  // The read and the writes share ONE Serializable transaction, so two overlapping invocations
  // of this route cannot both collect the same loan: they contend on the same rows, the loser
  // takes a 40001 serialization failure, runSerializable retries, and the re-read sees repaidAt
  // already set. READ COMMITTED would NOT be enough — the loser's UPDATE re-evaluates after the
  // winner commits and would charge a second time.
  const dueLoans = await runSerializable(async (tx) => {
    const loans = await tx.transfer.findMany({
      where: { status: "APPROVED", dueAt: { lte: now }, repaidAt: null },
      select: { id: true, fromUserId: true, toUserId: true, amount: true, interestPct: true },
    })
    for (const loan of loans) {
      const { borrowerId, lenderId, owed } = repayment(loan)
      await tx.transfer.update({ where: { id: loan.id }, data: { repaidAt: now } })
      // No balance check on the borrower — going negative is the design (a loan is a debt,
      // not an option). The lender always receives the full owed amount. Do not "fix" this.
      await tx.user.update({ where: { id: borrowerId }, data: { zigmaPoints: { decrement: owed } } })
      await tx.user.update({ where: { id: lenderId }, data: { zigmaPoints: { increment: owed } } })
    }
    return loans
  })

  // Loans are deliberately NOT swept forward to the term end above: dueAt is a date the
  // borrower agreed to, and collecting principal + interest early because a term happened
  // to end would take real ZP before it was owed. They keep collecting on their own dates
  // through the break, which is also why they never pile up for reopen.
  if (dueLoans.length > 0 && !down) {
    after(() => {
      for (const id of new Set(dueLoans.flatMap((l) => [l.fromUserId, l.toUserId]))) {
        void notifyZpChange(id)
      }
    })
  }

  // Zigma Maxxer scoring — LAST, and deliberately so. The settlement sweep above has
  // just moved the ZP of every post whose voting window ran into the end of the term,
  // so balances are final by the time the scorer reads them. Running this as its own
  // cron route would race that sweep and could crown someone on pre-settlement numbers.
  //
  // Piggybacked here for the same reason the loan sweep is (see above), and it is cheap
  // to leave in the hot path: scoreEndedTerms is a single indexed lookup on every tick
  // where nothing has ended, and the existence of term_scores rows stops an already
  // scored term from being scored twice. No notification is sent for the result.
  //
  // Failure here must not roll back the settlement and loan work already committed
  // above — that is real ZP — so it is caught and reported rather than thrown. A term
  // that fails to score stays unscored and is retried on the next tick.
  let scoredTerms: string[] = []
  let scoringError: string | null = null
  try {
    scoredTerms = await scoreEndedTerms(now)
  } catch (err) {
    scoringError = err instanceof Error ? err.message : String(err)
    console.error("[cron/settle] term scoring failed", err)
  }

  // The term boundary wipe — AFTER scoring, and ONLY once nothing is left to score.
  //
  // The wipe is one-way: it zeroes every balance and stamps the boundary so it never
  // fires again. Scoring reads User.zigmaPoints as its zpBalance metric, so wiping while
  // any ended term still lacks a board would let the NEXT tick score that term against
  // all-zero balances and write a permanent, wrong Podium. Two ways in, both closed here:
  //
  //   - scoring threw on this tick (caught above, so execution would otherwise continue);
  //   - scoring succeeded but only got through one term, because it does one per tick.
  //
  // "unscored" means no board written at or after the term's endsAt — the same rule
  // scoreEndedTerms uses, so a mid-term admin preview does not count as scored here
  // either. Skipping simply defers the wipe one tick; it is idempotent and in no hurry.
  let zpResets: string[] = []
  let resetError: string | null = null
  let resetDeferred: string[] = []
  try {
    resetDeferred = scoringError === null ? await unscoredEndedTerms(now) : ["scoring-failed"]
    if (resetDeferred.length === 0) zpResets = await resetPassedTermBoundaries(now)
  } catch (err) {
    resetError = err instanceof Error ? err.message : String(err)
    console.error("[cron/settle] term ZP reset failed", err)
  }

  return Response.json({
    settled: expiredPosts.length,
    loansCollected: dueLoans.length,
    finalSweep: termOver,
    scoredTerms,
    scoringError,
    zpResets,
    resetDeferred,
    resetError,
  })
}
