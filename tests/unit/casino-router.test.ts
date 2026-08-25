import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks — mirrors tetris-router.test.ts's style exactly.
const dbMock = vi.hoisted(() => {
  const mock = {
    casinoSeed: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    casinoBet: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mock)),
  }
  return mock
})

vi.mock("@/lib/db", () => ({
  db: dbMock,
  // runSerializable just adds Serializable isolation + retry around $transaction;
  // for the router's logic it behaves identically, so delegate to the mock.
  runSerializable: (fn: (tx: unknown) => unknown) => dbMock.$transaction(fn),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ notifyZpChange: vi.fn() }))
// `after` from next/server must be a pass-through: run the callback so notifyZpChange
// fires in the same tick, which is what the assertions rely on.
vi.mock("next/server", () => ({ after: (fn: () => void) => { void fn() } }))

import { createCallerFactory } from "@/trpc/init"
import { casinoRouter } from "@/trpc/routers/casino"
import { openBet, settleBet } from "@/lib/casino/bet"
import { notifyZpChange } from "@/lib/notifications"

const createCaller = createCallerFactory(casinoRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Call = any

beforeEach(() => {
  for (const fn of Object.values(dbMock.casinoSeed)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.casinoBet)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(notifyZpChange).mockClear()
  // Sensible defaults so a test only overrides what it cares about.
  vi.mocked(dbMock.casinoBet.findMany).mockResolvedValue([])
  vi.mocked(dbMock.casinoBet.updateMany).mockResolvedValue({ count: 0 })
  vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(dbMock.casinoSeed.findFirst).mockResolvedValue({
    id: "seed-1",
    userId: USER_ID,
    serverSeed: "a".repeat(64),
    serverSeedHash: "hash".padEnd(64, "0"),
    clientSeed: "c".repeat(8),
    nonce: 0,
  })
  vi.mocked(dbMock.casinoSeed.update).mockResolvedValue({ nonce: 1 })
  vi.mocked(dbMock.casinoBet.create).mockResolvedValue({ id: "bet-new" })
})

describe("casino.getSeed — never leaks", () => {
  it("the response has no serverSeed key even when the fetched row includes one", async () => {
    vi.mocked(dbMock.casinoSeed.findFirst).mockResolvedValue({
      id: "seed-1",
      serverSeedHash: "hash".padEnd(64, "0"),
      clientSeed: "c".repeat(8),
      nonce: 3,
      serverSeed: "SECRET-SHOULD-NEVER-BE-HERE",
    })
    const caller = createCaller(ctx)
    const r = await caller.getSeed()
    expect(r).not.toHaveProperty("serverSeed")
  })

  it("the Prisma select omits serverSeed — fetching a secret you then delete is still a leak waiting to happen", async () => {
    vi.mocked(dbMock.casinoSeed.findFirst).mockResolvedValue({
      id: "seed-1",
      serverSeedHash: "hash".padEnd(64, "0"),
      clientSeed: "c".repeat(8),
      nonce: 3,
    })
    const caller = createCaller(ctx)
    await caller.getSeed()
    const call = vi.mocked(dbMock.casinoSeed.findFirst).mock.calls[0][0] as Call
    expect(call.select).toBeDefined()
    expect(Object.keys(call.select)).not.toContain("serverSeed")
  })
})

describe("casino.setClientSeed — client seed validation", () => {
  it("rejects a client seed containing the message-field separator", async () => {
    const caller = createCaller(ctx)
    await expect(caller.setClientSeed({ clientSeed: "abc:2" })).rejects.toBeDefined()
    expect(dbMock.casinoSeed.update).not.toHaveBeenCalled()
  })

  it("rejects the empty string", async () => {
    const caller = createCaller(ctx)
    await expect(caller.setClientSeed({ clientSeed: "" })).rejects.toBeDefined()
    expect(dbMock.casinoSeed.update).not.toHaveBeenCalled()
  })

  it("rejects a 65-character string", async () => {
    const caller = createCaller(ctx)
    await expect(caller.setClientSeed({ clientSeed: "a".repeat(65) })).rejects.toBeDefined()
    expect(dbMock.casinoSeed.update).not.toHaveBeenCalled()
  })

  it("accepts a 64-character alphanumeric string", async () => {
    const seed64 = "b".repeat(64)
    vi.mocked(dbMock.casinoSeed.update).mockResolvedValue({ clientSeed: seed64 })
    const caller = createCaller(ctx)
    const r = await caller.setClientSeed({ clientSeed: seed64 })
    expect(r.clientSeed).toBe(seed64)
  })

  it("the colon rejection is a zod validation error (BAD_REQUEST), not a throw after a DB write", async () => {
    const caller = createCaller(ctx)
    const err = await caller.setClientSeed({ clientSeed: "x:1" }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.casinoSeed.update).not.toHaveBeenCalled()
  })
})

describe("casino.rotateSeed — rotate", () => {
  it("sets revealedAt on the current row, creates a nonce-0 pair, and returns the retired seed", async () => {
    const oldServerSeed = "d".repeat(64)
    vi.mocked(dbMock.casinoSeed.findFirst).mockResolvedValue({
      id: "seed-1",
      serverSeed: oldServerSeed,
      serverSeedHash: "oldhash".padEnd(64, "0"),
    })
    vi.mocked(dbMock.casinoSeed.update).mockResolvedValue({
      id: "seed-1",
      serverSeed: oldServerSeed,
      revealedAt: new Date(),
    })
    vi.mocked(dbMock.casinoSeed.create).mockResolvedValue({
      id: "seed-2",
      nonce: 0,
      clientSeed: "e".repeat(64),
      serverSeedHash: "newhash".padEnd(64, "0"),
    })

    const caller = createCaller(ctx)
    const newClientSeed = "e".repeat(64)
    const r = await caller.rotateSeed({ clientSeed: newClientSeed })

    expect(r.revealedServerSeed).toBe(oldServerSeed)
    expect(r.nonce).toBe(0)

    expect(dbMock.casinoSeed.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revealedAt: expect.any(Date) }),
      }),
    )
    expect(dbMock.casinoSeed.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nonce: 0,
          clientSeed: newClientSeed,
          serverSeed: expect.stringMatching(/^[0-9a-f]{64}$/),
          serverSeedHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    )
    // Both writes happen inside a single transaction — the whole point of the rotate operation.
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it("rejects a rotate clientSeed containing a colon", async () => {
    const caller = createCaller(ctx)
    await expect(caller.rotateSeed({ clientSeed: "abc:2" })).rejects.toBeDefined()
    expect(dbMock.casinoSeed.create).not.toHaveBeenCalled()
  })
})

describe("openBet — insufficient", () => {
  it("throws FORBIDDEN and creates no bet when the balance is too low", async () => {
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 0 })

    await expect(openBet({ userId: USER_ID, game: "DICE", wager: 10, config: {} })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.casinoBet.create).not.toHaveBeenCalled()
  })
})

describe("openBet — conditional debit", () => {
  it("debits via a where containing zigmaPoints gte wager and the caller's id — the CASN-01 pattern", async () => {
    await openBet({ userId: USER_ID, game: "DICE", wager: 25, config: {} })

    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, zigmaPoints: { gte: 25 } },
      data: { zigmaPoints: { decrement: 25 } },
    })
  })
})

describe("settleBet — idempotent settle", () => {
  it("credits nothing and returns the stored payout when the CAS loses the race (already settled)", async () => {
    vi.mocked(dbMock.casinoBet.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(dbMock.casinoBet.findUnique).mockResolvedValue({ id: "bet-1", wager: 10, multiplier: 2, payout: 20 })

    const r = await settleBet({ betId: "bet-1", userId: USER_ID, wager: 10, multiplier: 999, outcome: {} })

    expect(dbMock.user.update).not.toHaveBeenCalled()
    // The stored payout (20), not a freshly computed one off the resent multiplier (999).
    expect(r.payout).toBe(20)
  })

  it("credits min(floor(wager * multiplier), MAX_PAYOUT) when the CAS wins", async () => {
    vi.mocked(dbMock.casinoBet.updateMany).mockResolvedValue({ count: 1 })

    const r = await settleBet({ betId: "bet-2", userId: USER_ID, wager: 10, multiplier: 2.47, outcome: {} })

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: 24 } },
    })
    expect(r.payout).toBe(24)
  })
})

describe("casino.history — history", () => {
  it("scopes to the caller's userId, orders createdAt desc, and takes limit+1 for cursor pagination", async () => {
    vi.mocked(dbMock.casinoBet.findMany).mockResolvedValue([
      { id: "b1", game: "DICE", wager: 10, multiplier: 2, payout: 20, createdAt: new Date() },
    ])
    const caller = createCaller(ctx)
    const r = await caller.history({ limit: 20 })

    const call = vi.mocked(dbMock.casinoBet.findMany).mock.calls[0][0] as Call
    expect(call.where).toMatchObject({ userId: USER_ID })
    expect(call.orderBy).toEqual({ createdAt: "desc" })
    expect(call.take).toBe(21) // limit + 1, the cursor-pagination lookahead row
    expect(r.items[0]).toMatchObject({ game: "DICE", wager: 10, multiplier: 2, payout: 20 })
    expect(r.items[0]).toHaveProperty("createdAt")
  })
})

describe("casino.activeRound — resume", () => {
  it("returns the ACTIVE bet scoped to the caller with an explicit select excluding hidden outcome data", async () => {
    vi.mocked(dbMock.casinoBet.findFirst).mockResolvedValue({
      id: "bet-1",
      game: "MINES",
      wager: 10,
      config: {},
      state: { revealed: [1, 2] },
      multiplier: 1.2,
    })
    const caller = createCaller(ctx)
    const r = await caller.activeRound()

    const call = vi.mocked(dbMock.casinoBet.findFirst).mock.calls[0][0] as Call
    expect(call.where).toMatchObject({ userId: USER_ID, status: "ACTIVE" })
    expect(call.select).toBeDefined()
    // No raw hidden-outcome key (e.g. the seed relation carrying the server seed) may be selected.
    expect(Object.keys(call.select)).not.toContain("seed")
    expect(r).toMatchObject({ betId: "bet-1", game: "MINES", wager: 10 })
  })

  it("returns null when there is no active round", async () => {
    vi.mocked(dbMock.casinoBet.findFirst).mockResolvedValue(null)
    const caller = createCaller(ctx)
    const r = await caller.activeRound()
    expect(r).toBeNull()
  })
})

describe("openBet — sweep", () => {
  it("settles a stale ACTIVE bet at its earned multiplier before the debit — the stake is never voided", async () => {
    vi.mocked(dbMock.casinoBet.findMany).mockResolvedValue([
      { id: "stale-1", userId: USER_ID, wager: 10, multiplier: 1.5, status: "ACTIVE" },
    ])
    vi.mocked(dbMock.casinoBet.updateMany).mockResolvedValue({ count: 1 })

    await openBet({ userId: USER_ID, game: "DICE", wager: 5, config: {} })

    expect(dbMock.casinoBet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    )
    // A stale row that had already earned a >=1x multiplier credits a positive payout —
    // abandoning can never be better than cashing out, but it must never be a silent void.
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: expect.any(Number) } },
    })
  })

  it("a stale row with no earned multiplier settles with payout 0 without throwing", async () => {
    vi.mocked(dbMock.casinoBet.findMany).mockResolvedValue([
      { id: "stale-2", userId: USER_ID, wager: 10, multiplier: 0, status: "ACTIVE" },
    ])
    vi.mocked(dbMock.casinoBet.updateMany).mockResolvedValue({ count: 1 })

    await expect(openBet({ userId: USER_ID, game: "DICE", wager: 5, config: {} })).resolves.toBeDefined()
  })
})
