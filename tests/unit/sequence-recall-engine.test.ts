import { describe, it, expect } from "vitest"
import {
  deriveTierSequence,
  maxRoundsInTier,
  sequenceLengthFor,
  targetForRound,
  nextTierAfterClear,
  tapsMatch,
} from "@/components/game-hub/sequence-recall/engine"
import { TILE_COUNT, MAX_TIER } from "@/components/game-hub/sequence-recall/constants"

describe("sequence-recall engine — determinism", () => {
  it("the same (seed, tier) always produces the same 25-tile order", () => {
    const a = deriveTierSequence(12345, 3)
    const b = deriveTierSequence(12345, 3)
    expect(a).toEqual(b)
  })

  it("different tiers of the same seed produce independent orders", () => {
    const tier3 = deriveTierSequence(12345, 3)
    const tier4 = deriveTierSequence(12345, 4)
    expect(tier3).not.toEqual(tier4)
  })
})

describe("sequence-recall engine — permutation property", () => {
  it("every derived sequence is a permutation of [0, TILE_COUNT) — no repeats, no gaps", () => {
    const seeds = [1, 2, 42, 999, 123456]
    const tiers = [1, 2, 5, 13, 24, 25]
    for (const seed of seeds) {
      for (const tier of tiers) {
        const seq = deriveTierSequence(seed, tier)
        expect(seq.length).toBe(TILE_COUNT)
        const sorted = [...seq].sort((x, y) => x - y)
        expect(sorted).toEqual(Array.from({ length: TILE_COUNT }, (_, i) => i))
      }
    }
  })
})

describe("sequence-recall engine — round cap (floor(25/tier))", () => {
  it("maxRoundsInTier matches the locked floor(TILE_COUNT/tier) rule", () => {
    expect(maxRoundsInTier(1)).toBe(25)
    expect(maxRoundsInTier(5)).toBe(5)
    expect(maxRoundsInTier(6)).toBe(4)
    expect(maxRoundsInTier(13)).toBe(1)
    expect(maxRoundsInTier(25)).toBe(1)
  })

  it("no tier's final round ever needs more than TILE_COUNT tiles (the overflow ceiling)", () => {
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const finalRound = maxRoundsInTier(tier)
      expect(sequenceLengthFor(tier, finalRound)).toBeLessThanOrEqual(TILE_COUNT)
    }
  })
})

describe("sequence-recall engine — targetForRound", () => {
  it("returns exactly tier * round elements and is a prefix of the tier's full permutation", () => {
    const cases: Array<[seed: number, tier: number, round: number]> = [
      [1, 1, 1],
      [1, 2, 2],
      [7, 3, 3],
      [7, 6, 4], // largest round of tier 6 (maxRoundsInTier(6) === 4)
      [99, 25, 1], // largest round of tier 25 (maxRoundsInTier(25) === 1)
    ]
    for (const [seed, tier, round] of cases) {
      const target = targetForRound(seed, tier, round)
      const full = deriveTierSequence(seed, tier)
      expect(target.length).toBe(tier * round)
      expect(target).toEqual(full.slice(0, tier * round))
    }
  })
})

describe("sequence-recall engine — tier-25 loop", () => {
  it("advances tiers 1..24 by +1", () => {
    expect(nextTierAfterClear(1)).toBe(2)
    expect(nextTierAfterClear(24)).toBe(25)
  })

  // Failure — not clearing tier 25 — is the run's only terminal condition
  // (21-CONTEXT.md "Tier-25 ceiling behavior"). Clearing tier 25 loops back to
  // tier 1 and the run stays ACTIVE.
  it("loops tier 25 back to tier 1 instead of ending the run", () => {
    expect(nextTierAfterClear(25)).toBe(1)
  })
})

describe("sequence-recall engine — tapsMatch", () => {
  it("returns 'exact' for a fully correct, same-length answer", () => {
    expect(tapsMatch([1, 2, 3], [1, 2, 3])).toBe("exact")
  })

  it("returns 'prefix' for a correct-but-short answer", () => {
    expect(tapsMatch([1, 2], [1, 2, 3])).toBe("prefix")
  })

  it("returns 'wrong' for a right-tiles-wrong-order answer", () => {
    expect(tapsMatch([2, 1, 3], [1, 2, 3])).toBe("wrong")
  })

  it("returns 'wrong' for a single wrong tile at the last position", () => {
    expect(tapsMatch([1, 2, 9], [1, 2, 3])).toBe("wrong")
  })

  it("returns 'wrong' for an over-long taps array", () => {
    expect(tapsMatch([1, 2, 3, 4], [1, 2, 3])).toBe("wrong")
  })
})
