import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the bet spine as spies — this router adds no money code of its own, and spying on
// openBet/settleInTx (never settleBet) is what makes the nested-transaction rule directly
// assertable (12-RESEARCH.md § Never nest settleBet inside runSerializable).
const betMock = vi.hoisted(() => ({
  openBet: vi.fn(),
  settleBet: vi.fn(),
  settleInTx: vi.fn(),
}))

// tx double exposing exactly the CasinoBet methods the router touches. dbMock covers the
// pre-check query openBet's own runSerializable can't see (the one-active-round guard, which
// runs OUTSIDE openBet per bet.ts's delegation comment).
const txDouble = vi.hoisted(() => ({
  casinoBet: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

const dbMock = vi.hoisted(() => ({
  casinoBet: { findFirst: vi.fn(), update: vi.fn() },
}))

vi.mock("@/lib/casino/bet", () => betMock)
vi.mock("@/lib/db", () => ({
  db: dbMock,
  // runSerializable just invokes its callback with the tx double — no real retry logic needed
  // for these unit tests, mirroring the plinko-router precedent of not mocking real modules
  // this phase's correctness depends on.
  runSerializable: vi.fn((fn: (tx: unknown) => unknown) => fn(txDouble)),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))

// Do NOT mock @/lib/casino/mines or @/lib/casino/fairness — the real derivation is what is
// under test (plinko-router.test.ts precedent: the real math must be exercised, not stubbed).
import { createCallerFactory } from "@/trpc/init"
import { minesRouter } from "@/trpc/routers/mines"
import { minesMultiplier } from "@/lib/casino/mines"
import { payoutFor } from "@/lib/casino/limits"

const createCaller = createCallerFactory(minesRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }
// Golden vector (12-RESEARCH.md § Mine placement): at 5 mines the derived set is
// [19, 5, 2, 13, 17]. Tile 19 is therefore the bust tile; tile 0 is a guaranteed safe tile
// (it never appears in the derived set at any mine count <= 5 per the prefix property).
// Do not "fix" these numbers — they come straight from the repo's real fairness.ts.
const MINES = 5
const MINE_SET = [19, 5, 2, 13, 17]
const SAFE_TILE = 0
const BUST_TILE = 19

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    userId: USER_ID,
    game: "MINES",
    status: "ACTIVE",
    wager: 10,
    nonce: 1,
    config: { mines: MINES },
    state: { revealed: [] },
    multiplier: null,
    seed: GOLDEN_SEED,
    ...overrides,
  }
}

beforeEach(() => {
  betMock.openBet.mockReset()
  betMock.settleBet.mockReset()
  betMock.settleInTx.mockReset()
  txDouble.casinoBet.findFirst.mockReset()
  txDouble.casinoBet.update.mockReset()
  txDouble.casinoBet.updateMany.mockReset()
  txDouble.casinoBet.findUnique.mockReset()
  dbMock.casinoBet.findFirst.mockReset()
  dbMock.casinoBet.update.mockReset()

  dbMock.casinoBet.findFirst.mockResolvedValue(null) // no active round by default
  betMock.openBet.mockResolvedValue({ bet: { id: "bet-1" }, seed: GOLDEN_SEED })
  dbMock.casinoBet.update.mockResolvedValue({})
  txDouble.casinoBet.updateMany.mockResolvedValue({ count: 1 })
  betMock.settleInTx.mockResolvedValue({ payout: 100, multiplier: minesMultiplier(MINES, 1), credited: true })
})

describe("mines.open — input", () => {
  it("rejects mines of 0", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: 0 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects mines of 25", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: 25 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects mines of 12.5 (non-integer)", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: 12.5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects a non-integer wager", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10.5, mines: 5 })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects an extra `tile` key via .strict()", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: 5, tile: 3 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects an extra `multiplier` key via .strict()", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: 5, multiplier: 2 } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects a client-sent `mines` array riding on the input", async () => {
    const caller = createCaller(ctx)
    await expect(
      caller.open({ wager: 10, mines: 5, minePositions: [1, 2, 3] } as never),
    ).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })
})

describe("mines.open — round shape", () => {
  it("passes openBet exactly { userId, game, wager, config: { mines } }, writes state, leaves multiplier null", async () => {
    const caller = createCaller(ctx)
    const result = await caller.open({ wager: 10, mines: MINES })

    expect(betMock.openBet).toHaveBeenCalledTimes(1)
    expect(betMock.openBet).toHaveBeenCalledWith({
      userId: USER_ID,
      game: "MINES",
      wager: 10,
      config: { mines: MINES },
    })

    // The follow-up write's data must deep-equal { revealed: [] } and must NOT touch multiplier.
    expect(dbMock.casinoBet.update).toHaveBeenCalledTimes(1)
    const call = dbMock.casinoBet.update.mock.calls[0][0]
    expect(call.data.state).toEqual({ revealed: [] })
    expect(Object.prototype.hasOwnProperty.call(call.data, "multiplier")).toBe(false)

    expect(Object.keys(result).sort()).toEqual([
      "betId",
      "mineCount",
      "multiplier",
      "nextMultiplier",
      "revealed",
    ])
    expect(result.multiplier).toBeNull()
    expect(result.nextMultiplier).toBe(minesMultiplier(MINES, 1))
  })

  it("one active round: rejects when the pre-check finds an ACTIVE row, never reaching openBet — where has no game key", async () => {
    dbMock.casinoBet.findFirst.mockResolvedValue(activeRow())
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: MINES })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()

    // Structural regression guard: a future editor re-adding `game: "MINES"` to this pre-check
    // fails here. This where clause must match casino.activeRound's exactly.
    expect(dbMock.casinoBet.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: "ACTIVE" },
      select: { id: true },
    })
  })

  it("cross-game: rejects when the pre-check finds an ACTIVE row belonging to a DIFFERENT game (CHICKEN)", async () => {
    dbMock.casinoBet.findFirst.mockResolvedValue(activeRow({ game: "CHICKEN" }))
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, mines: MINES })).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })
})

describe("mines.reveal — never leaks", () => {
  it("a safe reveal's response has no serverSeed and no `mines` key at any depth", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow())
    const caller = createCaller(ctx)
    const result = await caller.reveal({ betId: "bet-1", tile: SAFE_TILE })

    expect(JSON.stringify(result)).not.toContain("serverSeed")
    expect(JSON.stringify(result)).not.toMatch(/"mines"/)
    expect(Object.keys(result)).not.toContain("mines")
  })

  it("the persisted state deep-equals { revealed: [...] } — nothing else, no mine position array", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow())
    const caller = createCaller(ctx)
    await caller.reveal({ betId: "bet-1", tile: SAFE_TILE })

    expect(txDouble.casinoBet.updateMany).toHaveBeenCalledTimes(1)
    const data = txDouble.casinoBet.updateMany.mock.calls[0][0].data
    expect(data.state).toEqual({ revealed: [SAFE_TILE] })
    expect(JSON.stringify(data)).not.toMatch(/\[.*19.*5.*2.*13.*17.*\]/)
  })
})

describe("mines.reveal — multiplier column", () => {
  it("writes state and multiplier in the SAME data object, where includes status ACTIVE and userId", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow())
    const caller = createCaller(ctx)
    await caller.reveal({ betId: "bet-1", tile: SAFE_TILE })

    expect(txDouble.casinoBet.updateMany).toHaveBeenCalledTimes(1)
    const { where, data } = txDouble.casinoBet.updateMany.mock.calls[0][0]
    expect(data.state).toEqual({ revealed: [SAFE_TILE] })
    expect(data.multiplier).toBe(minesMultiplier(MINES, 1))
    expect(where.status).toBe("ACTIVE")
    expect(where.userId).toBe(USER_ID)
  })
})

describe("mines.reveal — idempotent", () => {
  it("revealing an already-revealed tile returns current state unchanged, no updateMany/settleInTx", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(
      activeRow({ state: { revealed: [SAFE_TILE] }, multiplier: minesMultiplier(MINES, 1) }),
    )
    const caller = createCaller(ctx)
    const result = await caller.reveal({ betId: "bet-1", tile: SAFE_TILE })

    expect(result.revealed).toEqual([SAFE_TILE])
    expect(result.k).toBe(1)
    expect(txDouble.casinoBet.updateMany).not.toHaveBeenCalled()
    expect(betMock.settleInTx).not.toHaveBeenCalled()
  })
})

describe("mines.reveal — bust", () => {
  it("revealing a mine tile calls settleInTx once at multiplier 0 and returns the full board", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow())
    betMock.settleInTx.mockResolvedValue({ payout: 0, multiplier: 0, credited: true })
    const caller = createCaller(ctx)
    const result = await caller.reveal({ betId: "bet-1", tile: BUST_TILE })

    expect(betMock.settleInTx).toHaveBeenCalledTimes(1)
    const call = betMock.settleInTx.mock.calls[0]
    expect(call[0]).toBe(txDouble)
    expect(call[1]).toMatchObject({ multiplier: 0 })
    expect(call[1].outcome).toMatchObject({ revealed: [], hit: BUST_TILE })
    expect((call[1].outcome as { mines: number[] }).mines).toEqual(MINE_SET)

    expect(result.safe).toBe(false)
    expect(result.settled).toBe(true)
    expect(result.mines).toEqual(MINE_SET)
  })
})

describe("mines.reveal — cleared", () => {
  it("the final safe reveal settles at the max multiplier and returns the full board", async () => {
    const preRevealed = MINE_SET.length === 5 ? [] : [] // placeholder to keep structure explicit below
    void preRevealed
    // 25 - MINES - 1 safe tiles already revealed; all non-mine, non-target tiles.
    const allSafeTiles = Array.from({ length: 25 }, (_, i) => i).filter((i) => !MINE_SET.includes(i))
    const lastGem = allSafeTiles[allSafeTiles.length - 1]
    const alreadyRevealed = allSafeTiles.slice(0, allSafeTiles.length - 1)

    txDouble.casinoBet.findFirst.mockResolvedValue(
      activeRow({
        state: { revealed: alreadyRevealed },
        multiplier: minesMultiplier(MINES, alreadyRevealed.length),
      }),
    )
    const maxMult = minesMultiplier(MINES, 25 - MINES)
    betMock.settleInTx.mockResolvedValue({ payout: payoutFor(10, maxMult), multiplier: maxMult, credited: true })

    const caller = createCaller(ctx)
    const result = await caller.reveal({ betId: "bet-1", tile: lastGem })

    expect(betMock.settleInTx).toHaveBeenCalledTimes(1)
    expect(betMock.settleInTx.mock.calls[0][1]).toMatchObject({ multiplier: maxMult })
    expect(result.nextMultiplier).toBeNull()
    expect(result.mines).toEqual(MINE_SET)
    expect(result.settled).toBe(true)
  })
})

describe("mines.reveal — cashout race", () => {
  it("when updateMany reports count 0, does not call settleInTx, reads the row back, returns the settled outcome", async () => {
    txDouble.casinoBet.findFirst
      .mockResolvedValueOnce(activeRow())
      .mockResolvedValueOnce(undefined as never)
    txDouble.casinoBet.updateMany.mockResolvedValue({ count: 0 })
    txDouble.casinoBet.findUnique.mockResolvedValue({
      id: "bet-1",
      status: "SETTLED",
      multiplier: minesMultiplier(MINES, 1),
      payout: payoutFor(10, minesMultiplier(MINES, 1)),
      state: { revealed: [SAFE_TILE] },
    })

    const caller = createCaller(ctx)
    const result = await expect(caller.reveal({ betId: "bet-1", tile: SAFE_TILE })).resolves.toBeTruthy()
    void result

    expect(betMock.settleInTx).not.toHaveBeenCalled()
    expect(txDouble.casinoBet.findUnique).toHaveBeenCalled()
  })
})

describe("mines.reveal — IDOR", () => {
  it("the reveal/cashout tx.findFirst where includes userId and game MINES (identity + IDOR control, unchanged by 15-02)", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow())
    const caller = createCaller(ctx)
    await caller.reveal({ betId: "bet-1", tile: SAFE_TILE })

    const where = txDouble.casinoBet.findFirst.mock.calls[0][0].where
    expect(where.userId).toBe(USER_ID)
    expect(where.game).toBe("MINES")
  })

  it("the open pre-check on dbMock carries NO game key — only reveal/cashout keep the game filter", async () => {
    dbMock.casinoBet.findFirst.mockResolvedValue(null)
    const caller = createCaller(ctx)
    await caller.open({ wager: 10, mines: MINES })

    const where = dbMock.casinoBet.findFirst.mock.calls[0][0].where
    expect(where.userId).toBe(USER_ID)
    expect(Object.prototype.hasOwnProperty.call(where, "game")).toBe(false)
  })

  it("a findFirst returning null rejects without touching settleInTx", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(null)
    const caller = createCaller(ctx)
    await expect(caller.reveal({ betId: "stolen-id", tile: SAFE_TILE })).rejects.toBeTruthy()
    expect(betMock.settleInTx).not.toHaveBeenCalled()
  })
})

describe("mines.cashout", () => {
  it("at revealed.length >= 1, calls settleInTx once at the row's stored multiplier and returns the mine array", async () => {
    const storedMult = minesMultiplier(MINES, 1)
    txDouble.casinoBet.findFirst.mockResolvedValue(
      activeRow({ state: { revealed: [SAFE_TILE] }, multiplier: storedMult }),
    )
    betMock.settleInTx.mockResolvedValue({ payout: payoutFor(10, storedMult), multiplier: storedMult, credited: true })

    const caller = createCaller(ctx)
    const result = await caller.cashout({ betId: "bet-1" })

    expect(betMock.settleInTx).toHaveBeenCalledTimes(1)
    expect(betMock.settleInTx.mock.calls[0][1]).toMatchObject({ multiplier: storedMult })
    // not a recomputed value (which would be minesMultiplier(MINES, revealed.length) recomputed
    // — same number here, so also assert it is NOT a client-sent value by omitting multiplier
    // from the input entirely, asserted by the .strict() input test below)
    expect(result.mines).toEqual(MINE_SET)
    expect(result.payout).toBe(payoutFor(10, storedMult))
  })

  it("at revealed.length === 0, rejects and never calls settleInTx", async () => {
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow({ state: { revealed: [] }, multiplier: null }))
    const caller = createCaller(ctx)
    await expect(caller.cashout({ betId: "bet-1" })).rejects.toBeTruthy()
    expect(betMock.settleInTx).not.toHaveBeenCalled()
  })

  it("when settleInTx reports credited: false, still resolves with the stored payout and no second credit", async () => {
    const storedMult = minesMultiplier(MINES, 1)
    txDouble.casinoBet.findFirst.mockResolvedValue(
      activeRow({ state: { revealed: [SAFE_TILE] }, multiplier: storedMult }),
    )
    betMock.settleInTx.mockResolvedValue({ payout: payoutFor(10, storedMult), multiplier: storedMult, credited: false })

    const caller = createCaller(ctx)
    const result = await caller.cashout({ betId: "bet-1" })
    expect(result.payout).toBe(payoutFor(10, storedMult))
  })

  it("rejects an extra key via .strict()", async () => {
    const caller = createCaller(ctx)
    await expect(caller.cashout({ betId: "bet-1", multiplier: 5 } as never)).rejects.toBeTruthy()
  })
})

describe("mines — no nested transaction", () => {
  it("bust, cleared and cashout paths never call settleBet; every settleInTx call receives the tx double first", async () => {
    // bust
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow())
    betMock.settleInTx.mockResolvedValue({ payout: 0, multiplier: 0, credited: true })
    const caller = createCaller(ctx)
    await caller.reveal({ betId: "bet-1", tile: BUST_TILE })
    expect(betMock.settleBet).not.toHaveBeenCalled()
    expect(betMock.settleInTx.mock.calls[0][0]).toBe(txDouble)

    // cleared
    betMock.settleInTx.mockClear()
    const allSafeTiles = Array.from({ length: 25 }, (_, i) => i).filter((i) => !MINE_SET.includes(i))
    const lastGem = allSafeTiles[allSafeTiles.length - 1]
    const alreadyRevealed = allSafeTiles.slice(0, allSafeTiles.length - 1)
    txDouble.casinoBet.findFirst.mockResolvedValue(
      activeRow({ state: { revealed: alreadyRevealed }, multiplier: minesMultiplier(MINES, alreadyRevealed.length) }),
    )
    const maxMult = minesMultiplier(MINES, 25 - MINES)
    betMock.settleInTx.mockResolvedValue({ payout: payoutFor(10, maxMult), multiplier: maxMult, credited: true })
    await caller.reveal({ betId: "bet-1", tile: lastGem })
    expect(betMock.settleBet).not.toHaveBeenCalled()
    expect(betMock.settleInTx.mock.calls[0][0]).toBe(txDouble)

    // cashout
    betMock.settleInTx.mockClear()
    const storedMult = minesMultiplier(MINES, 1)
    txDouble.casinoBet.findFirst.mockResolvedValue(
      activeRow({ state: { revealed: [SAFE_TILE] }, multiplier: storedMult }),
    )
    betMock.settleInTx.mockResolvedValue({ payout: payoutFor(10, storedMult), multiplier: storedMult, credited: true })
    await caller.cashout({ betId: "bet-1" })
    expect(betMock.settleBet).not.toHaveBeenCalled()
    expect(betMock.settleInTx.mock.calls[0][0]).toBe(txDouble)
  })
})

describe("mines — surface", () => {
  it("minesRouter exposes exactly open, reveal, cashout", () => {
    expect(Object.keys(minesRouter._def.procedures)).toEqual(["open", "reveal", "cashout"])
  })
})
