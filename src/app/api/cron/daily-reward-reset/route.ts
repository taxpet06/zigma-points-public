// Games-reset notification — call ONCE per day at 00:00 America/New_York from
// cron-job.org (set the schedule there; it's external config, not in this repo),
// same free-scheduler pattern as /api/cron/settle.
// Authorization: Bearer ${CRON_SECRET} header required.
//
// The daily spin's day-key and the Wordle word roll over on their own at midnight, so
// a new day = fresh games automatically — nothing to reset there. This route (a) pays
// out the top 3 of the Flappy, Tetris, Znake, Zross, Monkey Test and INSAMOTHERFUCKINGLLAH
// leaderboards for the day that just closed, then (b) broadcasts the "games have reset"
// push so users come back to play.

import { after } from "next/server"
import { notifyDailyRewardReady } from "@/lib/notifications"
import { awardFlappyDailyPrizes } from "@/private-games/flappy/prizes"
import { awardTetrisDailyPrizes } from "@/lib/tetris-prizes"
import { awardZnakeDailyPrizes } from "@/private-games/znake/prizes"
import { awardZrossDailyPrizes } from "@/components/game-hub/zross/prizes"
import { awardSequenceRecallDailyPrizes } from "@/components/game-hub/sequence-recall/prizes"
import { awardInsamotherfuckingllahDailyPrizes } from "@/private-games/insamotherfuckingllah/prizes"
import { previousDayKey } from "@/lib/day-key"

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const secret = authHeader?.replace("Bearer ", "")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Pay yesterday's Flappy + Tetris + Znake + Zross + Monkey Test + INSAMOTHERFUCKINGLLAH
  // leaderboard winners before the reset push. Awaited (not in after()) so the credit is
  // durable even if the runtime tears down early; it's a few small writes, well within the
  // 10s budget. All six are idempotent, so a cron retry is safe. No new cron route —
  // Vercel Hobby's 2-cron limit means every competitive game's payout rides this one.
  const day = previousDayKey()
  const prizesAwarded = await awardFlappyDailyPrizes(day)
  const tetrisPrizesAwarded = await awardTetrisDailyPrizes(day)
  const znakePrizesAwarded = await awardZnakeDailyPrizes(day)
  const zrossPrizesAwarded = await awardZrossDailyPrizes(day)
  const sequenceRecallPrizesAwarded = await awardSequenceRecallDailyPrizes(day)
  const insamotherfuckingllahPrizesAwarded = await awardInsamotherfuckingllahDailyPrizes(day)

  // Fire-and-forget after the response so a slow push fan-out never times the cron out.
  after(() => notifyDailyRewardReady())
  return Response.json({
    ok: true,
    prizesAwarded,
    tetrisPrizesAwarded,
    znakePrizesAwarded,
    zrossPrizesAwarded,
    sequenceRecallPrizesAwarded,
    insamotherfuckingllahPrizesAwarded,
  })
}
