import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the bet spine as spies, not the database — this phase adds no DB logic of its own,
// and spying on openBet/settleBet is what makes the one-request rule directly assertable.
const betMock = vi.hoisted(() => ({
  openBet: vi.fn(),
  settleBet: vi.fn(),
}))

vi.mock("@/lib/casino/bet", () => betMock)
vi.mock("@/auth", () => ({ auth: vi.fn() }))

// Do NOT mock @/lib/casino/plinko or @/lib/casino/fairness — the real derivation is what is
// under test. derivePlinko is imported directly below so the "independent rounds" test can
// prove each response's bucket came from its own mocked nonce, not just that two calls happened.
import { createCallerFactory } from "@/trpc/init"
import { plinkoRouter } from "@/trpc/routers/plinko"
import { derivePlinko } from "@/lib/casino/plinko"

const createCaller = createCallerFactory(plinkoRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

beforeEach(() => {
  betMock.openBet.mockReset()
  betMock.settleBet.mockReset()
  betMock.openBet.mockResolvedValue({ bet: { id: "bet-1" }, seed: GOLDEN_SEED })
  betMock.settleBet.mockResolvedValue({ payout: 1, multiplier: 0.2, credited: true })
})

describe("plinko.play — input boundary", () => {
  const base = { wager: 10, rows: 16, risk: "HIGH" as const }

  it("input: rejects rows below the minimum (7)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, rows: 7 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects rows above the maximum (17)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, rows: 17 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects a non-integer rows value (12.5)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, rows: 12.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an unrecognised risk tier (\"RAIN\") — the enum IS the guard", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, risk: "RAIN" } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects a non-integer wager (10.5)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, wager: 10.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra bucket key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, bucket: 3 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("input: rejects an input carrying an extra multiplier key", async () => {
    const caller = createCaller(ctx)
    await expect(caller.play({ ...base, multiplier: 100 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })
})

describe("plinko.play — settles at the table multiplier", () => {
  it("settles at the table multiplier: HIGH/16 golden seed calls settleBet once at 0.2x", async () => {
    const caller = createCaller(ctx)
    await caller.play({ wager: 10, rows: 16, risk: "HIGH" })

    expect(betMock.openBet).toHaveBeenCalledWith(
      expect.objectContaining({ game: "PLINKO", config: { rows: 16, risk: "HIGH" } }),
    )
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledWith(
      expect.objectContaining({ betId: "bet-1", userId: USER_ID, wager: 10, multiplier: 0.2 }),
    )
  })
})

describe("plinko.play — never leaks the seed", () => {
  it("never leaks: the response has no serverSeed/seed key at any depth", async () => {
    const caller = createCaller(ctx)
    const result = await caller.play({ wager: 10, rows: 16, risk: "HIGH" })

    expect(JSON.stringify(result)).not.toContain("serverSeed")
    expect(Object.keys(result)).not.toContain("seed")
    expect(Object.keys(result).sort()).toEqual(["betId", "bucket", "multiplier", "path", "payout"])
  })
})

describe("plinko.play — one request", () => {
  it("one request: a single play calls openBet once and settleBet once", async () => {
    const caller = createCaller(ctx)
    await caller.play({ wager: 10, rows: 16, risk: "HIGH" })

    expect(betMock.openBet).toHaveBeenCalledTimes(1)
    expect(betMock.settleBet).toHaveBeenCalledTimes(1)
  })

  it("one request: plinkoRouter exposes exactly one procedure — no client-triggered settle", () => {
    expect(Object.keys(plinkoRouter._def.procedures)).toEqual(["play"])
  })
})

describe("plinko.play — independent rounds", () => {
  it("independent rounds: two sequential plays each get their own nonce-derived bucket, no active-round guard", async () => {
    betMock.openBet
      .mockResolvedValueOnce({ bet: { id: "bet-1" }, seed: { ...GOLDEN_SEED, nonce: 1 } })
      .mockResolvedValueOnce({ bet: { id: "bet-2" }, seed: { ...GOLDEN_SEED, nonce: 2 } })

    const caller = createCaller(ctx)
    const r1 = await caller.play({ wager: 10, rows: 16, risk: "HIGH" })
    const r2 = await caller.play({ wager: 10, rows: 16, risk: "HIGH" })

    const expected1 = await derivePlinko({ ...GOLDEN_SEED, nonce: 1 }, 16, "HIGH")
    const expected2 = await derivePlinko({ ...GOLDEN_SEED, nonce: 2 }, 16, "HIGH")

    expect(r1.bucket).toBe(expected1.bucket)
    expect(r2.bucket).toBe(expected2.bucket)
    expect(betMock.openBet).toHaveBeenCalledTimes(2)
    expect(betMock.settleBet).toHaveBeenCalledTimes(2)
  })
})

describe("plinko.play — path shape", () => {
  it("path: has rows entries, every entry is 0 or 1, and reduces to the bucket", async () => {
    const caller = createCaller(ctx)
    const result = await caller.play({ wager: 10, rows: 16, risk: "HIGH" })

    expect(result.path).toHaveLength(16)
    for (const bit of result.path) expect([0, 1]).toContain(bit)
    expect(result.path.reduce((a, b) => a + b, 0)).toBe(result.bucket)
  })
})
