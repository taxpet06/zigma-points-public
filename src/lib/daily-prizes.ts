// End-of-day leaderboard prize helpers, shared by every game with a daily leaderboard
// (Flappy, Petris). Game-agnostic and face-free — the per-game award functions that
// query a specific run table live next to their game.

import { DAILY_PRIZES } from "@/lib/game-economy"

/** True when a just-ended run of `score` makes its user the sole all-time #1 for the
 *  first time: strictly ahead of every OTHER user's best (`othersBest`) AND not already
 *  ahead of them before this run (`myBestBefore`). Pass -1 for "no qualifying runs".
 *  Strict-exceed means a tie never counts as taking first, and beating your own record
 *  while already #1 pays nothing — you have to actually take the crown from someone. */
export function claimsAllTimeCrown(score: number, othersBest: number, myBestBefore: number): boolean {
  return score > 0 && score > othersBest && myBestBefore <= othersBest
}

/** Dedupe ranked runs to one entry per user (their best), take the top prizes.length,
 *  and assign each a prize + rank. Pure — the ordering/idempotency live in the caller. */
export function pickDailyWinners<T extends { userId: string }>(
  rankedRuns: T[],
  prizes: number[] = DAILY_PRIZES,
): { run: T; rank: number; prize: number }[] {
  const seen = new Set<string>()
  const winners: { run: T; rank: number; prize: number }[] = []
  for (const run of rankedRuns) {
    if (seen.has(run.userId)) continue // already counted this user's best run
    seen.add(run.userId)
    winners.push({ run, rank: winners.length + 1, prize: prizes[winners.length] })
    if (winners.length === prizes.length) break
  }
  return winners
}
