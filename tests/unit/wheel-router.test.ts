import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the bet spine as spies, not the database — spying on openBet/settleBet is what makes
// the one-request rule directly assertable. Mocking @/lib/casino/wheel or @/lib/casino/fairness
// would defeat the point: the real derivation is exactly what the anti-cheat proof depends on.
const betMock = vi.hoisted(() => ({
  openBet: vi.fn(),
  settleBet: vi.fn(),
}))

vi.mock("@/lib/casino/bet", () => betMock)
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { wheelRouter } from "@/trpc/routers/wheel"
import { deriveWheel } from "@/lib/casino/wheel"

const createCaller = createCallerFactory(wheelRouter)
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

describe("wheel.play — input boundary", () => {
  const base = { wager: 10, segments: 30 as const, risk: "MEDIUM" as const }

  it("input: rejects a non-integer wager (10.5)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, wager: 10.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects segments 15", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, segments: 15 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects segments 0", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, segments: 0 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects segments 1000", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, segments: 1000 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects risk RAIN", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, risk: "RAIN" } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra index key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, index: 3 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra multiplier key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, multiplier: 5 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })
})

describe("wheel.play — happy path", () => {
  it("happy: all five legal segment counts and all three risks are accepted", async () => {
    const segmentsList = [10, 20, 30, 40, 50] as const
    const risks = ["LOW", "MEDIUM", "HIGH"] as const
    for (const segments of segmentsList) {
      for (const risk of risks) {
        betMock.openBet.mockClear()
        const caller = createCaller(ctx)
        await expect(caller.play({ wager: 10, segments, risk })).resolves.toBeTruthy()
        expect(betMock.openBet).toHaveBeenCalledTimes(1)
      }
    }
  })
})

describe("wheel.play — settles at the derived multiplier", () => {
  it("settles at the derived multiplier: settleBet receives the real deriveWheel multiplier, no win-branch", async () => {
    const segments = 30
    const risk = "MEDIUM" as const
    const { multiplier } = await deriveWheel(GOLDEN_SEED, segments, risk)

    const caller = createCaller(ctx)
    await caller.play({ wager: 10, segments, risk })

    expect(betMock.openBet).toHaveBeenCalledWith(
      expect.objectContaining({ game: "WHEEL", config: { segments, risk } }),
    )
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({ betId: "bet-1", userId: USER_ID, wager: 10, multiplier }),
    )
  })
})

describe("wheel.play — never leaks", () => {
  it("never leaks: the response has no serverSeed at any depth and has exactly the four expected keys", async () => {
    const caller = createCaller(ctx)
    const result = await caller.play({ wager: 10, segments: 30, risk: "MEDIUM" })

    expect(JSON.stringify(result)).not.toContain("serverSeed")
    expect(Object.keys(result).sort()).toEqual(["betId", "index", "multiplier", "payout"])
  })
})

describe("wheel.play — one request", () => {
  it("one request: a single play calls openBet once and settleBet once", async () => {
    const caller = createCaller(ctx)
    await caller.play({ wager: 10, segments: 30, risk: "MEDIUM" })

    expect(betMock.openBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
  })

  it("one request: wheelRouter exposes exactly one procedure — no client-triggered wheel.settle", () => {
    expect(Object.keys(wheelRouter._def.procedures)).toEqual(["play"])
  })
})

describe("wheel.play — independent rounds", () => {
  it("independent rounds: two sequential plays each get their own nonce-derived index", async () => {
    betMock.openBet
      .mockResolvedValueOnce({ bet: { id: "bet-1" }, seed: { ...GOLDEN_SEED, nonce: 1 } })
      .mockResolvedValueOnce({ bet: { id: "bet-2" }, seed: { ...GOLDEN_SEED, nonce: 2 } })

    const caller = createCaller(ctx)
    const r1 = await caller.play({ wager: 10, segments: 30, risk: "MEDIUM" })
    const r2 = await caller.play({ wager: 10, segments: 30, risk: "MEDIUM" })

    const expected1 = await deriveWheel({ ...GOLDEN_SEED, nonce: 1 }, 30, "MEDIUM")
    const expected2 = await deriveWheel({ ...GOLDEN_SEED, nonce: 2 }, 30, "MEDIUM")

    expect(r1.index).toBe(expected1.index)
    expect(r2.index).toBe(expected2.index)
    expect(betMock.openBet).toHaveBeenCalledTimes(2)
    expect(betMock.settleBet).toHaveBeenCalledTimes(2)
  })
})
