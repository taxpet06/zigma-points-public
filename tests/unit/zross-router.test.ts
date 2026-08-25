import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks — same shape as znake-router.test.ts. dbMock is hoisted so the vi.mock
// factory can reference it safely.
const dbMock = vi.hoisted(() => {
  const mock = {
    zrossRun: {
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

vi.mock("@/lib/db", () => ({
  db: dbMock,
  runSerializable: (fn: (tx: unknown) => unknown) => dbMock.$transaction(fn),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ notifyZpChange: vi.fn(), notifyLeaderboardPrize: vi.fn() }))
vi.mock("next/server", () => ({ after: (fn: () => void) => { void fn() } }))

import { createCallerFactory } from "@/trpc/init"
import { notifyLeaderboardPrize } from "@/lib/notifications"
import { zrossRouter } from "@/components/game-hub/zross/router"
import { awardZrossDailyPrizes } from "@/components/game-hub/zross/prizes"
import {
  FREE_PLAYS_PER_DAY,
  REPLAY_COST,
  ALL_TIME_CROWN_ZP,
  MIN_MS_PER_PICKUP,
  ZP_PER_PICKUP,
} from "@/components/game-hub/zross/constants"
import { PLAYED_RUN_WHERE } from "@/lib/game-economy"

const createCaller = createCallerFactory(zrossRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

/** A live run row, patchable per test. startedAt is far enough back that the rate
 *  limit passes unless a test deliberately moves it. */
function activeRun(patch: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    userId: USER_ID,
    status: "ACTIVE",
    startedAt: new Date(Date.now() - 60_000),
    pickupsClaimed: 0,
    zpEarned: 0,
    entryCost: 0,
    ...patch,
  }
}

beforeEach(() => {
  vi.mocked(notifyLeaderboardPrize).mockClear()
  for (const fn of Object.values(dbMock.zrossRun)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 1000 })
  vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
  // Default: someone else already holds the crown, so end() tests that don't care
  // about it aren't accidentally asserting a crown credit.
  vi.mocked(dbMock.zrossRun.aggregate).mockResolvedValue({ _max: { zpEarned: 9999 } })
})

describe("zross.getStatus", () => {
  it("reports the free run as available before it is used", async () => {
    vi.mocked(dbMock.zrossRun.count).mockResolvedValue(0)
    const r = await createCaller(ctx).getStatus()
    expect(r.runsRemaining).toBe(FREE_PLAYS_PER_DAY)
    expect(r.replayCost).toBe(REPLAY_COST)
    expect(r.canPlay).toBe(true)
  })

  it("doesn't count a finished run that never scored — opened and closed is not played", async () => {
    vi.mocked(dbMock.zrossRun.count).mockResolvedValue(0)
    await createCaller(ctx).getStatus()
    expect(dbMock.zrossRun.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, day: expect.any(String), ...PLAYED_RUN_WHERE },
    })
  })

  it("free run used and too poor to replay -> canPlay false", async () => {
    vi.mocked(dbMock.zrossRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: REPLAY_COST - 1 })
    const r = await createCaller(ctx).getStatus()
    expect(r.runsRemaining).toBe(0)
    expect(r.canPlay).toBe(false)
  })
})

describe("zross.start", () => {
  it("the day's first run is free and debits nothing", async () => {
    vi.mocked(dbMock.zrossRun.count).mockResolvedValue(0)
    vi.mocked(dbMock.zrossRun.create).mockResolvedValue({ id: "run-1", seed: 123 })
    const r = await createCaller(ctx).start()
    expect(r.entryCost).toBe(0)
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
  })

  it("charges REPLAY_COST once the free run is gone", async () => {
    vi.mocked(dbMock.zrossRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.zrossRun.create).mockResolvedValue({ id: "run-2", seed: 456 })
    const r = await createCaller(ctx).start()
    expect(r.entryCost).toBe(REPLAY_COST)
    expect(dbMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { zigmaPoints: { decrement: REPLAY_COST } } }),
    )
  })

  it("concurrent start calls: only the racer who reads the exhausted count pays", async () => {
    // Two start() calls "racing" — the mocked count returns 0 for the first read and
    // FREE_PLAYS_PER_DAY for the second, simulating the second call observing the
    // free run already taken (runSerializable is what makes this read race-safe for real).
    vi.mocked(dbMock.zrossRun.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.zrossRun.create)
      .mockResolvedValueOnce({ id: "run-1", seed: 1 })
      .mockResolvedValueOnce({ id: "run-2", seed: 2 })

    const first = await createCaller(ctx).start()
    expect(first.entryCost).toBe(0)

    const second = await createCaller(ctx).start()
    expect(second.entryCost).toBe(REPLAY_COST)
    expect(dbMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID, zigmaPoints: { gte: REPLAY_COST } } }),
    )
  })

  it("concurrent start's conditional debit guard rejects when the balance check matches no row", async () => {
    vi.mocked(dbMock.zrossRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 0 })
    await expect(createCaller(ctx).start()).rejects.toThrow(/need \d+ ZP/)
    expect(dbMock.zrossRun.create).not.toHaveBeenCalled()
  })
})

describe("zross.collect — anti-cheat", () => {
  it("credits ZP_PER_PICKUP on a free run", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun())
    vi.mocked(dbMock.zrossRun.update).mockResolvedValue({ zpEarned: 1 })
    const r = await createCaller(ctx).collect({ runId: "run-1", pickupIndex: 0 })
    expect(r.zpDelta).toBe(ZP_PER_PICKUP)
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: ZP_PER_PICKUP } },
    })
  })

  it("scores but banks nothing on a paid replay", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ entryCost: REPLAY_COST }))
    vi.mocked(dbMock.zrossRun.update).mockResolvedValue({ zpEarned: 1 })
    const r = await createCaller(ctx).collect({ runId: "run-1", pickupIndex: 0 })
    expect(r.score).toBe(1)
    expect(r.zpDelta).toBe(0)
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("rejects a duplicate claim of an already-banked pickup", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ pickupsClaimed: 5 }))
    await expect(createCaller(ctx).collect({ runId: "run-1", pickupIndex: 4 })).rejects.toMatchObject({
      code: "CONFLICT",
    })
    expect(dbMock.zrossRun.update).not.toHaveBeenCalled()
  })

  it("absorbs a gap left by a dropped request, paying exactly the missing pickups", async () => {
    // 5 banked (indexes 0-4), client says it just collected index 7 — the three lost
    // claims (indexes 5, 6, 7) are paid here: claimed = 7+1 = 8, gained = 8-5 = 3.
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ pickupsClaimed: 5, startedAt: new Date(Date.now() - 60_000) }),
    )
    vi.mocked(dbMock.zrossRun.update).mockResolvedValue({ zpEarned: 8 })
    const r = await createCaller(ctx).collect({ runId: "run-1", pickupIndex: 7 })
    expect(r.zpDelta).toBe(3 * ZP_PER_PICKUP)
    expect(dbMock.zrossRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { pickupsClaimed: 8, zpEarned: { increment: 3 * ZP_PER_PICKUP } },
      }),
    )
  })

  it("rejects claims that exceed the average rate ceiling", async () => {
    // A run seconds old claiming its 100th pickup — far past the average-rate ceiling.
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ pickupsClaimed: 0, startedAt: new Date(Date.now() - MIN_MS_PER_PICKUP * 2) }),
    )
    await expect(createCaller(ctx).collect({ runId: "run-1", pickupIndex: 99 })).rejects.toThrow(
      /too fast/i,
    )
    expect(dbMock.zrossRun.update).not.toHaveBeenCalled()
  })

  it("the first claim is exempt from the rate ceiling regardless of how fast it was reached", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ pickupsClaimed: 0, startedAt: new Date() }),
    )
    vi.mocked(dbMock.zrossRun.update).mockResolvedValue({ zpEarned: 1 })
    const r = await createCaller(ctx).collect({ runId: "run-1", pickupIndex: 0 })
    expect(r.score).toBe(1)
  })

  it("refuses a run that is not ACTIVE", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ status: "ENDED" }))
    await expect(createCaller(ctx).collect({ runId: "run-1", pickupIndex: 0 })).rejects.toThrow(
      /not active/i,
    )
  })

  it("refuses someone else's run", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ userId: "someone-else" }))
    await expect(createCaller(ctx).collect({ runId: "run-1", pickupIndex: 0 })).rejects.toThrow(
      /not found/i,
    )
  })
})

describe("zross.end", () => {
  it("returns the summary and flips the run to ENDED", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ zpEarned: 12, pickupsClaimed: 12 }),
    )
    vi.mocked(dbMock.zrossRun.updateMany).mockResolvedValue({ count: 1 })
    const r = await createCaller(ctx).end({ runId: "run-1" })
    expect(r).toEqual({ score: 12, pickups: 12, zpWon: 12, isPaidReplay: false })
    expect(dbMock.zrossRun.updateMany).toHaveBeenCalled()
  })

  it("end is idempotent — a second call is a no-op on the DB", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ status: "ENDED", zpEarned: 5, pickupsClaimed: 5 }),
    )
    const r = await createCaller(ctx).end({ runId: "run-1" })
    expect(r.score).toBe(5)
    expect(dbMock.zrossRun.updateMany).not.toHaveBeenCalled()
  })

  it("idempotent compare-and-set: losing the ACTIVE->ENDED race pays no crown", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ zpEarned: 30, pickupsClaimed: 30 }),
    )
    vi.mocked(dbMock.zrossRun.updateMany).mockResolvedValue({ count: 0 })
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })

  it("reports zpWon 0 for a paid replay even though it scored", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(
      activeRun({ status: "ENDED", zpEarned: 20, pickupsClaimed: 20, entryCost: REPLAY_COST }),
    )
    const r = await createCaller(ctx).end({ runId: "run-1" })
    expect(r.score).toBe(20)
    expect(r.zpWon).toBe(0)
    expect(r.isPaidReplay).toBe(true)
  })
})

describe("zross.end — all-time crown", () => {
  it("pays the crown when the run takes sole all-time #1", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 30, pickupsClaimed: 30 }))
    vi.mocked(dbMock.zrossRun.updateMany).mockResolvedValue({ count: 1 })
    // Everyone else tops out at 10; this user had never been ahead of them.
    vi.mocked(dbMock.zrossRun.aggregate)
      .mockResolvedValueOnce({ _max: { zpEarned: 10 } }) // others
      .mockResolvedValueOnce({ _max: { zpEarned: -1 } }) // mine before
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } },
    })
    // Leaderboard ZP names the board, the place and the amount.
    expect(notifyLeaderboardPrize).toHaveBeenCalledWith(
      USER_ID,
      "Zross",
      1,
      ALL_TIME_CROWN_ZP,
      "all-time",
    )
  })

  it("crown: a tie with the current leader pays nothing", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 10, pickupsClaimed: 10 }))
    vi.mocked(dbMock.zrossRun.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.zrossRun.aggregate)
      .mockResolvedValueOnce({ _max: { zpEarned: 10 } }) // others tie exactly
      .mockResolvedValueOnce({ _max: { zpEarned: -1 } })
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })

  it("crown: re-beating one's own record while already #1 pays nothing", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 30, pickupsClaimed: 30 }))
    vi.mocked(dbMock.zrossRun.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.zrossRun.aggregate)
      .mockResolvedValueOnce({ _max: { zpEarned: 10 } }) // others
      .mockResolvedValueOnce({ _max: { zpEarned: 15 } }) // mine before — already ahead of others
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })

  it("pays no crown when someone else is still ahead", async () => {
    vi.mocked(dbMock.zrossRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 3, pickupsClaimed: 3 }))
    vi.mocked(dbMock.zrossRun.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.zrossRun.aggregate).mockResolvedValue({ _max: { zpEarned: 50 } })
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })
})

describe("zross.leaderboard", () => {
  it("leaderboard ranks each user's best run and drops unscored rows", async () => {
    vi.mocked(dbMock.zrossRun.groupBy).mockResolvedValue([
      { userId: "u-1", _max: { zpEarned: 40 } },
      { userId: "u-2", _max: { zpEarned: 12 } },
      { userId: "u-3", _max: { zpEarned: 0 } },
    ])
    vi.mocked(dbMock.user.findMany).mockResolvedValue([
      { id: "u-1", name: "Ada", username: "ada", image: null },
      { id: "u-2", name: null, username: "bo", image: null },
    ])
    const rows = await createCaller(ctx).leaderboard({ scope: "today" })
    expect(rows.map((r) => [r.rank, r.userId, r.score])).toEqual([
      [1, "u-1", 40],
      [2, "u-2", 12],
    ])
    expect(dbMock.zrossRun.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    )
  })
})

describe("zross daily prize payout — idempotency", () => {
  it("a double cron fire pays the daily prize only once", async () => {
    vi.mocked(dbMock.zrossRun.findMany).mockResolvedValue([{ id: "run-1", userId: "u-1" }])
    vi.mocked(dbMock.zrossRun.updateMany)
      .mockResolvedValueOnce({ count: 1 }) // first fire: null -> value, credits
      .mockResolvedValueOnce({ count: 0 }) // second fire: already non-null, no-op

    const first = await awardZrossDailyPrizes("2026-07-28")
    expect(first).toBe(1)
    expect(dbMock.user.update).toHaveBeenCalledTimes(1)

    const second = await awardZrossDailyPrizes("2026-07-28")
    expect(second).toBe(0)
    expect(dbMock.user.update).toHaveBeenCalledTimes(1) // still just the one credit
  })
})
