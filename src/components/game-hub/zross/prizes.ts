// End-of-day Zross leaderboard prizes. The daily-reward-reset cron (00:00 ET) calls
// awardZrossDailyPrizes(previousDayKey()) to pay the top 3 of the day that just closed.
// Same shape as znake/prizes.ts — ranks by zpEarned, which for Zross is the score.
//
// Idempotency: the cron may double-fire (cron-job.org retries on timeout). Each winning
// run's dailyPrizeZp is a null→value compare-and-set inside a transaction — the second
// fire sees a non-null value, updates 0 rows, and skips the credit.

import { after } from "next/server"
import { db } from "@/lib/db"
import { notifyLeaderboardPrize } from "@/lib/notifications"
import { pickDailyWinners } from "@/lib/daily-prizes"

/** Credit the top 3 of `day`'s Zross leaderboard. Safe to call more than once per day. */
export async function awardZrossDailyPrizes(day: string): Promise<number> {
  // ponytail: scans every ENDED run for the day (indexed by [day, zpEarned desc]).
  // Fine at MVP scale; add a `distinct on (userId)` raw query if a day ever has 10k+ runs.
  const runs = await db.zrossRun.findMany({
    where: { day, status: "ENDED", zpEarned: { gt: 0 } },
    orderBy: { zpEarned: "desc" },
    select: { id: true, userId: true },
  })

  const winners = pickDailyWinners(runs)
  let awarded = 0

  for (const { run, rank, prize } of winners) {
    const credited = await db.$transaction(async (tx) => {
      // Compare-and-set: only the first fire flips null→prize (count 1) and pays out.
      const { count } = await tx.zrossRun.updateMany({
        where: { id: run.id, dailyPrizeZp: null },
        data: { dailyPrizeZp: prize },
      })
      if (count === 0) return false
      await tx.user.update({
        where: { id: run.userId },
        data: { zigmaPoints: { increment: prize } },
      })
      return true
    })
    if (credited) {
      awarded++
      after(() => notifyLeaderboardPrize(run.userId, "Zross", rank, prize))
    }
  }

  return awarded
}
