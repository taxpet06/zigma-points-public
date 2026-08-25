// Daily reward tRPC router — the slot-machine spin. One free spin a day, then
// SLOTS_REPLAY_COST ZP per re-spin (a wager: paid spins still pay out).
//
// Procedures:
//   getStatus — free spin used? what does a re-spin cost? (drives the card + modal copy)
//   claim     — roll server-side, debit a replay if this isn't the free spin, award ZP.
//
// Security / correctness (mirrors transfer.ts):
//   - protectedProcedure gates auth; the acting user is always ctx.session.user.id
//   - the roll happens on the SERVER (rollDailyReward) — the client can't pick its payout
//   - "first spin of the day is free" can't be a DB unique (multiple rows per day are now
//     legal), so the count-then-insert runs under Serializable — two concurrent claims
//     can't both read count=0 and both get a free spin. Same guard shape as tetris.start.
//   - the debit and the credit share one transaction, so a paid spin can never take the
//     ZP without recording the result

import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import { rollDailyReward, todayKey } from "@/lib/daily-reward"
import { notifyZpChange } from "@/lib/notifications"
import { SLOTS_REPLAY_COST } from "@/lib/game-economy"

export const dailyRewardRouter = createTRPCRouter({
  /** Whether the caller has used today's free spin, and what they got on it. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = todayKey()
    const [first, spinsToday, me] = await Promise.all([
      db.dailyReward.findFirst({
        where: { userId, day },
        orderBy: { createdAt: "asc" },
        select: { ticks: true, zp: true },
      }),
      db.dailyReward.count({ where: { userId, day } }),
      db.user.findUnique({ where: { id: userId }, select: { zigmaPoints: true } }),
    ])
    return {
      claimedToday: first !== null, // free spin used — a replay now costs ZP
      result: first,
      spinsToday,
      replayCost: SLOTS_REPLAY_COST,
      canAffordReplay: (me?.zigmaPoints ?? 0) >= SLOTS_REPLAY_COST,
    }
  }),

  /**
   * Rolls a spin, debits the replay cost when the free spin is already used, credits
   * the payout, and records the row — all in one Serializable transaction. Returns the
   * three reels so the UI animates to the exact server result, plus what it cost.
   * Throws FORBIDDEN when a paid re-spin isn't affordable.
   */
  claim: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = todayKey()
    const { slots, ticks, zp } = rollDailyReward()

    const costZp = await runSerializable(async (tx) => {
      const spinsToday = await tx.dailyReward.count({ where: { userId, day } })
      const cost = spinsToday === 0 ? 0 : SLOTS_REPLAY_COST

      if (cost > 0) {
        // Conditional decrement: updateMany's WHERE is the balance check, so an
        // overdraft is impossible even under concurrent spins.
        const { count } = await tx.user.updateMany({
          where: { id: userId, zigmaPoints: { gte: cost } },
          data: { zigmaPoints: { decrement: cost } },
        })
        if (count === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You need ${cost} ZP to spin again.`,
          })
        }
      }

      await tx.dailyReward.create({ data: { userId, day, ticks, zp, costZp: cost } })
      if (zp > 0) {
        await tx.user.update({ where: { id: userId }, data: { zigmaPoints: { increment: zp } } })
      }
      return cost
    })

    // Notify only on a win so a "0 ZP" spin doesn't send a balance-change email/push.
    if (zp > 0) after(() => notifyZpChange(userId))
    return { slots, ticks, zp, costZp }
  }),
})
