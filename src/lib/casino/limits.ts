// Casino money rules — the one place the Int-balance rounding rule, bet bounds, and payout
// cap live, so six games don't each invent their own answer.
//
// User.zigmaPoints is an Int column; every game multiplier is fractional. These constants are
// locked user decisions (10-CONTEXT.md § Economy), not tuning defaults.

import { TRPCError } from "@trpc/server"

// Raised 1 -> 5 (2026-07-22, user decision during Phase 11 research). Because payoutFor()
// floors, sub-1-ZP returns vanish: at a 1 ZP stake a 0.5x bucket pays floor(0.5) = 0, dragging
// Plinko's realised RTP to ~50.8% against a nominal ~99%. 5 ZP is the point where the low
// buckets pay something and realised RTP tracks the published tables.
export const MIN_BET = 5 // locked (10-CONTEXT.md § Economy)
// Raised 100 -> 1,000 (2026-08-03, user decision). MAX_PAYOUT moved with it to keep the same
// 100x headroom on a max bet — left at 10,000 a top stake could never win more than 10x, which
// would quietly turn every high-multiplier game (Mines/Chicken/Aviamasters/Plinko) into a
// flat-capped one at the top of the bet range.
export const MAX_BET = 1_000
export const MAX_PAYOUT = 100_000 // hard cap, applied after multiplier, regardless of game

// Safety net for abandoned in-flight rounds (Mines/Chicken), not a round timer — a round can
// legitimately sit open while the user does something else. Deliberately much longer than
// tetris's 5-minute sweep; swept lazily on the user's next openBet (no cron budget available).
export const SWEEP_ACTIVE_AFTER_MS = 24 * 60 * 60 * 1000

/** payout = min(floor(wager × multiplier), MAX_PAYOUT). Ordering is a correctness
 *  requirement, not style: floor FIRST so realised RTP can never exceed nominal, cap
 *  SECOND so one Mines round at 5,148,297x cannot mint more ZP than the economy holds. */
export function payoutFor(wager: number, multiplier: number): number {
  return Math.min(Math.floor(wager * multiplier), MAX_PAYOUT)
}

/** Server-side bound check — the rule, not a hint. Throws unless the wager is an integer
 *  (zigmaPoints is Int; a fractional stake would fractionally debit) within [MIN_BET, MAX_BET]. */
export function assertWagerInLimits(wager: number): void {
  if (!Number.isInteger(wager) || wager < MIN_BET || wager > MAX_BET) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Bet must be a whole number between ${MIN_BET} and ${MAX_BET} ZP.`,
    })
  }
}

/** Shared source of truth for the UI's ½ / 2× / Max buttons — clamps into
 *  [MIN_BET, min(MAX_BET, max(balance, MIN_BET))] and never errors, per the UI spec.
 *  ponytail: the insufficient-balance *error* state is a separate UI concern (typed input
 *  on blur), not something clampBet models — it only ever returns an in-range number. */
export function clampBet(value: number, balance: number): number {
  const ceiling = Math.min(MAX_BET, Math.max(balance, MIN_BET))
  return Math.min(ceiling, Math.max(MIN_BET, Math.floor(value)))
}

/** The conditional-debit WHERE predicate, extracted so it's assertable in a unit test
 *  without a live database (CASN-01). This WHERE clause IS the balance check: Postgres
 *  re-evaluates it after taking the row lock, so the check and the write are one
 *  statement and concurrent bets cannot overdraw. Never read the balance then write it. */
export function debitWhere(userId: string, wager: number) {
  return { id: userId, zigmaPoints: { gte: wager } }
}
