import { describe, it, expect } from "vitest"
import { AVIA_STEPS, AVIA_MAX_MULT, AVIA_MODEL, playAviaRound } from "@/lib/casino/aviamasters"

// The RTP band (±1pp around 97%) and the >=25x share band below are the CONTRACT this suite
// enforces. AVIA_MODEL's constants are merely one solution to that contract, tuned by
// Monte-Carlo in 16-RESEARCH.md § The Spawn Model — a future re-tune of any knob is legitimate
// and must keep both bands green. Never hardcode a passing constant here; assert the contract.

// Crafted float arrays are built from AVIA_MODEL's own band boundaries, never magic numbers, so
// a legitimate re-tune of a constant does not silently invalidate these cases (16-01-PLAN Task 1).
function pPick(alt: number): number {
  return Math.min(AVIA_MODEL.pickCap, AVIA_MODEL.pickScale * (1 + AVIA_MODEL.altGain * alt))
}

// Anything below rocketBase is a ROCKET float, regardless of altitude.
function rocketFloat(): number {
  return AVIA_MODEL.rocketBase / 2
}

// rocketBase + pickCap + dropBase <= 0.73 for every legal altitude, so 0.999 is always LEVEL.
function levelFloat(): number {
  return 0.999
}

// Fractional position (0..1) of `value`'s band, centred at its midpoint — table-driven so a
// re-tuned weight still lands inside its own band.
function cumulativeMid(table: readonly (readonly [number, number])[], value: number): number {
  let acc = 0
  for (const [v, w] of table) {
    if (v === value) return acc + w / 2
    acc += w
  }
  throw new Error(`value ${value} not found in table`)
}

function pickupFloat(alt: number, g: number): number {
  return AVIA_MODEL.rocketBase + g * pPick(alt)
}

function mulPickupFloat(alt: number, value: number): number {
  return pickupFloat(alt, AVIA_MODEL.mulShare * cumulativeMid(AVIA_MODEL.mulTable, value))
}

function addPickupFloat(alt: number, value: number): number {
  const g = AVIA_MODEL.mulShare + (1 - AVIA_MODEL.mulShare) * cumulativeMid(AVIA_MODEL.addTable, value)
  return pickupFloat(alt, g)
}

// A chain of `count` multiplicative pickups of `value`, tracking altitude the same way the
// real model advances it (pickRise per pickup, capped at altMax) so each crafted float is
// derived against the alt it will actually be evaluated at.
function chainOfMulPickups(count: number, value: number): number[] {
  const fs: number[] = []
  let alt: number = AVIA_MODEL.altStart
  for (let i = 0; i < count; i++) {
    fs.push(mulPickupFloat(alt, value))
    alt = Math.min(alt + AVIA_MODEL.pickRise, AVIA_MODEL.altMax)
  }
  return fs
}

// Fixed-seed xorshift32 — deterministic, never Math.random(), so the 2M-round test never
// flakes. Seed is an arbitrary fixed 32-bit constant.
function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

describe("weights", () => {
  it("weights: addTable and mulTable sum to exactly 1 and carry the official BGaming values in order", () => {
    const addSum = AVIA_MODEL.addTable.reduce((a, [, w]) => a + w, 0)
    const mulSum = AVIA_MODEL.mulTable.reduce((a, [, w]) => a + w, 0)
    expect(addSum).toBeCloseTo(1, 9)
    expect(mulSum).toBeCloseTo(1, 9)
    expect(AVIA_MODEL.addTable.map(([v]) => v)).toEqual([1, 2, 5, 10])
    expect(AVIA_MODEL.mulTable.map(([v]) => v)).toEqual([2, 3, 4, 5])
  })
})

describe("events", () => {
  it("events: 16 LEVEL floats leave the counter at exactly 1.00 and land", () => {
    const fs = Array<number>(AVIA_STEPS).fill(levelFloat())
    const round = playAviaRound(fs)
    expect(round.multiplier).toBe(1)
    expect(round.steps.length).toBe(AVIA_STEPS)
    expect(round.landed).toBe(true)
  })

  it("events: one ROCKET then LEVEL for the rest halves the counter and drops altitude by rocketDrop", () => {
    const fs = [rocketFloat(), ...Array<number>(AVIA_STEPS - 1).fill(levelFloat())]
    const round = playAviaRound(fs)
    expect(round.multiplier).toBe(0.5)
    expect(round.landed).toBe(true)
    expect(round.steps.at(-1)!.altitude).toBe(AVIA_MODEL.altStart - AVIA_MODEL.rocketDrop)
  })

  it("events: one additive +1 pickup raises the counter to 2.00 and altitude by pickRise", () => {
    const fs = [addPickupFloat(AVIA_MODEL.altStart, 1), ...Array<number>(AVIA_STEPS - 1).fill(levelFloat())]
    const round = playAviaRound(fs)
    expect(round.multiplier).toBe(2)
    expect(round.landed).toBe(true)
    expect(round.steps.at(-1)!.altitude).toBe(AVIA_MODEL.altStart + AVIA_MODEL.pickRise)
  })
})

describe("water", () => {
  it("water: three ROCKETs drive altitude to <=0, paying 0 with a positive final counter", () => {
    const fs = [rocketFloat(), rocketFloat(), rocketFloat(), ...Array<number>(AVIA_STEPS - 3).fill(levelFloat())]
    const round = playAviaRound(fs)
    expect(round.landed).toBe(false)
    expect(round.multiplier).toBe(0)
    expect(round.steps.length).toBeLessThan(AVIA_STEPS)
    // Proves the loss is the water rule, not merely a zeroed counter (AVIA-03).
    expect(round.steps.at(-1)!.counter).toBeGreaterThan(0)
  })

  it("water: a counter above 20 from a pickup chain still pays 0 once altitude rockets to <=0 (AVIA-03)", () => {
    const fs = [
      ...chainOfMulPickups(2, 5), // 1 -> 5 -> 25, counter > 20 before the water
      rocketFloat(),
      rocketFloat(),
      rocketFloat(),
      rocketFloat(),
      ...Array<number>(AVIA_STEPS - 6).fill(levelFloat()),
    ]
    const round = playAviaRound(fs)
    expect(round.steps[1]!.counter).toBeGreaterThan(20)
    expect(round.landed).toBe(false)
    expect(round.multiplier).toBe(0)
  })
})

describe("RTP", () => {
  it("RTP + clamp: 2,000,000 fixed-seed rounds land mean in [0.960,0.980], >=25x share in [0.065%,0.085%], max clamps at 250", () => {
    const rng = makeRng(0x2f6e2b17)
    const N = 2_000_000
    let sum = 0
    let countGe25 = 0
    let max = 0
    const fs: number[] = new Array(AVIA_STEPS)
    for (let r = 0; r < N; r++) {
      for (let i = 0; i < AVIA_STEPS; i++) fs[i] = rng()
      const { multiplier } = playAviaRound(fs)
      sum += multiplier
      if (multiplier >= 25) countGe25++
      if (multiplier > max) max = multiplier
    }
    const meanMultiplier = sum / N
    const share = countGe25 / N

    expect(meanMultiplier).toBeGreaterThanOrEqual(0.96)
    expect(meanMultiplier).toBeLessThanOrEqual(0.98)
    expect(share).toBeGreaterThanOrEqual(0.00065)
    expect(share).toBeLessThanOrEqual(0.00085)
    expect(max).toBe(AVIA_MAX_MULT)
  })
})

describe("clamp", () => {
  it("clamp: AVIA_MAX_MULT is the official 250x BGaming ceiling", () => {
    expect(AVIA_MAX_MULT).toBe(250)
  })

  it("clamp: a crafted x5 pickup chain returns exactly 250 with no intermediate counter above 250", () => {
    const fs = [...chainOfMulPickups(5, 5), ...Array<number>(AVIA_STEPS - 5).fill(levelFloat())]
    const round = playAviaRound(fs)
    expect(round.multiplier).toBe(250)
    for (const step of round.steps) expect(step.counter).toBeLessThanOrEqual(250)
  })
})
