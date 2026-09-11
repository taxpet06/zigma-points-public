import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the bet spine as spies, not the database — this phase adds no DB logic of its own, and
// spying on openBet/settleBet is what makes the one-request rule directly assertable. Mocking
// @/lib/casino/dice or @/lib/casino/fairness would defeat the point: the real derivation is
// exactly what DICE-04's anti-cheat proof depends on.
const betMock = vi.hoisted(() => ({
  openBet: vi.fn(),
  settleBet: vi.fn(),
}))

vi.mock("@/lib/casino/bet", () => betMock)
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { diceRouter } from "@/trpc/routers/dice"
import { deriveDice } from "@/lib/casino/dice"

const createCaller = createCallerFactory(diceRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

// Same golden triple every shipped casino test reuses. rollH for this triple is 3141
// (tests/unit/dice-math.test.ts pins the same constant).
const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

beforeEach(() => {
  betMock.openBet.mockReset()
  betMock.settleBet.mockReset()
  betMock.openBet.mockResolvedValue({ bet: { id: "bet-1" }, seed: GOLDEN_SEED })
  betMock.settleBet.mockResolvedValue({ payout: 10, multiplier: 3.0937, credited: true })
})

describe("dice.play — input boundary", () => {
  const base = { wager: 10, targetH: 5000, mode: "UNDER" as const }

  it("input: rejects a non-integer wager (10.5)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, wager: 10.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects a non-integer targetH (5000.5)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, targetH: 5000.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects targetH 0", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, targetH: 0 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects targetH 10000", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, targetH: 10000 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an unrecognised mode string (\"SIDEWAYS\")", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, mode: "SIDEWAYS" } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra roll key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, roll: 42 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra win key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, win: true } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra multiplier key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, multiplier: 100 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })
})

describe("dice.play — chance bounds", () => {
  it("chance bounds: UNDER targetH 9801 rejects (chanceH 9801) before openBet is called", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, targetH: 9801, mode: "UNDER" })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("chance bounds: OVER targetH 199 rejects (chanceH 9801) before openBet is called", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, targetH: 199, mode: "OVER" })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("chance bounds: UNDER targetH 9800 succeeds (chanceH 9800, the legal max)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, targetH: 9800, mode: "UNDER" })).resolves.toBeTruthy()
    expect(betMock.openBet).toHaveBeenCalledTimes(1)
  })

  it("chance bounds: OVER targetH 200 succeeds (chanceH 9800, the legal max)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ wager: 10, targetH: 200, mode: "OVER" })).resolves.toBeTruthy()
    expect(betMock.openBet).toHaveBeenCalledTimes(1)
  })
})

describe("dice.play — settles at the derived multiplier", () => {
  it("settles at the derived multiplier: a target below the golden rollH (3141) wins and settles at the derived multiplier", async () => {
    const targetH = 3200 // golden rollH 3141 < 3200 -> UNDER win
    const { multiplier } = await deriveDice(GOLDEN_SEED, targetH, "UNDER")

    const caller = createCaller(ctx)
    await caller.play({ wager: 10, targetH, mode: "UNDER" })

    expect(betMock.openBet).toHaveBeenCalledWith(
      expect.objectContaining({ game: "DICE", config: { targetH, mode: "UNDER" } }),
    )
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({ betId: "bet-1", userId: USER_ID, wager: 10, multiplier }),
    )
  })

  it("settles at the derived multiplier: a target above the golden rollH (3141) loses and settles at multiplier 0", async () => {
    const targetH = 3000 // golden rollH 3141 is NOT < 3000 -> UNDER loss

    const caller = createCaller(ctx)
    await caller.play({ wager: 10, targetH, mode: "UNDER" })

    expect(betMock.openBet).toHaveBeenCalledWith(
      expect.objectContaining({ game: "DICE", config: { targetH, mode: "UNDER" } }),
    )
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({ betId: "bet-1", userId: USER_ID, wager: 10, multiplier: 0 }),
    )
  })
})

describe("dice.play — never leaks", () => {
  it("never leaks: the response has no serverSeed at any depth and has exactly the five expected keys", async () => {
    const caller = createCaller(ctx)
    const result = await caller.play({ wager: 10, targetH: 5000, mode: "UNDER" })

    expect(JSON.stringify(result)).not.toContain("serverSeed")
    expect(Object.keys(result).sort()).toEqual(["betId", "multiplier", "payout", "roll", "win"])
  })
})

describe("dice.play — one request", () => {
  it("one request: a single play calls openBet once and settleBet once", async () => {
    const caller = createCaller(ctx)
    await caller.play({ wager: 10, targetH: 5000, mode: "UNDER" })

    expect(betMock.openBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
  })

  it("one request: diceRouter exposes exactly one procedure — no client-triggered dice.settle", () => {
    expect(Object.keys(diceRouter._def.procedures)).toEqual(["play"])
  })
})

describe("dice.play — independent rounds", () => {
  it("independent rounds: two sequential plays each get their own nonce-derived roll", async () => {
    betMock.openBet
      .mockResolvedValueOnce({ bet: { id: "bet-1" }, seed: { ...GOLDEN_SEED, nonce: 1 } })
      .mockResolvedValueOnce({ bet: { id: "bet-2" }, seed: { ...GOLDEN_SEED, nonce: 2 } })

    const caller = createCaller(ctx)
    const r1 = await caller.play({ wager: 10, targetH: 5000, mode: "UNDER" })
    const r2 = await caller.play({ wager: 10, targetH: 5000, mode: "UNDER" })

    const expected1 = await deriveDice({ ...GOLDEN_SEED, nonce: 1 }, 5000, "UNDER")
    const expected2 = await deriveDice({ ...GOLDEN_SEED, nonce: 2 }, 5000, "UNDER")

    expect(r1.roll).toBe(expected1.roll)
    expect(r2.roll).toBe(expected2.roll)
    expect(betMock.openBet).toHaveBeenCalledTimes(2)
    expect(betMock.settleBet).toHaveBeenCalledTimes(2)
  })
})
