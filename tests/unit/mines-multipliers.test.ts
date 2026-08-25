import { describe, it, expect } from "vitest"
import { minesMultiplier, MINES_TILES, MINES_MIN, MINES_MAX } from "@/lib/casino/mines"

// The full published Stake Mines table (12-RESEARCH.md § Fixture table), re-verified by exact
// integer-binomial execution in that research session. 11 mine-count rows x 8 sampled k columns =
// 88 cells; null = "more gems requested than exist" (k > 25 - mines), asserted to throw below.
const K_COLS = [1, 2, 3, 5, 10, 15, 20, 24] as const

const FIXTURE: Record<number, Record<number, number | null>> = {
  1: { 1: 1.03, 2: 1.08, 3: 1.13, 5: 1.24, 10: 1.65, 15: 2.48, 20: 4.95, 24: 24.75 },
  2: { 1: 1.08, 2: 1.17, 3: 1.29, 5: 1.56, 10: 2.83, 15: 6.6, 20: 29.7, 24: null },
  3: { 1: 1.13, 2: 1.29, 3: 1.48, 5: 2.0, 10: 5.0, 15: 18.98, 20: 227.7, 24: null },
  4: { 1: 1.18, 2: 1.41, 3: 1.71, 5: 2.58, 10: 9.17, 15: 59.64, 20: 2504.7, 24: null },
  5: { 1: 1.24, 2: 1.56, 3: 2.0, 5: 3.39, 10: 17.52, 15: 208.73, 20: 52598.7, 24: null },
  7: { 1: 1.38, 2: 1.94, 3: 2.79, 5: 6.14, 10: 73.95, 15: 3965.78, 20: null, 24: null },
  10: { 1: 1.65, 2: 2.83, 3: 5.0, 5: 17.52, 10: 1077.61, 15: 3236072.4, 20: null, 24: null },
  12: { 1: 1.9, 2: 3.81, 3: 7.96, 5: 40.87, 10: 11314.94, 15: null, 20: null, 24: null },
  15: { 1: 2.48, 2: 6.6, 3: 18.98, 5: 208.73, 10: 3236072.4, 15: null, 20: null, 24: null },
  20: { 1: 4.95, 2: 29.7, 3: 227.7, 5: 52598.7, 10: null, 15: null, 20: null, 24: null },
  24: { 1: 24.75, 2: null, 3: null, 5: null, 10: null, 15: null, 20: null, 24: null },
}

describe("minesMultiplier — 88-cell fixture sweep", () => {
  const mineCounts = Object.keys(FIXTURE).map(Number)

  it("fixture shape: 11 mine-count rows x 8 k columns, 63 defined + 25 null", () => {
    expect(mineCounts).toHaveLength(11)
    let defined = 0
    let nulls = 0
    for (const m of mineCounts) {
      for (const k of K_COLS) {
        if (FIXTURE[m][k] === null) nulls++
        else defined++
      }
    }
    expect(defined).toBe(63)
    expect(nulls).toBe(25)
  })

  for (const m of mineCounts) {
    for (const k of K_COLS) {
      const expected = FIXTURE[m][k]
      if (expected === null) {
        it(`throws: (${m}, ${k}) — k exceeds the 25 - ${m} gems that exist`, () => {
          expect(() => minesMultiplier(m, k)).toThrow()
        })
      } else {
        it(`matches: (${m}, ${k}) === ${expected}`, () => {
          expect(minesMultiplier(m, k)).toBe(expected)
        })
      }
    }
  }
})

describe("named rounding regressions", () => {
  it("rounds, does not floor: (1,2)=1.08 and (3,5)=2.00", () => {
    expect(minesMultiplier(1, 2)).toBe(1.08) // floor gives 1.07
    expect(minesMultiplier(3, 5)).toBe(2.0) // floor gives 1.99
  })

  it("exact half-way: (3,15) and (15,3) are BOTH 18.98", () => {
    // The naive float-product form lands 18.974999999999998 on (3,15) and exactly 18.975 on
    // (15,3) — one cell fails while its mathematical twin passes. Exact integer binomials must
    // agree on both.
    expect(minesMultiplier(3, 15)).toBe(18.98)
    expect(minesMultiplier(15, 3)).toBe(18.98)
  })

  it("max win identity: minesMultiplier(12, 13) is exactly 5148297", () => {
    expect(minesMultiplier(12, 13)).toBe(5148297)
  })
})

describe("symmetry", () => {
  it("symmetry: mult(m,k) === mult(k,m) for every pair where both are defined", () => {
    const mismatches: string[] = []
    for (let m = 1; m <= 24; m++) {
      for (let k = 1; k <= 24; k++) {
        if (k > 25 - m) continue // mult(m,k) undefined; mult(k,m) undefined too (same condition)
        const a = minesMultiplier(m, k)
        const b = minesMultiplier(k, m)
        if (a !== b) mismatches.push(`(${m},${k})=${a} vs (${k},${m})=${b}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe("closed forms", () => {
  it("closed form, one gem: mult(m,1) === round2(0.99 * 25 / (25 - m))", () => {
    const mismatches: string[] = []
    for (let m = 1; m <= 24; m++) {
      const expected = Math.round((99 * 25) / (25 - m)) / 100
      const actual = minesMultiplier(m, 1)
      if (actual !== expected) mismatches.push(`m=${m}: ${actual} vs ${expected}`)
    }
    expect(mismatches).toEqual([])
  })
})

describe("BigInt oracle — all 300 valid (m,k) pairs", () => {
  // An independently-implemented reference: a local BigInt nCk sharing zero code with mines.ts.
  // BigInt(...) rather than the `99n` literal suffix — this repo's tsconfig targets ES2017,
  // which rejects BigInt literal syntax under `tsc --noEmit`; the constructor form is identical
  // at runtime and needs no target bump.
  function nCk(n: number, k: number): bigint {
    if (k < 0 || k > n) return BigInt(0)
    let r = BigInt(1)
    for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1)
    return r
  }

  it("oracle: every valid (m,k) matches an independent BigInt half-up computation", () => {
    const mismatches: string[] = []
    let pairs = 0
    for (let m = 1; m <= 24; m++) {
      for (let k = 1; k <= 25 - m; k++) {
        pairs++
        const num = BigInt(99) * nCk(25, k) // 0.99 * 100 = 99, to round to 2dp via half-up cents
        const den = nCk(25 - m, k)
        const cents = (num + den / BigInt(2)) / den
        const expected = Number(cents) / 100
        const actual = minesMultiplier(m, k)
        if (actual !== expected) mismatches.push(`(${m},${k}): ${actual} vs ${expected}`)
      }
    }
    expect(pairs).toBe(300)
    expect(mismatches).toEqual([])
  })
})

describe("bounds", () => {
  it("bounds: constants are 25/1/24", () => {
    expect(MINES_TILES).toBe(25)
    expect(MINES_MIN).toBe(1)
    expect(MINES_MAX).toBe(24)
  })

  it("bounds: minesMultiplier(0, 1) and minesMultiplier(25, 1) throw", () => {
    expect(() => minesMultiplier(0, 1)).toThrow()
    expect(() => minesMultiplier(25, 1)).toThrow()
  })
})
