import { describe, it, expect, vi } from "vitest"

// Partial-mock fairness with a spy that delegates to the REAL floats() implementation — this
// is what makes the float-budget assertion below meaningful. Mocking playAviaRound or
// deriveAviamasters would defeat the point.
const floatsSpy = vi.hoisted(() => vi.fn())
vi.mock("@/lib/casino/fairness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/casino/fairness")>()
  floatsSpy.mockImplementation(actual.floats)
  return { ...actual, floats: floatsSpy }
})

import { floats } from "@/lib/casino/fairness"
import { AVIA_STEPS, playAviaRound, deriveAviamasters } from "@/lib/casino/aviamasters"

// Same golden triple every shipped casino test reuses.
const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

describe("float budget", () => {
  it("float budget: exactly 16 floats requested on both a landing nonce and a crashing nonce", async () => {
    let landingNonce: number | undefined
    let crashingNonce: number | undefined
    for (let nonce = 1; nonce <= 500 && (landingNonce === undefined || crashingNonce === undefined); nonce++) {
      const round = await deriveAviamasters({ ...GOLDEN_SEED, nonce })
      if (round.landed && landingNonce === undefined) landingNonce = nonce
      if (!round.landed && crashingNonce === undefined) crashingNonce = nonce
    }
    expect(landingNonce).toBeDefined()
    expect(crashingNonce).toBeDefined()

    floatsSpy.mockClear()
    await deriveAviamasters({ ...GOLDEN_SEED, nonce: landingNonce! })
    expect(floatsSpy).toHaveBeenLastCalledWith(expect.anything(), AVIA_STEPS)

    floatsSpy.mockClear()
    await deriveAviamasters({ ...GOLDEN_SEED, nonce: crashingNonce! })
    expect(floatsSpy).toHaveBeenLastCalledWith(expect.anything(), AVIA_STEPS)
  })
})

describe("round-trip", () => {
  it("round-trip: deriveAviamasters(seed) === playAviaRound(await floats(seed, 16)) over 200 nonces", async () => {
    const failures: string[] = []
    for (let nonce = 1; nonce <= 200; nonce++) {
      const seed = { ...GOLDEN_SEED, nonce }
      const derived = await deriveAviamasters(seed)
      const replayed = playAviaRound(await floats(seed, AVIA_STEPS))
      if (
        derived.multiplier !== replayed.multiplier ||
        derived.landed !== replayed.landed ||
        derived.steps.length !== replayed.steps.length
      ) {
        failures.push(`nonce=${nonce}`)
      }
    }
    expect(failures).toEqual([])
  })
})
