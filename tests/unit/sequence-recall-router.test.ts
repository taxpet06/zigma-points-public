import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mocks — same shape as znake-router.test.ts / zross-router.test.ts. dbMock is
// hoisted so the vi.mock factory can reference it safely.
const dbMock = vi.hoisted(() => {
  const mock = {
    sequenceRecallRun: {
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
import { sequenceRecallRouter } from "@/components/game-hub/sequence-recall/router"
import {
  FREE_PLAYS_PER_DAY,
  REPLAY_COST,
  ALL_TIME_CROWN_ZP,
  WINDOW_MS,
  CLOCK_SKEW_GRACE_MS,
  MIN_MS_PER_TAP,
} from "@/components/game-hub/sequence-recall/constants"
// Real engine — never mocked. Expected tap arrays for every state-machine test are
// derived at runtime from these, so a future change to the derivation can't
// silently turn an assertion into a no-op (the Phase 16-02 discipline).
import { targetForRound, maxRoundsInTier } from "@/components/game-hub/sequence-recall/engine"
import { PLAYED_RUN_WHERE } from "@/lib/game-economy"

const createCaller = createCallerFactory(sequenceRecallRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

/** A live run row, patchable per test. */
function activeRun(patch: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    userId: USER_ID,
    status: "ACTIVE",
    zpEarned: 0,
    tier: 1,
    round: 1,
    entryCost: 0,
    ...patch,
  }
}

beforeEach(() => {
  vi.mocked(notifyLeaderboardPrize).mockClear()
  for (const fn of Object.values(dbMock.sequenceRecallRun)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 1000 })
  vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
  // Default: someone else already holds the crown, so end() tests that don't care
  // about it aren't accidentally asserting a crown credit.
  vi.mocked(dbMock.sequenceRecallRun.aggregate).mockResolvedValue({ _max: { zpEarned: 9999 } })
})

describe("sequenceRecall.getStatus", () => {
  it("reports the free run as available before it is used", async () => {
    vi.mocked(dbMock.sequenceRecallRun.count).mockResolvedValue(0)
    const r = await createCaller(ctx).getStatus()
    expect(r.runsRemaining).toBe(FREE_PLAYS_PER_DAY)
    expect(r.replayCost).toBe(REPLAY_COST)
    expect(r.canPlay).toBe(true)
  })

  it("doesn't count a finished run that never scored — opened and closed is not played", async () => {
    vi.mocked(dbMock.sequenceRecallRun.count).mockResolvedValue(0)
    await createCaller(ctx).getStatus()
    expect(dbMock.sequenceRecallRun.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, day: expect.any(String), ...PLAYED_RUN_WHERE },
    })
  })

  it("free run used and too poor to replay -> canPlay false", async () => {
    vi.mocked(dbMock.sequenceRecallRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: REPLAY_COST - 1 })
    const r = await createCaller(ctx).getStatus()
    expect(r.runsRemaining).toBe(0)
    expect(r.canPlay).toBe(false)
  })
})

describe("sequenceRecall.start", () => {
  it("the day's first run is free, debits nothing, and starts at tier 1 round 1", async () => {
    vi.mocked(dbMock.sequenceRecallRun.count).mockResolvedValue(0)
    vi.mocked(dbMock.sequenceRecallRun.create).mockResolvedValue({
      id: "run-1",
      seed: 123,
      tier: 1,
      round: 1,
    })
    const r = await createCaller(ctx).start()
    expect(r.entryCost).toBe(0)
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
    expect(dbMock.sequenceRecallRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entryCost: 0 }) }),
    )
    expect(r.tier).toBe(1)
    expect(r.round).toBe(1)
  })

  it("charges REPLAY_COST once the free run is gone", async () => {
    vi.mocked(dbMock.sequenceRecallRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.sequenceRecallRun.create).mockResolvedValue({
      id: "run-2",
      seed: 456,
      tier: 1,
      round: 1,
    })
    const r = await createCaller(ctx).start()
    expect(r.entryCost).toBe(REPLAY_COST)
    expect(dbMock.sequenceRecallRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entryCost: REPLAY_COST }) }),
    )
    expect(dbMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID, zigmaPoints: { gte: REPLAY_COST } },
        data: { zigmaPoints: { decrement: REPLAY_COST } },
      }),
    )
  })

  it("refuses the replay when the conditional debit matches no row (too poor) — no run is created", async () => {
    vi.mocked(dbMock.sequenceRecallRun.count).mockResolvedValue(FREE_PLAYS_PER_DAY)
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 0 })
    await expect(createCaller(ctx).start()).rejects.toThrow(/need \d+ ZP/)
    expect(dbMock.sequenceRecallRun.create).not.toHaveBeenCalled()
  })
})

describe("sequenceRecall.end", () => {
  it("returns the summary and flips the run to ENDED", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ zpEarned: 12, tier: 3, round: 2 }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })
    const r = await createCaller(ctx).end({ runId: "run-1" })
    expect(r).toEqual({ zpEarned: 12, tier: 3, round: 2, zpWon: 12, isPaidReplay: false })
    expect(dbMock.sequenceRecallRun.updateMany).toHaveBeenCalled()
  })

  it("is idempotent — a second call on an already-ENDED run is a no-op on the DB", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ status: "ENDED", zpEarned: 5, tier: 2, round: 1 }),
    )
    const r = await createCaller(ctx).end({ runId: "run-1" })
    expect(r.zpEarned).toBe(5)
    expect(dbMock.sequenceRecallRun.updateMany).not.toHaveBeenCalled()
  })

  it("reports zpWon 0 for a paid replay even though it scored", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ status: "ENDED", zpEarned: 20, tier: 4, round: 1, entryCost: REPLAY_COST }),
    )
    const r = await createCaller(ctx).end({ runId: "run-1" })
    expect(r.zpEarned).toBe(20)
    expect(r.zpWon).toBe(0)
    expect(r.isPaidReplay).toBe(true)
  })

  it("pays ALL_TIME_CROWN_ZP when the run takes sole all-time #1", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 30 }))
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })
    // Everyone else tops out at 10; this user had never been ahead of them.
    vi.mocked(dbMock.sequenceRecallRun.aggregate)
      .mockResolvedValueOnce({ _max: { zpEarned: 10 } }) // others
      .mockResolvedValueOnce({ _max: { zpEarned: -1 } }) // mine before
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } },
    })
    expect(notifyLeaderboardPrize).toHaveBeenCalledWith(
      USER_ID,
      "Monkey Test",
      1,
      ALL_TIME_CROWN_ZP,
      "all-time",
    )
  })

  it("lost the ACTIVE->ENDED compare-and-set race — pays no crown", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 30 }))
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 0 })
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })

  it("pays no crown when someone else is still ahead", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(activeRun({ zpEarned: 3 }))
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.sequenceRecallRun.aggregate).mockResolvedValue({ _max: { zpEarned: 50 } })
    await createCaller(ctx).end({ runId: "run-1" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })
})

describe("sequenceRecall.leaderboard", () => {
  it("ranks each user's best run, drops unscored rows, caps at 10", async () => {
    vi.mocked(dbMock.sequenceRecallRun.groupBy).mockResolvedValue([
      { userId: "u-1", _max: { zpEarned: 40 } },
      { userId: "u-2", _max: { zpEarned: 12 } },
      { userId: "u-3", _max: { zpEarned: 5 } },
      { userId: "u-4", _max: { zpEarned: 0 } },
    ])
    vi.mocked(dbMock.user.findMany).mockResolvedValue([
      { id: "u-1", name: "Ada", username: "ada", image: null },
      { id: "u-2", name: null, username: "bo", image: null },
      { id: "u-3", name: "Cy", username: "cy", image: null },
    ])
    const rows = await createCaller(ctx).leaderboard({ scope: "today" })
    expect(rows.length).toBeLessThanOrEqual(10)
    expect(rows.map((r) => [r.rank, r.userId, r.score])).toEqual([
      [1, "u-1", 40],
      [2, "u-2", 12],
      [3, "u-3", 5],
    ])
    expect(dbMock.sequenceRecallRun.groupBy).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }))
  })
})

describe("sequenceRecall.beginRound", () => {
  it("arms the window once with a server timestamp, as an atomic compare-and-set", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ seed: 42, tier: 3, round: 2, roundInputStartedAt: null }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })

    const r = await createCaller(ctx).beginRound({ runId: "run-1", tier: 3, round: 2 })

    // `roundInputStartedAt: null` in the WHERE is the whole point — it makes the row's
    // own state the arbiter, so exactly one caller can ever arm the window. Asserting on
    // the guard (not just that a write happened) is what stops a future refactor from
    // quietly reverting this to a read-then-write race.
    expect(dbMock.sequenceRecallRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roundInputStartedAt: null }),
        data: { roundInputStartedAt: expect.any(Date) },
      }),
    )
    expect(r.sequenceLength).toBe(3 * 2)
    expect(r.roundInputStartedAt).toBeInstanceOf(Date)
  })

  it("loses the arm race and adopts the winner's timestamp, never its own", async () => {
    const winnerStamp = new Date("2026-01-01T00:00:00.000Z")
    vi.mocked(dbMock.sequenceRecallRun.findUnique)
      // First read: the run, still unarmed as far as this transaction can see.
      .mockResolvedValueOnce(activeRun({ seed: 42, tier: 3, round: 2, roundInputStartedAt: null }))
      // Second read: the re-read after losing the CAS, showing the winner's stamp.
      .mockResolvedValueOnce({ roundInputStartedAt: winnerStamp })
    // count 0 => a concurrent beginRound already flipped null -> value first.
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 0 })

    const r = await createCaller(ctx).beginRound({ runId: "run-1", tier: 3, round: 2 })

    // Our own stamp is by definition the later one; returning it would slide the window
    // forward and hand the player extra time — the exact bug the CAS exists to prevent.
    expect(r.roundInputStartedAt).toEqual(winnerStamp)
  })

  it("is idempotent — a retry never buys the player extra time", async () => {
    const armedAt = new Date("2026-01-01T00:00:00.000Z")
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ tier: 1, round: 1, roundInputStartedAt: armedAt }),
    )

    const r = await createCaller(ctx).beginRound({ runId: "run-1", tier: 1, round: 1 })

    expect(r.roundInputStartedAt).toEqual(armedAt)
    expect(dbMock.sequenceRecallRun.update).not.toHaveBeenCalled()
  })

  it("rejects a stale round with CONFLICT", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ tier: 2, round: 1, roundInputStartedAt: null }),
    )

    await expect(
      createCaller(ctx).beginRound({ runId: "run-1", tier: 2, round: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
})

describe("sequenceRecall.submitRound", () => {
  it("rejects a stale round with CONFLICT — a replayed submission is never re-scored", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ tier: 2, round: 1, roundInputStartedAt: new Date() }),
    )

    await expect(
      createCaller(ctx).submitRound({ runId: "run-1", tier: 2, round: 2, taps: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(dbMock.sequenceRecallRun.update).not.toHaveBeenCalled()
  })

  it("rejects a submission for a round that was never armed", async () => {
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ tier: 1, round: 1, roundInputStartedAt: null }),
    )

    await expect(
      createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 1, taps: [0] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("banks exactly 1 ZP on a correct free-run round", async () => {
    const seed = 777
    const expected = targetForRound(seed, 1, 1)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 1,
        entryCost: 0,
        zpEarned: 0,
        roundInputStartedAt: new Date(Date.now() - 1000),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 1, taps: expected })

    expect(dbMock.sequenceRecallRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ zpEarned: { increment: 1 } }) }),
    )
    expect(r.correct).toBe(true)
    expect(r.runEnded).toBe(false)
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: 1 } },
    })
  })

  it("scores a paid replay but banks nothing to the user's balance", async () => {
    const seed = 555
    const expected = targetForRound(seed, 1, 1)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 1,
        entryCost: REPLAY_COST,
        zpEarned: 0,
        roundInputStartedAt: new Date(Date.now() - 1000),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 1 })

    await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 1, taps: expected })

    expect(dbMock.sequenceRecallRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ zpEarned: { increment: 1 } }) }),
    )
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("awards a flat 1 ZP at a 12-tile round, never scaled by tier or length", async () => {
    const seed = 321
    const expected = targetForRound(seed, 4, 3)
    expect(expected.length).toBe(12) // tier 4 * round 3
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 4,
        round: 3,
        entryCost: 0,
        zpEarned: 5,
        roundInputStartedAt: new Date(Date.now() - 2000),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 6 })

    await createCaller(ctx).submitRound({ runId: "run-1", tier: 4, round: 3, taps: expected })

    expect(dbMock.sequenceRecallRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ zpEarned: { increment: 1 } }) }),
    )
  })

  it("wrong order fails and settles the run", async () => {
    const seed = 99
    const expected = targetForRound(seed, 1, 3)
    const taps = [...expected]
    const last = taps.length - 1
    ;[taps[last], taps[last - 1]] = [taps[last - 1], taps[last]]
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ seed, tier: 1, round: 3, zpEarned: 2, roundInputStartedAt: new Date(Date.now() - 800) }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 3, taps })

    expect(r.correct).toBe(false)
    expect(r.reason).toBe("wrong")
    expect(r.runEnded).toBe(true)
    expect(dbMock.sequenceRecallRun.updateMany).toHaveBeenCalled()
  })

  it("tier advance: clearing a tier's last round advances with no re-entry cost", async () => {
    const seed = 88
    const round = maxRoundsInTier(3)
    const expected = targetForRound(seed, 3, round)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ seed, tier: 3, round, zpEarned: 10, roundInputStartedAt: new Date(Date.now() - 2000) }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 11 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 3, round, taps: expected })

    expect(r.tierCleared).toBe(true)
    expect(r.tier).toBe(4)
    expect(r.round).toBe(1)
    expect(r.runEnded).toBe(false)
    expect(dbMock.sequenceRecallRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tier: 4, round: 1 }) }),
    )
  })

  it("tier-25 loop: clearing tier 25 loops back to tier 1 and stays ACTIVE", async () => {
    const seed = 200
    const expected = targetForRound(seed, 25, 1)
    expect(expected.length).toBe(25)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ seed, tier: 25, round: 1, zpEarned: 300, roundInputStartedAt: new Date(Date.now() - 2000) }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 301 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 25, round: 1, taps: expected })

    expect(r.tier).toBe(1)
    expect(r.round).toBe(1)
    expect(r.tierCleared).toBe(true)
    expect(r.runEnded).toBe(false)
    // The run stays ACTIVE at the ceiling — the status compare-and-set that settleEndedRunInTx
    // performs must never fire on a successful tier-25 clear.
    expect(dbMock.sequenceRecallRun.updateMany).not.toHaveBeenCalled()
  })

  // A wrong tile, a wrong order, or the window elapsing ends the run immediately, with the
  // ZP banked so far. Failure does NOT escalate the tier and does NOT reset-in-place — this
  // is the locked 21-CONTEXT.md "Failure behavior" rule, which explicitly supersedes
  // 21-RESEARCH.md's older (unconfirmed) "failure escalates the tier" sketch.
  it("failure ends the run at the tier/round it happened, does not escalate", async () => {
    const seed = 44
    const expected = targetForRound(seed, 3, 2)
    const taps = [...expected]
    taps[0] = (taps[0] + 1) % 25 // guaranteed mismatch on the first tap
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({ seed, tier: 3, round: 2, zpEarned: 4, roundInputStartedAt: new Date(Date.now() - 800) }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 3, round: 2, taps })

    expect(r.correct).toBe(false)
    expect(r.runEnded).toBe(true)
    expect(r.tier).toBe(3)
    expect(r.round).toBe(2)
    expect(dbMock.sequenceRecallRun.updateMany).toHaveBeenCalled()
  })
})

describe("sequenceRecall.submitRound — timing boundaries", () => {
  // Time-precise boundary assertions use fake timers so elapsedMs is exact — real-clock
  // deltas would be flaky by a few ms of test-execution jitter right at the boundary.
  const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z").getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("times out when elapsed exceeds WINDOW_MS + CLOCK_SKEW_GRACE_MS", async () => {
    const seed = 11
    const expected = targetForRound(seed, 1, 1)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 1,
        zpEarned: 0,
        roundInputStartedAt: new Date(FIXED_NOW - (WINDOW_MS + CLOCK_SKEW_GRACE_MS + 1)),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 1, taps: expected })

    expect(r.reason).toBe("timeout")
    expect(r.runEnded).toBe(true)
  })

  it("succeeds exactly at the WINDOW_MS + CLOCK_SKEW_GRACE_MS boundary", async () => {
    const seed = 11
    const expected = targetForRound(seed, 1, 1)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 1,
        zpEarned: 0,
        roundInputStartedAt: new Date(FIXED_NOW - (WINDOW_MS + CLOCK_SKEW_GRACE_MS)),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 1, taps: expected })

    expect(r.correct).toBe(true)
  })

  it("rejects a too-fast submission below expected.length * MIN_MS_PER_TAP", async () => {
    const seed = 22
    const expected = targetForRound(seed, 1, 5)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 5,
        zpEarned: 0,
        roundInputStartedAt: new Date(FIXED_NOW - (expected.length * MIN_MS_PER_TAP - 1)),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 5, taps: expected })

    expect(r.reason).toBe("tooFast")
    expect(r.runEnded).toBe(true)
  })

  it("succeeds exactly at the expected.length * MIN_MS_PER_TAP boundary", async () => {
    const seed = 22
    const expected = targetForRound(seed, 1, 5)
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 5,
        zpEarned: 0,
        roundInputStartedAt: new Date(FIXED_NOW - expected.length * MIN_MS_PER_TAP),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.update).mockResolvedValue({ zpEarned: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 5, taps: expected })

    expect(r.correct).toBe(true)
  })

  it("treats an incomplete-but-correct prefix as a timeout, not wrong", async () => {
    const seed = 33
    const expected = targetForRound(seed, 1, 5)
    const partial = expected.slice(0, 3) // correct so far, but shorter than expected
    vi.mocked(dbMock.sequenceRecallRun.findUnique).mockResolvedValue(
      activeRun({
        seed,
        tier: 1,
        round: 5,
        zpEarned: 0,
        // Well inside the window, well above the too-fast floor.
        roundInputStartedAt: new Date(FIXED_NOW - 1000),
      }),
    )
    vi.mocked(dbMock.sequenceRecallRun.updateMany).mockResolvedValue({ count: 1 })

    const r = await createCaller(ctx).submitRound({ runId: "run-1", tier: 1, round: 5, taps: partial })

    expect(r.reason).toBe("timeout")
    expect(r.correct).toBe(false)
  })
})
