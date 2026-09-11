// Dice's pure-math proof (DICE-01..04). The "EV sweep" describe below is the phase's whole
// proof of correctness: the target cancels in BOTH modes only if the outcome space is exactly
// 10001 and the comparisons are strict — see 13-RESEARCH.md § Dice Core Math. The truncated
// variant ("EV sweep truncated") is deliberately BOUNDED, not exact: the 4dp multiplier
// truncation costs at most 9.679e-5 EV at the worst target, so an exact assertion there would be
// wrong (13-RESEARCH.md § Validation Architecture, note under "The decisive test").

import { describe, it, expect } from "vitest"
import {
  DICE_OUTCOMES,
  CHANCE_H_MIN,
  CHANCE_H_MAX,
  diceMultiplier,
  chanceHFor,
  diceWin,
  fromChanceH,
  deriveDice,
} from "@/lib/casino/dice"
import { floats } from "@/lib/casino/fairness"

// Same golden triple every shipped casino test reuses.
const GOLDEN = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

describe("roll space", () => {
  it("roll space: DICE_OUTCOMES is exactly 10001", () => {
    expect(DICE_OUTCOMES).toBe(10001)
  })

  it("roll space: floor((i/10001 + eps) * 10001) === i for every i in 0..10000", () => {
    const mismatches: number[] = []
    for (let i = 0; i <= 10000; i++) {
      const got = Math.floor((i / 10001 + 1e-12) * DICE_OUTCOMES)
      if (got !== i) mismatches.push(i)
    }
    expect(mismatches).toEqual([])
  })

  it("roll space: 100.00 is reachable — i = 10000 yields rollH 10000 and roll 100", () => {
    const f = 10000 / 10001 + 1e-12
    const rollH = Math.floor(f * DICE_OUTCOMES)
    expect(rollH).toBe(10000)
    expect(rollH / 100).toBe(100)
  })

  it("roll space: deriveDice on the golden triple uses ONE float at cursor 0 and the 10001 factor", async () => {
    const result = await deriveDice(GOLDEN, 5000, "UNDER")
    expect(result.roll).toBe(result.rollH / 100)
    expect(Number.isInteger(result.rollH)).toBe(true)
    expect(result.rollH).toBeGreaterThanOrEqual(0)
    expect(result.rollH).toBeLessThanOrEqual(10000)

    const [f] = await floats(GOLDEN, 1)
    const expectedRollH = Math.floor(f * 10001)
    expect(result.rollH).toBe(expectedRollH)

    // Pinned golden constant — run once, paste the number, keep both assertions.
    expect(result.rollH).toBe(3141)
  })
})

describe("strict", () => {
  it("strict: rollH === targetH is a LOSS in both UNDER and OVER", () => {
    for (const t of [1, 5000, 9800, 9999]) {
      expect(diceWin(t, t, "UNDER")).toBe(false)
      expect(diceWin(t, t, "OVER")).toBe(false)
    }
  })

  it("strict: one hundredth either side of the target flips the strict comparison", () => {
    for (const t of [1, 5000, 9800, 9999]) {
      expect(diceWin(t - 1, t, "UNDER")).toBe(true)
      expect(diceWin(t + 1, t, "OVER")).toBe(true)
    }
  })
})

describe("mode toggle", () => {
  it("mode toggle: UNDER/OVER targets mirror at 10000-t, chanceHFor agrees, double toggle is identity", () => {
    const mismatches: string[] = []
    for (let c = CHANCE_H_MIN; c <= CHANCE_H_MAX; c++) {
      const underTarget = c
      const overTarget = 10000 - c
      if (overTarget !== 10000 - underTarget) mismatches.push(`c=${c}: mirror`)
      if (chanceHFor(underTarget, "UNDER") !== c) mismatches.push(`c=${c}: under chanceHFor`)
      if (chanceHFor(overTarget, "OVER") !== c) mismatches.push(`c=${c}: over chanceHFor`)
      if (10000 - (10000 - underTarget) !== underTarget) mismatches.push(`c=${c}: double toggle`)
    }
    expect(mismatches).toEqual([])
  })
})

describe("triad", () => {
  it("triad: every edit path round-trips through fromChanceH for all legal chances, both modes", () => {
    const mismatches: string[] = []
    for (const mode of ["UNDER", "OVER"] as const) {
      for (let c = CHANCE_H_MIN; c <= CHANCE_H_MAX; c++) {
        const start = fromChanceH(c, mode)
        const roundTripped = fromChanceH(chanceHFor(start.targetH, mode), mode)
        if (JSON.stringify(roundTripped) !== JSON.stringify(start)) {
          mismatches.push(`${mode}/${c}: ${JSON.stringify(roundTripped)} vs ${JSON.stringify(start)}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe("snap", () => {
  // The multiplier edit path: fromChanceH(Math.round((99 / m) * 100), mode).
  function fromMultiplier(m: number, mode: "UNDER" | "OVER" = "UNDER") {
    return fromChanceH(Math.round((99 / m) * 100), mode)
  }

  it("snap: 2.0000x -> chanceH 4950, multiplier 2.0000 (no visible snap)", () => {
    const r = fromMultiplier(2.0)
    expect(r.chanceH).toBe(4950)
    expect(r.multiplier).toBe(2.0)
  })

  it("snap: 3.3333x -> chanceH 2970, multiplier 3.3333 (no visible snap)", () => {
    const r = fromMultiplier(3.3333)
    expect(r.chanceH).toBe(2970)
    expect(r.multiplier).toBe(3.3333)
  })

  it("snap: 1.01x -> 9802 clamps to chanceH 9800, multiplier snaps to 1.0102", () => {
    const r = fromMultiplier(1.01)
    expect(r.chanceH).toBe(9800)
    expect(r.multiplier).toBe(1.0102)
  })

  it("snap: 10000x -> rounds to 1 (after rounding 0.99), multiplier snaps to 9900", () => {
    const r = fromMultiplier(10000)
    expect(r.chanceH).toBe(1)
    expect(r.multiplier).toBe(9900)
  })
})

describe("clamp", () => {
  it("clamp: fromChanceH(0) and fromChanceH(-5) pin at chanceH 1", () => {
    expect(fromChanceH(0, "UNDER").chanceH).toBe(1)
    expect(fromChanceH(-5, "UNDER").chanceH).toBe(1)
  })

  it("clamp: fromChanceH(9801) and fromChanceH(99999) pin at chanceH 9800", () => {
    expect(fromChanceH(9801, "UNDER").chanceH).toBe(9800)
    expect(fromChanceH(99999, "UNDER").chanceH).toBe(9800)
  })

  it("clamp: every clamped result derives a targetH in [1,9800] UNDER and [200,9999] OVER", () => {
    const mismatches: string[] = []
    for (const rawChance of [-5, 0, 1, 9800, 9801, 99999]) {
      const under = fromChanceH(rawChance, "UNDER")
      if (under.targetH < 1 || under.targetH > 9800) mismatches.push(`UNDER ${rawChance}: targetH ${under.targetH}`)
      const over = fromChanceH(rawChance, "OVER")
      if (over.targetH < 200 || over.targetH > 9999) mismatches.push(`OVER ${rawChance}: targetH ${over.targetH}`)
    }
    expect(mismatches).toEqual([])
  })
})

describe("EV sweep", () => {
  const TRUE_EV = 9900 / 10001

  it("EV sweep: the exact 99/(chanceH/100) multiplier gives 9900/10001 for every legal target, both modes", () => {
    let maxDev = 0
    for (let targetH = 1; targetH <= 9800; targetH++) {
      const chanceH = chanceHFor(targetH, "UNDER")
      const ev = (targetH * (99 / (chanceH / 100))) / 10001
      maxDev = Math.max(maxDev, Math.abs(ev - TRUE_EV))
    }
    for (let targetH = 200; targetH <= 9999; targetH++) {
      const chanceH = chanceHFor(targetH, "OVER")
      const ev = ((10000 - targetH) * (99 / (chanceH / 100))) / 10001
      maxDev = Math.max(maxDev, Math.abs(ev - TRUE_EV))
    }
    expect(maxDev).toBeLessThan(1e-9)
  })
})

describe("EV sweep truncated", () => {
  const TRUE_EV = 9900 / 10001

  it("EV sweep truncated: diceMultiplier's 4dp truncation is bounded, never exact", () => {
    let minEv = Infinity
    let maxEv = -Infinity
    for (let targetH = 1; targetH <= 9800; targetH++) {
      const chanceH = chanceHFor(targetH, "UNDER")
      const ev = (targetH * diceMultiplier(chanceH)) / 10001
      minEv = Math.min(minEv, ev)
      maxEv = Math.max(maxEv, ev)
    }
    for (let targetH = 200; targetH <= 9999; targetH++) {
      const chanceH = chanceHFor(targetH, "OVER")
      const ev = ((10000 - targetH) * diceMultiplier(chanceH)) / 10001
      minEv = Math.min(minEv, ev)
      maxEv = Math.max(maxEv, ev)
    }
    expect(maxEv).toBeLessThanOrEqual(TRUE_EV + 1e-12)
    expect(minEv).toBeGreaterThanOrEqual(TRUE_EV - 1e-4)
  })
})

describe("bounds", () => {
  it("bounds: diceMultiplier(9800) === 1.0102, diceMultiplier(1) === 9900", () => {
    expect(diceMultiplier(9800)).toBe(1.0102)
    expect(diceMultiplier(1)).toBe(9900)
  })

  it("bounds: CHANCE_H_MIN === 1, CHANCE_H_MAX === 9800", () => {
    expect(CHANCE_H_MIN).toBe(1)
    expect(CHANCE_H_MAX).toBe(9800)
  })

  it("bounds: truncates, does not round — chanceH 13 has a 5th decimal >= 5 (761.53846...)", () => {
    const exact = 9900 / 13
    const rounded = Math.round(exact * 1e4) / 1e4
    expect(diceMultiplier(13)).not.toBe(rounded)
    expect(diceMultiplier(13)).toBe(Math.floor(exact * 1e4) / 1e4)
    expect(diceMultiplier(13)).toBe(761.5384)
  })
})

describe("uniform", () => {
  it("uniform: 2000 nonces at targetH 5000 UNDER land within 0.05 of a 50% win rate", async () => {
    let wins = 0
    const NONCES = 2000
    for (let nonce = 0; nonce < NONCES; nonce++) {
      const { win } = await deriveDice({ ...GOLDEN, nonce }, 5000, "UNDER")
      if (win) wins++
    }
    expect(Math.abs(wins / NONCES - 0.5)).toBeLessThan(0.05)
  })
})
