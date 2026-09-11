// Deterministic tier-sequence engine — shared by the client renderer and the server
// router. Given a seed, produces the same tile order on both sides, which is what
// makes the server's re-derive-and-re-validate anti-cheat model possible (21-CONTEXT.md
// "Anti-cheat / server authority"). Zero React, DOM, or Prisma imports — this module
// must be able to run in Node.

import { mulberry32 } from "@/lib/seeded-rng"
import { TILE_COUNT, MAX_TIER } from "./constants"

/** Full-tier tile draw order — a permutation of [0, TILE_COUNT). Draw order is the
 *  anti-cheat's authoritative source: changing it invalidates every seed already in
 *  flight. Each tier seeds an independent mulberry32 stream (XOR'd with the tier via
 *  the same mixing constant flappy/seed.ts uses for per-index streams), so tier 2's
 *  order is unrelated to tier 1's — this is NOT a continuation of one shuffle across
 *  tiers. */
export function deriveTierSequence(seed: number, tier: number): number[] {
  const rand = mulberry32(seed ^ (tier * 2654435761))
  const tiles = Array.from({ length: TILE_COUNT }, (_, i) => i)
  // Fisher-Yates, shuffling downward from the end.
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = tiles[i]
    tiles[i] = tiles[j]
    tiles[j] = tmp
  }
  return tiles
}

/** Rounds a tier offers before it's considered fully cleared. Locked resolution from
 *  21-CONTEXT.md's "Tier-overflow handling": a tier is fully cleared the moment round
 *  floor(TILE_COUNT/tier) succeeds, even though a literal "one more round" would need
 *  more than TILE_COUNT tiles for tier >= 6. No tile ever repeats within a tier because
 *  every round's target is a prefix of the same single per-tier permutation. */
export function maxRoundsInTier(tier: number): number {
  return Math.floor(TILE_COUNT / tier)
}

/** Sequence length for a given (tier, round): the tier's per-round tile step, times
 *  the round number. Tier N starts at N tiles in round 1 and grows by +N tiles per
 *  round (21-CONTEXT.md "Core game loop"). */
export function sequenceLengthFor(tier: number, round: number): number {
  return tier * round
}

/** The exact tile sequence the player must reproduce for (seed, tier, round) — a
 *  prefix of that tier's full permutation, truncated to this round's length. Because
 *  every round of a tier is a prefix of the SAME permutation, round 2 always replays
 *  round 1's tiles then adds new ones — never reshuffled mid-tier. */
export function targetForRound(seed: number, tier: number, round: number): number[] {
  return deriveTierSequence(seed, tier).slice(0, sequenceLengthFor(tier, round))
}

/** The tier a run advances to after fully clearing the current one. Implements the
 *  locked loop-at-25 rule (21-CONTEXT.md "Tier-25 ceiling behavior"): clearing tier 25
 *  loops back to tier 1 rather than ending the run, explicitly superseding
 *  21-RESEARCH.md Open Question 2's "run ends at tier 25" default. The run's ONLY end
 *  condition is failure. */
export function nextTierAfterClear(tier: number): number {
  return tier >= MAX_TIER ? 1 : tier + 1
}

/** Pure comparison of a player's submitted taps against the expected sequence for a
 *  round. The router does no ad-hoc comparison of its own — this is the single source
 *  of truth for verdicts.
 *  - "exact": lengths match and every element matches in order — the round is won.
 *  - "prefix": taps is shorter than expected and every tap matches the corresponding
 *    expected element so far — an incomplete-but-correct-so-far answer, which the
 *    router treats as running out of time (not a wrong-tile failure).
 *  - "wrong": any element mismatch, or taps is longer than expected. */
export function tapsMatch(taps: number[], expected: number[]): "exact" | "prefix" | "wrong" {
  if (taps.length > expected.length) return "wrong"
  for (let i = 0; i < taps.length; i++) {
    if (taps[i] !== expected[i]) return "wrong"
  }
  return taps.length === expected.length ? "exact" : "prefix"
}
