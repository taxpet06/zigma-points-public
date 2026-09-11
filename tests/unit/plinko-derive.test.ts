import { describe, it, expect } from "vitest"
import {
  plinkoPath,
  plinkoMultiplier,
  derivePlinko,
  bucketWidth,
  ballX,
  bucketCenterX,
  PLINKO_TABLES,
  PLINKO_RISKS,
  PLINKO_MIN_ROWS,
  PLINKO_MAX_ROWS,
} from "@/lib/casino/plinko"
import { floats } from "@/lib/casino/fairness"

// Same golden triple tests/unit/casino-fairness.test.ts already asserts a 16-row bucket of
// 6 for — reused rather than minting a new vector. 16 floats spans two HMAC rounds, which is
// what actually exercises the cursor rollover.
const seed = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

describe("derivePlinko — golden vector", () => {
  it("golden: the shipped triple lands HIGH/16 in bucket 6 at 0.2x", async () => {
    const result = await derivePlinko(seed, 16, "HIGH")
    expect(result.bucket).toBe(6)
    expect(result.path).toHaveLength(16)
    expect(result.multiplier).toBe(0.2) // HIGH[16][6], published table value
  })
})

describe("derivePlinko — path sums to the bucket", () => {
  for (const risk of PLINKO_RISKS) {
    for (let rows = PLINKO_MIN_ROWS; rows <= PLINKO_MAX_ROWS; rows++) {
      it(`path sums: ${risk}/${rows} — path reduces to the bucket`, async () => {
        const { path, bucket } = await derivePlinko(seed, rows, risk)
        expect(path.reduce((a, b) => a + b, 0)).toBe(bucket)
      })
    }
  }
})

describe("plinkoPath — bit mapping", () => {
  it("bit mapping: floor(f*2) maps [0,0.5) to 0 and [0.5,1) to 1", () => {
    expect(plinkoPath([0.4999, 0.5, 0.9999, 0], 4)).toEqual([0, 1, 1, 0])
  })

  it("bit mapping: the slice is by rows, not by input length", async () => {
    const fs = await floats(seed, 16)
    expect(plinkoPath(fs, 8)).toHaveLength(8)
  })
})

describe("derivePlinko — prefix consistency", () => {
  it("prefix: an 8-row path equals the first 8 entries of the 16-row path for the same seed", async () => {
    const eight = (await derivePlinko(seed, 8, "LOW")).path
    const sixteen = (await derivePlinko(seed, 16, "LOW")).path
    expect(eight).toEqual(sixteen.slice(0, 8))
  })
})

describe("plinkoMultiplier — table lookup", () => {
  it("multiplier lookup: returns the exact published table cell for a spot sample", () => {
    expect(plinkoMultiplier("MEDIUM", 12, 3)).toBe(PLINKO_TABLES.MEDIUM[12][3])
    expect(plinkoMultiplier("LOW", 8, 0)).toBe(PLINKO_TABLES.LOW[8][0])
    expect(plinkoMultiplier("HIGH", 16, 6)).toBe(PLINKO_TABLES.HIGH[16][6])
  })

  it("multiplier lookup: throws on an out-of-range bucket or an unpublished row count", () => {
    expect(() => plinkoMultiplier("LOW", 8, -1)).toThrow()
    expect(() => plinkoMultiplier("LOW", 8, 9)).toThrow() // bucket = rows + 1
    expect(() => plinkoMultiplier("LOW", 7, 0)).toThrow() // rows below PLINKO_MIN_ROWS
  })
})

describe("geometry — the ballX/bucketCenterX identity", () => {
  const W = 328

  // Pure, DOM-free — this is the automatable form of PLNK-02. If the animation ever drifts
  // from the server's answer, this identity is what broke.
  for (let rows = PLINKO_MIN_ROWS; rows <= PLINKO_MAX_ROWS; rows++) {
    it(`geometry: rows=${rows} — ballX at the final row equals bucketCenterX for every bucket`, () => {
      for (let bucket = 0; bucket <= rows; bucket++) {
        expect(ballX(W, rows, rows, bucket)).toBeCloseTo(bucketCenterX(W, rows, bucket), 10)
      }
    })
  }

  it("geometry: bucketWidth(328, 16) is 328/17, and every ball starts at the drop point", () => {
    expect(bucketWidth(328, 16)).toBeCloseTo(328 / 17, 10)
    for (let rows = PLINKO_MIN_ROWS; rows <= PLINKO_MAX_ROWS; rows++) {
      expect(ballX(W, rows, 0, 0)).toBeCloseTo(W / 2, 10)
    }
  })
})
