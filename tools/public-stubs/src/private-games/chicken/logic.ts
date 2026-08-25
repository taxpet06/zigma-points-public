// PUBLIC-MIRROR STUB. The real implementation is private (see docs/public-mirror.md).
// This file's exports must track src/private-games/chicken/logic.ts's public API — if the real
// module gains an export, add it here or the public build breaks.

import type { SeedInput } from "@/lib/casino/fairness"

/** Real value — a difficulty list carries nothing private, and the verifier parses against it. */
export const CHICKEN_DIFFICULTIES = ["EASY", "MEDIUM", "HARD", "HARDCORE"] as const
export type ChickenDifficulty = (typeof CHICKEN_DIFFICULTIES)[number]

/** Neutral: zero traps everywhere. Real counts live in the private tree. */
export const CHICKEN_TRAPS: Record<ChickenDifficulty, number> = {
  EASY: 0,
  MEDIUM: 0,
  HARD: 0,
  HARDCORE: 0,
}

/**
 * Throws rather than returning [] on purpose. [] is a *plausible* trap layout, so the verifier
 * would render a confident green "verified" for a derivation it never performed — the one
 * failure mode a provably-fair tool must not have. Throwing surfaces as "verification failed"
 * instead, which is the truth: this build cannot verify Chicken rounds.
 */
export function deriveTraps(_seed: SeedInput, _traps: number): Promise<number[]> {
  throw new Error("Chicken Cross is not available in the public build.")
}
