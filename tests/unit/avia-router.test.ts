import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the bet spine as spies, not the database — spying on openBet/settleBet is what makes
// the single-shot rule directly assertable. Never mock @/lib/casino/aviamasters or
// @/lib/casino/fairness: the real derivation is exactly what these assertions are for.
const betMock = vi.hoisted(() => ({
  openBet: vi.fn(),
  settleBet: vi.fn(),
}))

vi.mock("@/lib/casino/bet", () => betMock)
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { aviamastersRouter } from "@/trpc/routers/aviamasters"
import { deriveAviamasters } from "@/lib/casino/aviamasters"

const createCaller = createCallerFactory(aviamastersRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

// Same golden triple every shipped casino test reuses.
const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

beforeEach(() => {
  betMock.openBet.mockReset()
  betMock.settleBet.mockReset()
  betMock.openBet.mockResolvedValue({ bet: { id: "bet-1" }, seed: GOLDEN_SEED })
  betMock.settleBet.mockResolvedValue({ payout: 10, credited: true })
})

describe("aviamasters.play — single-shot", () => {
  it("single-shot: aviamastersRouter exposes exactly one procedure — no client-triggered aviamasters.settle", () => {
    expect(Object.keys(aviamastersRouter._def.procedures)).toEqual(["play"])
  })

  it("single-shot: one play call invokes openBet exactly once and settleBet exactly once", async () => {
    const caller = createCaller(ctx)
    await caller.play({ wager: 10 })

    expect(betMock.openBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
  })
})

describe("aviamasters.play — strict input boundary", () => {
  it("strict: rejects a wager carrying speed", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, speed: "HARE" } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("strict: rejects a wager carrying autoplay", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, autoplay: 25 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("strict: rejects a wager carrying a client-supplied multiplier", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, multiplier: 250 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("strict: rejects a wager carrying a client-supplied steps array", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, steps: [] } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("strict: rejects a non-integer wager (10.5)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })
})

describe("aviamasters.play — settles at the derived multiplier", () => {
  it("settles at the derived multiplier: settleBet receives the real deriveAviamasters multiplier, config is {}", async () => {
    const { multiplier } = await deriveAviamasters(GOLDEN_SEED)

    const caller = createCaller(ctx)
    await caller.play({ wager: 10 })

    expect(betMock.openBet).toHaveBeenCalledWith(
      expect.objectContaining({ game: "AVIAMASTERS", config: {} }),
    )
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({ betId: "bet-1", userId: USER_ID, wager: 10, multiplier }),
    )
  })
})

describe("aviamasters.play — water settles at 0", () => {
  it("water settles at 0: a nonce whose real derivation is a water crash settles settleBet at multiplier 0 (AVIA-03)", async () => {
    let crashingNonce: number | undefined
    for (let nonce = 1; nonce <= 500 && crashingNonce === undefined; nonce++) {
      const round = await deriveAviamasters({ ...GOLDEN_SEED, nonce })
      if (!round.landed) crashingNonce = nonce
    }
    expect(crashingNonce).toBeDefined()

    betMock.openBet.mockResolvedValue({
      bet: { id: "bet-water" },
      seed: { ...GOLDEN_SEED, nonce: crashingNonce! },
    })

    const caller = createCaller(ctx)
    await caller.play({ wager: 10 })

    expect(betMock.settleBet).toHaveBeenCalledWith(expect.objectContaining({ multiplier: 0 }))
  })
})

describe("aviamasters.play — never leaks", () => {
  it("never leaks: the response has no serverSeed at any depth and has exactly the six expected keys", async () => {
    const caller = createCaller(ctx)
    const result = await caller.play({ wager: 10 })

    expect(JSON.stringify(result)).not.toContain("serverSeed")
    expect(Object.keys(result).sort()).toEqual([
      "betId",
      "capped",
      "landed",
      "multiplier",
      "payout",
      "steps",
    ])
  })
})

describe("aviamasters.play — independent rounds", () => {
  it("independent rounds: two sequential plays with different nonces produce the two different real rounds", async () => {
    betMock.openBet
      .mockResolvedValueOnce({ bet: { id: "bet-1" }, seed: { ...GOLDEN_SEED, nonce: 1 } })
      .mockResolvedValueOnce({ bet: { id: "bet-2" }, seed: { ...GOLDEN_SEED, nonce: 2 } })

    const caller = createCaller(ctx)
    const r1 = await caller.play({ wager: 10 })
    const r2 = await caller.play({ wager: 10 })

    const expected1 = await deriveAviamasters({ ...GOLDEN_SEED, nonce: 1 })
    const expected2 = await deriveAviamasters({ ...GOLDEN_SEED, nonce: 2 })

    expect(r1.multiplier).toBe(expected1.multiplier)
    expect(r2.multiplier).toBe(expected2.multiplier)
    expect(betMock.openBet).toHaveBeenCalledTimes(2)
    expect(betMock.settleBet).toHaveBeenCalledTimes(2)
  })
})
