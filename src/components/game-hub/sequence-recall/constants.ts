// Sequence Recall tunables — every number the game depends on. Imported by both the
// client renderer and the server router so gameplay and validation agree.
// Mirrors the Znake/Zross constants modules' organisation: economy re-export block
// first, then anti-cheat timing, then board, then motion.
// (Deliberately no source path here — Sequence Recall ships in the public mirror, and
// tools/export-public.sh fails closed on any public file citing a private one.)

// Economy — the numbers live in lib/game-economy.ts (shared with Flappy/Petris/Znake/
// Zross); re-exported here so the router/UI import sites stay unchanged. Never
// redeclare these locally (21-CONTEXT.md: "Out of scope — Any change to the shared
// economy constants... Sequence Recall adopts the existing competitive numbers").
export {
  FREE_PLAYS_PER_DAY,
  COMPETITIVE_REPLAY_COST as REPLAY_COST,
  DAILY_PRIZES,
  ALL_TIME_CROWN_ZP,
} from "@/lib/game-economy"

// Every successfully completed round is worth a FLAT +1 ZP, regardless of tier or how
// many tiles that round's sequence contains — this is intentional and was explicitly
// reaffirmed by the user when the tier-overflow question was raised (21-CONTEXT.md).
// A FREE run banks every point it scores; paid replays bank 0 — they're leaderboard-only.
export const ZP_PER_ROUND = 1

// Board
export const GRID_SIZE = 5
// TILE_COUNT = GRID_SIZE * GRID_SIZE. This is the hard sequence-length ceiling: no
// round's target sequence can ever need more tiles than the board has.
export const TILE_COUNT = 25
// Tier 26 cannot exist because its round-1 sequence would need 26 tiles — one more than
// the board holds. Clearing tier 25 LOOPS back to tier 1 rather than ending the run
// (21-CONTEXT.md "Tier-25 ceiling behavior" — the run's only end condition is failure).
export const MAX_TIER = 25

// Anti-cheat / timing
export const SWEEP_ACTIVE_AFTER_MS = 5 * 60_000 // ACTIVE runs older than this → ABANDONED

// The input window per round. FIXED and deliberately NOT scaled by sequence length
// (locked user decision, 21-CONTEXT.md). The playability tension this creates at high
// tiers is documented and accepted in 21-RESEARCH.md Pitfall 1 — do not "fix" it in code.
export const WINDOW_MS = 5000

/** The too-fast floor, checked server-side as `elapsedMs < expected.length *
 *  MIN_MS_PER_TAP`. This is its own from-scratch derivation, NOT copied from the
 *  sibling games' per-pickup derivations (those are about travel distance across a
 *  board and don't apply to a stationary tap sequence): sustained human tapping on
 *  distinct 44px+ targets bottoms out around 120ms/tap; following this codebase's
 *  established convention of taking roughly half the physical floor as the ceiling,
 *  60ms/tap leaves generous slack for a fast human while still rejecting a scripted
 *  burst (25 taps in 1.5s). */
export const MIN_MS_PER_TAP = 60

/** Added to WINDOW_MS before declaring a timeout. The server stamps the window open
 *  when `beginRound` lands, but the player only sees it open when the ack gets back —
 *  so the server's measured elapsed always exceeds the player's perceived elapsed by
 *  roughly one round-trip. 750ms covers a bad mobile RTT without meaningfully widening
 *  the window. */
export const CLOCK_SKEW_GRACE_MS = 750

// Motion/pacing (advisory client-side pacing only, explicitly NOT part of the
// anti-cheat contract — the server never trusts these). At the largest possible round
// (tier 5 round 5 = 25 tiles) full playback is 25 * (240 + 90) = 8,250ms; this pacing
// exists to maximise the player's patience budget before the fixed 5s window even starts.
export const BLINK_ON_MS = 240
export const BLINK_GAP_MS = 90
export const GO_CUE_MS = 200
export const TIER_BANNER_MS = 1200
