import { describe, it, expect } from "vitest"
import { WHEEL_TABLES, WHEEL_RISKS, WHEEL_SEGMENTS } from "@/lib/casino/wheel"

// Published value:count distributions, transcribed literally from 14-RESEARCH.md § Pattern 0.
// This is NOT derived from WHEEL_TABLES — a distribution computed from the implementation would
// assert nothing. LOW and HIGH are generated tables, so this is what actually validates them
// (the sum invariant below is vacuously true for a generated table).
const PUBLISHED: Record<string, Record<string, number>> = {
  "LOW/10": { "0": 2, "1.2": 7, "1.5": 1 },
  "LOW/20": { "0": 4, "1.2": 14, "1.5": 2 },
  "LOW/30": { "0": 6, "1.2": 21, "1.5": 3 },
  "LOW/40": { "0": 8, "1.2": 28, "1.5": 4 },
  "LOW/50": { "0": 10, "1.2": 35, "1.5": 5 },
  "MEDIUM/10": { "0": 5, "1.5": 2, "1.9": 1, "2": 1, "3": 1 },
  "MEDIUM/20": { "0": 10, "1.5": 2, "1.8": 1, "2": 6, "3": 1 },
  "MEDIUM/30": { "0": 15, "1.5": 6, "1.7": 1, "2": 6, "3": 1, "4": 1 },
  "MEDIUM/40": { "0": 20, "1.5": 8, "1.6": 1, "2": 7, "3": 4 },
  "MEDIUM/50": { "0": 25, "1.5": 13, "2": 8, "3": 3, "5": 1 },
  "HIGH/10": { "0": 9, "9.9": 1 },
  "HIGH/20": { "0": 19, "19.8": 1 },
  "HIGH/30": { "0": 29, "29.7": 1 },
  "HIGH/40": { "0": 39, "39.6": 1 },
  "HIGH/50": { "0": 49, "49.5": 1 },
}

describe("WHEEL_TABLES — 15-table sweep", () => {
  for (const risk of WHEEL_RISKS) {
    for (const segments of WHEEL_SEGMENTS) {
      it(`sweep: ${risk}/${segments} — length, sum, distribution`, () => {
        const table = WHEEL_TABLES[risk][segments]

        expect(table).toHaveLength(segments)

        // Sum invariant — tolerance, not exact: these are float literals.
        expect(table.reduce((a, b) => a + b, 0)).toBeCloseTo(0.99 * segments, 9)

        // Distribution invariant — validates the GENERATED LOW/HIGH families, for which the
        // sum assertion alone is vacuous.
        const observed = new Map<number, number>()
        for (const m of table) observed.set(m, (observed.get(m) ?? 0) + 1)
        const observedEntries = [...observed.entries()].sort((a, b) => a[0] - b[0])

        const published = PUBLISHED[`${risk}/${segments}`]
        const publishedEntries = Object.entries(published)
          .map(([k, v]) => [Number(k), v] as [number, number])
          .sort((a, b) => a[0] - b[0])

        expect(observedEntries).toEqual(publishedEntries)
      })
    }
  }
})

describe("WHEEL_TABLES — balancing regressions", () => {
  it("balancing: MEDIUM/10 contains exactly one 1.9", () => {
    expect(WHEEL_TABLES.MEDIUM[10].filter((m) => m === 1.9)).toHaveLength(1)
  })
  it("balancing: MEDIUM/20 contains exactly one 1.8", () => {
    expect(WHEEL_TABLES.MEDIUM[20].filter((m) => m === 1.8)).toHaveLength(1)
  })
  it("balancing: MEDIUM/30 contains exactly one 1.7", () => {
    expect(WHEEL_TABLES.MEDIUM[30].filter((m) => m === 1.7)).toHaveLength(1)
  })
  it("balancing: MEDIUM/40 contains exactly one 1.6", () => {
    expect(WHEEL_TABLES.MEDIUM[40].filter((m) => m === 1.6)).toHaveLength(1)
  })
  it("balancing: MEDIUM/50 contains exactly one 5", () => {
    expect(WHEEL_TABLES.MEDIUM[50].filter((m) => m === 5)).toHaveLength(1)
  })
})

describe("WHEEL_TABLES — no extra", () => {
  it("no extra: WHEEL_TABLES exposes exactly LOW, MEDIUM, HIGH — never RAIN", () => {
    expect(Object.keys(WHEEL_TABLES)).toEqual(["LOW", "MEDIUM", "HIGH"])
    expect(Object.keys(WHEEL_TABLES)).not.toContain("RAIN")
    expect("RAIN" in WHEEL_TABLES).toBe(false)
  })

  it("no extra: every risk's segment keys are exactly 10..50", () => {
    const expectedKeys = WHEEL_SEGMENTS.map(String)
    for (const risk of WHEEL_RISKS) {
      expect(Object.keys(WHEEL_TABLES[risk])).toEqual(expectedKeys)
    }
  })
})

describe("WHEEL_TABLES — HIGH jackpot regression", () => {
  const JACKPOTS: Record<number, number> = { 10: 9.9, 20: 19.8, 30: 29.7, 40: 39.6, 50: 49.5 }

  for (const segments of WHEEL_SEGMENTS) {
    it(`jackpot: HIGH/${segments} ends in ${JACKPOTS[segments]}, every other entry 0`, () => {
      const table = WHEEL_TABLES.HIGH[segments]
      expect(table[table.length - 1]).toBeCloseTo(JACKPOTS[segments], 9)
      expect(table.slice(0, -1).every((m) => m === 0)).toBe(true)
    })
  }
})
