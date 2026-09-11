// Daily reward roll — SERVER-AUTHORITATIVE. The client never decides the outcome;
// dailyReward.claim rolls here and returns the reels, and the UI only animates them.
// Keeping the roll on the server is what stops a user from editing the payout.

// ponytail: 50/50 per reel, so ticks ~ Binomial(3, 0.5): P(0)=1/8, P(1)=3/8, P(2)=3/8,
// P(3)=1/8. This is the one economy knob — lower it to make wins rarer if ZP inflates.
// Math.random is fine here: it runs server-side and is never security-critical.
export const TICK_PROBABILITY = 0.5

// index = number of tick reels (0..3). 1 tick → 0 ZP, 2 → 2 ZP, 3 → 6 ZP.
//
// E[payout] = 0(1/8) + 0(3/8) + 2(3/8) + 6(1/8) = 1.5 ZP per spin, against a
// SLOTS_REPLAY_COST of 2 — so a replay is -0.5 ZP on average and spinning is a cost,
// not an income. Raise the tiers only while E stays below the cost (3/8·t2 + 1/8·t3 < 2).
// (Was [0,0,1,3], E = 0.75.) The earlier [0,1,3,5] paid E = 2.125 against the same 2 ZP cost:
// +0.125 per spin, which made the machine a money printer for anyone willing to
// automate it. One account took 645,507 spins in a single term on those odds.
// (The old comments here and in game-economy.ts both claimed E ≈ 4.25; that was
// simply wrong — it is double the real figure.)
export const ZP_BY_TICKS = [0, 0, 2, 6] as const

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
