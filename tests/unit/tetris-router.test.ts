import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks — mirrors flappy-router.test.ts's style.
const dbMock = vi.hoisted(() => {
  const mock = {
    tetrisRun: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
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

// replay() is the anti-cheat root and is already proven correct against the real
// engine in tests/unit/tetris-replay.test.ts (Plan 02) — the router tests below
// mock it so they can drive every {score, linesCleared, valid} combination the
// router must react to without hand-scripting real gameplay.
const replayMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: dbMock,
  // runSerializable just adds Serializable isolation + retry around $transaction;
  // for the router's logic it behaves identically, so delegate to the mock.
  runSerializable: (fn: (tx: unknown) => unknown) => dbMock.$transaction(fn),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ notifyZpChange: vi.fn(), notifyLeaderboardPrize: vi.fn() }))
// `after` from next/server must be a pass-through: run the callback so notifyZpChange
// fires in the same tick, which is what the assertions rely on.
vi.mock("next/server", () => ({ after: (fn: () => void) => { void fn() } }))
vi.mock("@/lib/tetris/replay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tetris/replay")>()
  return { ...actual, replay: replayMock }
})

import { createCallerFactory } from "@/trpc/init"
import { tetrisRouter } from "@/trpc/routers/tetris"
import { notifyZpChange, notifyLeaderboardPrize } from "@/lib/notifications"
import { FREE_PLAYS_PER_DAY, REPLAY_COST, ALL_TIME_CROWN_ZP } from "@/lib/tetris/constants"

const createCaller = createCallerFactory(tetrisRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

beforeEach(() => {
  for (const fn of Object.values(dbMock.tetrisRun)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(notifyZpChange).mockClear()
  vi.mocked(notifyLeaderboardPrize).mockClear()
  replayMock.mockReset()
  // Default: no other qualifying runs, so crown checks don't fire unless a test wants them to.
  vi.mocked(dbMock.tetrisRun.aggregate).mockResolvedValue({ _max: { score: null } })
  // Default: rich enough to buy a replay, so only tests that care set a balance.
  vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 1000 })
  vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
})

describe("tetris.getStatus", () => {
  it("reports the free run as available before it is used", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(0)
    const caller = createCaller(ctx)
    const r = await caller.getStatus()
    expect(r.runsToday).toBe(0)
    expect(r.runsRemaining).toBe(FREE_PLAYS_PER_DAY)
    expect(r.replayCost).toBe(REPLAY_COST)
    expect(r.canPlay).toBe(true)
  })

  it("free run used but affordable replay -> canPlay stays true", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: REPLAY_COST })
    const caller = createCaller(ctx)
    const r = await caller.getStatus()
    expect(r.runsRemaining).toBe(0)
    expect(r.canAffordReplay).toBe(true)
    expect(r.canPlay).toBe(true)
  })

  it("free run used and replay unaffordable -> canPlay=false", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: REPLAY_COST - 1 })
    const caller = createCaller(ctx)
    const r = await caller.getStatus()
    expect(r.canAffordReplay).toBe(false)
    expect(r.canPlay).toBe(false)
  })
})

describe("tetris.start", () => {
  it("the day's first run is free — entryCost 0, no ZP debited", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(0)
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(dbMock.tetrisRun.create).mockResolvedValue({ id: "run-1", seed: 12345 })

    const caller = createCaller(ctx)
    const r = await caller.start()

    expect(r.runId).toBe("run-1")
    expect(typeof r.seed).toBe("number")
    expect(r.entryCost).toBe(0)
    expect(r.runsRemaining).toBe(FREE_PLAYS_PER_DAY - 1)
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
    expect(dbMock.tetrisRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: USER_ID, status: "ACTIVE", entryCost: 0 }),
      }),
    )
  })

  it("past the free run, debits REPLAY_COST and records it as entryCost", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(dbMock.tetrisRun.create).mockResolvedValue({ id: "run-2", seed: 7 })

    const caller = createCaller(ctx)
    const r = await caller.start()

    expect(r.entryCost).toBe(REPLAY_COST)
    // The balance check IS the WHERE clause — no read-then-write gap to overdraft through.
    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, zigmaPoints: { gte: REPLAY_COST } },
      data: { zigmaPoints: { decrement: REPLAY_COST } },
    })
    expect(dbMock.tetrisRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entryCost: REPLAY_COST }) }),
    )
  })

  it("throws FORBIDDEN and creates no run when the replay is unaffordable", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 0 }) // balance too low

    const caller = createCaller(ctx)
    await expect(caller.start()).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.tetrisRun.create).not.toHaveBeenCalled()
  })

  it("sweeps stale ACTIVE runs to ABANDONED before creating a new one", async () => {
    vi.mocked(dbMock.tetrisRun.count).mockResolvedValue(0)
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 2 })
    vi.mocked(dbMock.tetrisRun.create).mockResolvedValue({ id: "run-1", seed: 1 })

    const caller = createCaller(ctx)
    await caller.start()

    expect(dbMock.tetrisRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, status: "ACTIVE" }),
        data: { status: "ABANDONED", endedAt: expect.anything() },
      }),
    )
  })
})

describe("tetris.end", () => {
  const runRow = { id: "run-1", userId: USER_ID, seed: 42, startedAt: new Date(Date.now() - 5_000), entryCost: 0 }

  it("throws FORBIDDEN when the runId belongs to another user", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue({ ...runRow, userId: "other-user" })
    const caller = createCaller(ctx)
    await expect(caller.end({ runId: "run-1", inputLog: [] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("throws FORBIDDEN when the run does not exist", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue(null)
    const caller = createCaller(ctx)
    await expect(caller.end({ runId: "missing", inputLog: [] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("calls replay(seed, inputLog) and throws BAD_REQUEST when it returns valid:false", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue(runRow)
    replayMock.mockReturnValue({ score: 0, linesCleared: 0, valid: false })

    const caller = createCaller(ctx)
    const log = [{ tick: 0, action: "hard" as const }]
    await expect(caller.end({ runId: "run-1", inputLog: log })).rejects.toMatchObject({ code: "BAD_REQUEST" })

    expect(replayMock).toHaveBeenCalledWith(runRow.seed, log, expect.objectContaining({ maxTicks: expect.any(Number) }))
    // No ZP, no leaderboard entry — the DB is never touched past the invalid check.
    expect(dbMock.tetrisRun.updateMany).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("banks zpEarned = linesCleared (uncapped) and increments zigmaPoints", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue(runRow)
    replayMock.mockReturnValue({ score: 800, linesCleared: 9, valid: true })
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 1 })
    // Someone else already holds the crown — keeps this test's assertions to the ZP credit only.
    vi.mocked(dbMock.tetrisRun.aggregate).mockResolvedValue({ _max: { score: 9999 } })

    const caller = createCaller(ctx)
    const r = await caller.end({ runId: "run-1", inputLog: [{ tick: 0, action: "hard" }] })

    expect(r).toEqual({ score: 800, linesCleared: 9, zpWon: 9, isPaidReplay: false })
    expect(dbMock.tetrisRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", status: { not: "ENDED" } },
      data: { status: "ENDED", endedAt: expect.any(Date), score: 800, linesCleared: 9, zpEarned: 9 },
    })
    expect(dbMock.user.update).toHaveBeenCalledTimes(1)
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: 9 } },
    })
    expect(notifyZpChange).toHaveBeenCalledWith(USER_ID)
    expect(notifyZpChange).toHaveBeenCalledTimes(1)
  })

  it("awards ALL_TIME_CROWN_ZP when this run takes sole all-time #1 by score", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue(runRow)
    replayMock.mockReturnValue({ score: 500, linesCleared: 2, valid: true })
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.tetrisRun.aggregate).mockResolvedValue({ _max: { score: null } }) // no qualifying runs -> sentinel -1

    const caller = createCaller(ctx)
    await caller.end({ runId: "run-1", inputLog: [{ tick: 0, action: "hard" }] })

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } },
    })
  })

  it("a PAID replay banks 0 ZP but still claims the all-time crown", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue({ ...runRow, entryCost: REPLAY_COST })
    replayMock.mockReturnValue({ score: 500, linesCleared: 9, valid: true })
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.tetrisRun.aggregate).mockResolvedValue({ _max: { score: null } })

    const caller = createCaller(ctx)
    const r = await caller.end({ runId: "run-1", inputLog: [{ tick: 0, action: "hard" }] })

    expect(r).toEqual({ score: 500, linesCleared: 9, zpWon: 0, isPaidReplay: true })
    // The only credit is the crown — nothing was banked for the lines.
    expect(dbMock.user.update).toHaveBeenCalledTimes(1)
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } },
    })
    // Leaderboard ZP says which board, which place, and how much — not "balance changed".
    expect(notifyLeaderboardPrize).toHaveBeenCalledWith(
      USER_ID,
      "Petris",
      1,
      ALL_TIME_CROWN_ZP,
      "all-time",
    )
  })

  it("does not claim a leaderboard prize when the crown wasn't taken", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue(runRow)
    replayMock.mockReturnValue({ score: 100, linesCleared: 4, valid: true })
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 1 })
    // Someone else is well ahead all-time, so claimsAllTimeCrown is false.
    vi.mocked(dbMock.tetrisRun.aggregate).mockResolvedValue({ _max: { score: 9999 } })

    const caller = createCaller(ctx)
    await caller.end({ runId: "run-1", inputLog: [{ tick: 0, action: "hard" }] })

    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
    expect(notifyZpChange).toHaveBeenCalledWith(USER_ID) // the run's own ZP still lands
  })

  it("is idempotent — a repeated call recomputes the same summary but does not re-credit", async () => {
    vi.mocked(dbMock.tetrisRun.findUnique).mockResolvedValue(runRow)
    replayMock.mockReturnValue({ score: 300, linesCleared: 3, valid: true })
    // Lost the CAS — this run was already flipped to ENDED by an earlier call.
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 0 })

    const caller = createCaller(ctx)
    const r = await caller.end({ runId: "run-1", inputLog: [{ tick: 0, action: "hard" }] })

    expect(r).toEqual({ score: 300, linesCleared: 3, zpWon: 3, isPaidReplay: false })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyZpChange).not.toHaveBeenCalled()
  })
})

describe("tetris.leaderboard", () => {
  it("returns top-10 ranked by score, dedupes to one row per user, filters scope=today", async () => {
    vi.mocked(dbMock.tetrisRun.groupBy).mockResolvedValue([
      { userId: "u-1", _max: { score: 1200 } },
      { userId: "u-2", _max: { score: 700 } },
    ])
    vi.mocked(dbMock.user.findMany).mockResolvedValue([
      { id: "u-1", name: "Alice", username: "alice", image: null },
      { id: "u-2", name: "Bob", username: "bob", image: "http://x/y.png" },
    ])
    const caller = createCaller(ctx)
    const rows = await caller.leaderboard({ scope: "today" })
    expect(rows).toEqual([
      { rank: 1, userId: "u-1", name: "Alice", username: "alice", image: null, score: 1200 },
      { rank: 2, userId: "u-2", name: "Bob", username: "bob", image: "http://x/y.png", score: 700 },
    ])
    const call = vi.mocked(dbMock.tetrisRun.groupBy).mock.calls[0][0] as {
      where: { status: string; day?: string }; _max: { score: boolean }; take: number
    }
    expect(call.where.status).toBe("ENDED")
    expect(typeof call.where.day).toBe("string")
    expect(call._max).toEqual({ score: true })
    expect(call.take).toBe(10)
  })

  it("all-time scope omits the day filter", async () => {
    vi.mocked(dbMock.tetrisRun.groupBy).mockResolvedValue([])
    const caller = createCaller(ctx)
    await caller.leaderboard({ scope: "all-time" })
    const call = vi.mocked(dbMock.tetrisRun.groupBy).mock.calls[0][0] as { where: { status: string; day?: string } }
    expect(call.where.status).toBe("ENDED")
    expect(call.where.day).toBeUndefined()
  })

  it("filters out score-0 rows", async () => {
    vi.mocked(dbMock.tetrisRun.groupBy).mockResolvedValue([
      { userId: "u-1", _max: { score: 0 } },
      { userId: "u-2", _max: { score: null } },
    ])
    const caller = createCaller(ctx)
    const rows = await caller.leaderboard({ scope: "all-time" })
    expect(rows).toEqual([])
    expect(dbMock.user.findMany).not.toHaveBeenCalled()
  })
})
