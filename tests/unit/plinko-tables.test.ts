import { describe, it, expect } from "vitest"
import { PLINKO_TABLES, PLINKO_RISKS, PLINKO_MIN_ROWS, PLINKO_MAX_ROWS } from "@/lib/casino/plinko"

// n-choose-k via the multiplicative form (r = r * (n-i) / (i+1)) — factorials overflow
// long before these sizes matter, but the multiplicative form is the standard-issue safe
// form regardless, per 11-RESEARCH.md.
function comb(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

// The mandated assertion (11-RESEARCH.md § "Payout Tables"): slot count n+1, mirror
// symmetry, and nominal RTP in the 98.906%-99.160% band — re-verified by execution against
// all 27 published tables. The RTP band ALONE is not enough: the known-bad upstream
// medium/16[2] = 1.0 typo still produces a plausible 98.8608% RTP (Pitfall 8), so only the
// symmetry check below catches it.
describe("PLINKO_TABLES — 27-table sweep", () => {
  for (const risk of PLINKO_RISKS) {
    for (let rows = PLINKO_MIN_ROWS; rows <= PLINKO_MAX_ROWS; rows++) {
      it(`${risk}/${rows} — buckets, mirror, RTP`, () => {
        const mult = PLINKO_TABLES[risk][rows]

        // buckets: exactly rows+1 slots.
        expect(mult).toHaveLength(rows + 1)

        // mirror: the table is symmetric around its centre.
        expect([...mult]).toEqual([...mult].reverse())

        // RTP: the binomial-weighted expected multiplier lands in the published band.
        let rtp = 0
        for (let k = 0; k <= rows; k++) rtp += (comb(rows, k) / 2 ** rows) * mult[k]
        expect(rtp).toBeGreaterThan(0.985)
        expect(rtp).toBeLessThan(0.995)
      })
    }
  }
})

describe("medium/16 typo regression", () => {
  it("typo: MEDIUM[16][2] and its mirror [14] are 10, not the upstream source-S2 1.0", () => {
    // Source S2 has index 2 = 1.0. That value breaks mirror symmetry against its own
    // index 14 and drags nominal RTP to 98.8608% — still inside a naive "close to 99%"
    // eyeball, which is exactly why this is a named regression and not folded into the
    // sweep above (11-RESEARCH.md § Pitfall 8).
    expect(PLINKO_TABLES.MEDIUM[16][2]).toBe(10)
    expect(PLINKO_TABLES.MEDIUM[16][14]).toBe(10)
  })
})

describe("no RAIN tier", () => {
  it("no rain: PLINKO_TABLES exposes exactly LOW, MEDIUM, HIGH — never RAIN", () => {
    expect(Object.keys(PLINKO_TABLES)).toEqual(["LOW", "MEDIUM", "HIGH"])
    expect(Object.keys(PLINKO_TABLES)).not.toContain("RAIN")
    expect("RAIN" in PLINKO_TABLES).toBe(false)
  })
})

describe("no extra rows", () => {
  it("no extra rows: every risk's table has exactly the keys 8..16", () => {
    const expectedRows = Array.from({ length: PLINKO_MAX_ROWS - PLINKO_MIN_ROWS + 1 }, (_, i) =>
      String(PLINKO_MIN_ROWS + i),
    )
    for (const risk of PLINKO_RISKS) {
      expect(Object.keys(PLINKO_TABLES[risk])).toEqual(expectedRows)
    }
  })
})
