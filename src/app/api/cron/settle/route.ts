// Cron settlement route — called by cron-job.org every 15 minutes.
// Vercel Hobby plan only supports once-daily cron jobs, so external scheduling
// via cron-job.org (free tier) is used instead of vercel.json crons.
// Authorization: Bearer ${CRON_SECRET} header required — set in cron-job.org job config.

import { after } from "next/server"
import { db, runSerializable } from "@/lib/db"
import { settlePost } from "@/lib/settlement"
import { notifyZpChange } from "@/lib/notifications"
import { repayment } from "@/lib/validation/transfer"

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const secret = authHeader?.replace("Bearer ", "")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const now = new Date()

  const expiredPosts = await db.post.findMany({
    where: {
      settled: false,
      votingEndsAt: { lte: now },
      type: { in: ["AWARD", "DEDUCT"] },
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
    after(() => {
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

  if (dueLoans.length > 0) {
    after(() => {
      for (const id of new Set(dueLoans.flatMap((l) => [l.fromUserId, l.toUserId]))) {
        void notifyZpChange(id)
      }
    })
  }

  return Response.json({ settled: expiredPosts.length, loansCollected: dueLoans.length })
}
