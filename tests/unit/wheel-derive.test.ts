import { describe, it, expect } from "vitest"
import { floats } from "@/lib/casino/fairness"
import {
  WHEEL_RISKS,
  WHEEL_SEGMENTS,
  WHEEL_TABLES,
  WHEEL_TURNS,
  deriveWheel,
  wheelMultiplier,
  landingRotation,
  segmentAtPointer,
} from "@/lib/casino/wheel"

// Same golden triple every shipped casino test reuses.
const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

// The six prev probe values from 14-RESEARCH.md § Pattern 3 — includes a negative and a
// near-360 value, the two cases a naive `mod` implementation gets wrong.
const PREV_PROBES = [0, 137.3, 3600, -12.5, 1234.5678, 359.999]

describe("deriveWheel — golden derivation", () => {
  it("golden: index === floor(f * segments) for the golden seed, across all configs", async () => {
    const [f] = await floats(GOLDEN_SEED, 1)
    for (const risk of WHEEL_RISKS) {
      for (const segments of WHEEL_SEGMENTS) {
        const { index, multiplier } = await deriveWheel(GOLDEN_SEED, segments, risk)
        expect(index).toBe(Math.floor(f * segments))
        expect(multiplier).toBe(WHEEL_TABLES[risk][segments][index])
      }
    }
  })
})

describe("deriveWheel — index range sweep", () => {
  it("range: every returned index satisfies 0 <= index < segments over 200 nonces x all segment counts", async () => {
    const failures: string[] = []
    for (let nonce = 1; nonce <= 200; nonce++) {
      for (const segments of WHEEL_SEGMENTS) {
        const { index } = await deriveWheel({ ...GOLDEN_SEED, nonce }, segments, "MEDIUM")
        if (!(index >= 0 && index < segments)) failures.push(`nonce=${nonce} segments=${segments} index=${index}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe("deriveWheel — nominal RTP", () => {
  it("RTP: sum(table)/segments === 0.99 for all 15 configs", () => {
    for (const risk of WHEEL_RISKS) {
      for (const segments of WHEEL_SEGMENTS) {
        const table = WHEEL_TABLES[risk][segments]
        expect(table.reduce((a, b) => a + b, 0) / segments).toBeCloseTo(0.99, 9)
      }
    }
  })
})

describe("wheelMultiplier — throws on malformed config", () => {
  it("throws: index -1", () => {
    expect(() => wheelMultiplier("MEDIUM", 10, -1)).toThrow()
  })
  it("throws: index === segments", () => {
    expect(() => wheelMultiplier("MEDIUM", 10, 10)).toThrow()
  })
  it("throws: unknown risk", () => {
    expect(() => wheelMultiplier("RAIN" as never, 10, 0)).toThrow()
  })
  it("throws: segments 15 (not a valid config)", () => {
    expect(() => wheelMultiplier("MEDIUM", 15, 0)).toThrow()
  })
})

describe("landing round-trip identity (WHEL-02)", () => {
  it("round-trip: segmentAtPointer(landingRotation(prev, i, s), s) === i across all inputs", () => {
    const failures: string[] = []
    for (const s of WHEEL_SEGMENTS) {
      for (let i = 0; i < s; i++) {
        for (const prev of PREV_PROBES) {
          const rotation = landingRotation(prev, i, s)
          const got = segmentAtPointer(rotation, s)
          if (got !== i) failures.push(`s=${s} i=${i} prev=${prev} got=${got}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe("landing forward-only", () => {
  it("forward-only: landingRotation never returns less than prev + 360 * WHEEL_TURNS", () => {
    const failures: string[] = []
    for (const s of WHEEL_SEGMENTS) {
      for (let i = 0; i < s; i++) {
        for (const prev of PREV_PROBES) {
          const rotation = landingRotation(prev, i, s)
          if (rotation - prev < 360 * WHEEL_TURNS) failures.push(`s=${s} i=${i} prev=${prev} delta=${rotation - prev}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})
