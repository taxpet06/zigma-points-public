// Settlement logic — pure function, no DB calls. Caller passes returned ops to db.$transaction([]).
import { db } from "@/lib/db"

// Max ZP an author earns back when their post passes, regardless of the post's zpAmount.
export const AUTHOR_REWARD_CAP = 3

type ExpiredPost = {
  id: string
  authorId: string
  type: "AWARD" | "DEDUCT"
  zpAmount: number
  targets: { userId: string }[]
  votes: { type: "AGREE" | "DISAGREE" }[]
}

/**
 * settlePost — takes an expired post snapshot and returns an array of Prisma operations.
 * Rules (per D-01, D-02, D-04, M-01):
 *   - outcome is "Awarded" only when agreeCount > disagreeCount
 *   - outcome is "Rejected" for all other cases (tie, zero votes, disagrees >= agrees)
 *   - Awarded AWARD post → zigmaPoints increment by zpAmount on EACH target user individually
 *   - Awarded DEDUCT post → zigmaPoints decrement by zpAmount on EACH target user individually
 *   - Awarded post (either type) → author is credited min(zpAmount, AUTHOR_REWARD_CAP), strictly awarded
 *   - Rejected post → post update only (no balance change)
 * An Awarded post therefore yields 1 post.update + N target user.update ops + 1 author user.update.
 */
export function settlePost(
  post: ExpiredPost,
): ReturnType<typeof db.post.update>[] {
  if (post.zpAmount <= 0) {
    throw new Error(`settlePost: zpAmount must be positive, got ${post.zpAmount} for post ${post.id}`)
  }

  const agreeCount = post.votes.filter((v) => v.type === "AGREE").length
  const disagreeCount = post.votes.filter((v) => v.type === "DISAGREE").length

  const outcome = agreeCount > disagreeCount ? "Awarded" : "Rejected"

  // `settled: false` in the WHERE is a compare-and-set against the snapshot the cron
  // read moments earlier. If an admin cancelled this post in between, no row matches,
  // Prisma throws P2025, and the WHOLE $transaction rolls back — so a cancelled post
  // can never have its ZP credited. Requires Prisma's extended-where-unique (>=4.5).
  // ponytail: one cancelled post aborts the batch; the next cron run 15 min later
  // settles the rest (the cancelled one is now excluded by the settled:false query).
  // Split into per-post transactions if that latency ever matters.
  const ops: ReturnType<typeof db.post.update>[] = [
    db.post.update({
      where: { id: post.id, settled: false },
      data: { settled: true, outcome },
    }),
  ]

  if (outcome === "Awarded") {
    for (const target of post.targets) {
      ops.push(
        db.user.update({
          where: { id: target.userId },
          data: {
            zigmaPoints:
              post.type === "AWARD"
                ? { increment: post.zpAmount }
                : { decrement: post.zpAmount },
          },
        }) as unknown as ReturnType<typeof db.post.update>,
      )
    }

    // Author reward: a post that passes credits its author the absolute value of zpAmount,
    // strictly an award regardless of AWARD/DEDUCT type, capped at 3. zpAmount is always positive.
    ops.push(
      db.user.update({
        where: { id: post.authorId },
        data: { zigmaPoints: { increment: Math.min(post.zpAmount, AUTHOR_REWARD_CAP) } },
      }) as unknown as ReturnType<typeof db.post.update>,
    )
  }

  return ops
}
