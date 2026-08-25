// Daily reward roll — SERVER-AUTHORITATIVE. The client never decides the outcome;
// dailyReward.claim rolls here and returns the reels, and the UI only animates them.
// Keeping the roll on the server is what stops a user from editing the payout.

// ponytail: 50/50 per reel → E[ZP] ≈ 4.25/day, P(jackpot 3 ticks) = 12.5%. This is
// the one economy knob — lower it to make wins rarer if ZP inflates. Math.random is
// fine here: it runs server-side and is never security-critical (not a token/secret).
export const TICK_PROBABILITY = 0.5

// index = number of tick reels (0..3). 1 tick → 1 ZP, 2 → 3 ZP, 3 → 5 ZP.
export const ZP_BY_TICKS = [0, 1, 3, 5] as const

/**
 * Calendar-day key ("YYYY-MM-DD") in RESET_TZ — the reset boundary and the per-user
 * unique key. Re-exports the shared day-key so the spin, Wordle, and every other
 * daily reset roll over together at local midnight.
 */
export { dayKey as todayKey } from "@/lib/day-key"

/** Rolls three independent reels. `slots` drives the animation; `zp` is the payout. */
export function rollDailyReward(): { slots: boolean[]; ticks: number; zp: number } {
  const slots = [0, 1, 2].map(() => Math.random() < TICK_PROBABILITY)
  const ticks = slots.filter(Boolean).length
  return { slots, ticks, zp: ZP_BY_TICKS[ticks] }
}
