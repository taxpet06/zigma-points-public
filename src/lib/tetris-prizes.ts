// End-of-day Tetris leaderboard prizes. The daily-reward-reset cron (00:00 ET) calls
// awardTetrisDailyPrizes(previousDayKey()) to pay the top 3 of the day that just closed.
// Clones daily-prizes.ts's awardFlappyDailyPrizes verbatim, reusing its game-agnostic
// pickDailyWinners helper, but ranks by `score` (the leaderboard metric) not `zpEarned`.
//
// Idempotency: the cron may double-fire (cron-job.org retries on timeout). Each winning
// run's dailyPrizeZp is a null→value compare-and-set inside a transaction — the second
// fire sees a non-null value, updates 0 rows, and skips the credit.

import { after } from "next/server"
import { db } from "@/lib/db"
import { notifyLeaderboardPrize } from "@/lib/notifications"
import { pickDailyWinners } from "@/lib/daily-prizes"
import { DAILY_PRIZES } from "@/lib/tetris/constants"

/** Credit the top 3 of `day`'s Tetris leaderboard. Safe to call more than once per day. */
export async function awardTetrisDailyPrizes(day: string): Promise<number> {
  // ponytail: scans every ENDED run for the day (indexed by [day, score desc]).
  // Fine at MVP scale; add a `distinct on (userId)` raw query if a day ever has 10k+ runs.
  const runs = await db.tetrisRun.findMany({
    where: { day, status: "ENDED", score: { gt: 0 } },
    orderBy: { score: "desc" },
    select: { id: true, userId: true },
  })

  const winners = pickDailyWinners(runs, DAILY_PRIZES)
  let awarded = 0

  for (const { run, rank, prize } of winners) {
    const credited = await db.$transaction(async (tx) => {
      // Compare-and-set: only the first fire flips null→prize (count 1) and pays out.
      const { count } = await tx.tetrisRun.updateMany({
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
      after(() => notifyLeaderboardPrize(run.userId, "Petris", rank, prize))
    }
  }

  return awarded
}
