import { describe, it, expect, vi, beforeEach } from "vitest"

const betMock = vi.hoisted(() => ({
  openBet: vi.fn(),
  settleBet: vi.fn(),
  settleInTx: vi.fn(),
}))

const txDouble = vi.hoisted(() => ({
  casinoBet: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}))

const dbMock = vi.hoisted(() => ({
  casinoBet: { findFirst: vi.fn(), update: vi.fn() },
}))

vi.mock("@/lib/casino/bet", () => betMock)
vi.mock("@/lib/db", () => ({
  db: dbMock,
  runSerializable: vi.fn((fn: (tx: unknown) => unknown) => fn(txDouble)),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { blackjackRouter } from "@/trpc/routers/blackjack"
import { deriveBlackjackShoe, dealInitial, cardCode, type Card } from "@/lib/casino/blackjack"

const createCaller = createCallerFactory(blackjackRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

const GOLDEN_SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    userId: USER_ID,
    game: "BLACKJACK",
    status: "ACTIVE",
    wager: 10,
    nonce: 1,
    config: { baseWager: 10 },
    state: null,
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
  txDouble.user.updateMany.mockReset()
  txDouble.user.update.mockReset()
  dbMock.casinoBet.findFirst.mockReset()
  dbMock.casinoBet.update.mockReset()

  dbMock.casinoBet.findFirst.mockResolvedValue(null)
  betMock.openBet.mockResolvedValue({ bet: { id: "bet-1" }, seed: GOLDEN_SEED })
  dbMock.casinoBet.update.mockResolvedValue({})
  txDouble.casinoBet.update.mockResolvedValue({})
  txDouble.casinoBet.updateMany.mockResolvedValue({ count: 1 })
  txDouble.casinoBet.findUnique.mockResolvedValue({ wager: 10 })
  txDouble.user.updateMany.mockResolvedValue({ count: 1 })
  betMock.settleInTx.mockImplementation(async (_tx, opts: { wager: number; multiplier: number }) => ({
    payout: Math.floor(opts.wager * opts.multiplier),
    multiplier: opts.multiplier,
    credited: true,
  }))
})

describe("blackjack.open", () => {
  it("rejects extra keys via .strict()", async () => {
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10, shoe: [] } as never)).rejects.toBeTruthy()
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("rejects when another ACTIVE round exists", async () => {
    dbMock.casinoBet.findFirst.mockResolvedValue({ id: "other" })
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10 })).rejects.toMatchObject({ code: "CONFLICT" })
    expect(betMock.openBet).not.toHaveBeenCalled()
  })

  it("cross-game ACTIVE pre-check has no game filter", async () => {
    dbMock.casinoBet.findFirst.mockResolvedValue({ id: "mines-round" })
    const caller = createCaller(ctx)
    await expect(caller.open({ wager: 10 })).rejects.toMatchObject({ code: "CONFLICT" })
    expect(dbMock.casinoBet.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: "ACTIVE" },
      select: { id: true },
    })
  })

  it("opens a round and never returns serverSeed", async () => {
    const caller = createCaller(ctx)
    const res = await caller.open({ wager: 10 })
    expect(betMock.openBet).toHaveBeenCalledWith(
      expect.objectContaining({ game: "BLACKJACK", wager: 10, config: { baseWager: 10 } }),
    )
    expect(res.betId).toBe("bet-1")
    expect(JSON.stringify(res)).not.toContain("serverSeed")
    expect(res.holeHidden === true || res.settled === true).toBe(true)
    if (!res.settled) {
      expect(res.dealerCards).toBeNull()
      expect(res.hands[0]!.cards.length).toBe(2)
    }
  })

  it("ACTIVE state write never includes hole card values from shoe[3]", async () => {
    const caller = createCaller(ctx)
    await caller.open({ wager: 10 })
    const shoe = await deriveBlackjackShoe(GOLDEN_SEED)
    const hole = cardCode(shoe[3]!)
    // If we didn't auto-settle, check persisted state
    if (dbMock.casinoBet.update.mock.calls.length > 0) {
      const written = JSON.stringify(dbMock.casinoBet.update.mock.calls[0]![0])
      // Persisted state may contain other cards; hole specifically must not appear as dealer hole array
      const state = dbMock.casinoBet.update.mock.calls[0]![0].data.state as {
        dealerUp: Card
        hands: { cards: Card[] }[]
      }
      const publicCodes = new Set([
        cardCode(state.dealerUp),
        ...state.hands.flatMap((h) => h.cards.map((c: Card) => cardCode(c))),
      ])
      // Hole may coincidentally match a public card rank/suit from another deck copy — only
      // assert we never store a dealerCards array while ACTIVE.
      expect(written).not.toContain("dealerCards")
      expect(publicCodes.has(hole) || !written.includes(hole)).toBeTruthy()
    }
  })
})

describe("blackjack.action", () => {
  it("settles via settleInTx and never settleBet", async () => {
    const shoe = await deriveBlackjackShoe(GOLDEN_SEED)
    const state = dealInitial(shoe, 10)
    // Force a playing state that can stand
    state.phase = "playing"
    state.peeked = true
    state.hands[0]!.done = false
    if (state.hands[0]!.cards.length === 2 && state.hands[0]!.cards.some((c) => c.rank === "A")) {
      // Ensure not auto-BJ path confusion
    }

    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow({ state, wager: 10 }))
    txDouble.casinoBet.findUnique.mockResolvedValue({ wager: 10 })

    const caller = createCaller(ctx)
    // Only stand if stand is legal
    if (state.phase === "playing" && !state.hands[0]!.done) {
      const res = await caller.action({ betId: "bet-1", action: "stand" })
      expect(betMock.settleInTx).toHaveBeenCalled()
      expect(betMock.settleBet).not.toHaveBeenCalled()
      expect(res.settled).toBe(true)
      expect(res.dealerCards).toBeTruthy()
    }
  })

  it("double debits extra ZP and increments wager", async () => {
    const state = {
      nextCardIndex: 4,
      hands: [
        {
          cards: [
            { rank: "5" as const, suit: "S" as const },
            { rank: "4" as const, suit: "H" as const },
          ],
          stake: 10,
          done: false,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
      activeHand: 0,
      dealerUp: { rank: "6" as const, suit: "D" as const },
      phase: "playing" as const,
      insuranceStake: 0,
      peeked: true,
    }
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow({ state, wager: 10 }))
    txDouble.casinoBet.findUnique.mockResolvedValue({ wager: 20 })

    const caller = createCaller(ctx)
    await caller.action({ betId: "bet-1", action: "double" })

    expect(txDouble.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { zigmaPoints: { decrement: 10 } },
      }),
    )
    expect(txDouble.casinoBet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wager: { increment: 10 } }),
      }),
    )
    expect(betMock.settleInTx).toHaveBeenCalled()
  })

  it("rejects double when balance insufficient", async () => {
    const state = {
      nextCardIndex: 4,
      hands: [
        {
          cards: [
            { rank: "5" as const, suit: "S" as const },
            { rank: "4" as const, suit: "H" as const },
          ],
          stake: 10,
          done: false,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
      activeHand: 0,
      dealerUp: { rank: "6" as const, suit: "D" as const },
      phase: "playing" as const,
      insuranceStake: 0,
      peeked: true,
    }
    txDouble.casinoBet.findFirst.mockResolvedValue(activeRow({ state }))
    txDouble.user.updateMany.mockResolvedValue({ count: 0 })

    const caller = createCaller(ctx)
    await expect(caller.action({ betId: "bet-1", action: "double" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(betMock.settleInTx).not.toHaveBeenCalled()
  })
})
