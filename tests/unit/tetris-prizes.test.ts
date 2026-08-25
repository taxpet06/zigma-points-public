import { describe, it, expect, vi, beforeEach } from "vitest"

// pickDailyWinners / claimsAllTimeCrown are reused verbatim from daily-prizes.ts and
// are already covered by tests/unit/daily-prizes.test.ts — this file focuses on
// awardTetrisDailyPrizes's own DB-facing behavior: ranking by score and the
// dailyPrizeZp null->prize idempotent compare-and-set.
const dbMock = vi.hoisted(() => {
  const mock = {
    tetrisRun: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mock)),
  }
  return mock
})

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/notifications", () => ({ notifyLeaderboardPrize: vi.fn() }))
vi.mock("next/server", () => ({ after: (fn: () => void) => { void fn() } }))

import { awardTetrisDailyPrizes } from "@/lib/tetris-prizes"
import { notifyLeaderboardPrize } from "@/lib/notifications"
import { DAILY_PRIZES } from "@/lib/tetris/constants"

const DAY = "2026-07-19"

beforeEach(() => {
  for (const fn of Object.values(dbMock.tetrisRun)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.user.update).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(notifyLeaderboardPrize).mockClear()
})

describe("awardTetrisDailyPrizes", () => {
  it("queries ENDED runs for the day ordered by score desc, and pays the top 3 the podium prizes", async () => {
    vi.mocked(dbMock.tetrisRun.findMany).mockResolvedValue([
      { id: "r-1", userId: "u-1" },
      { id: "r-2", userId: "u-2" },
      { id: "r-3", userId: "u-3" },
      { id: "r-4", userId: "u-4" },
    ])
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 1 })

    const awarded = await awardTetrisDailyPrizes(DAY)

    expect(dbMock.tetrisRun.findMany).toHaveBeenCalledWith({
      where: { day: DAY, status: "ENDED", score: { gt: 0 } },
      orderBy: { score: "desc" },
      select: { id: true, userId: true },
    })
    expect(awarded).toBe(3)
    expect(dbMock.user.update).toHaveBeenCalledTimes(3)
    DAILY_PRIZES.forEach((prize, i) => {
      expect(dbMock.tetrisRun.updateMany).toHaveBeenCalledWith({
        where: { id: `r-${i + 1}`, dailyPrizeZp: null },
        data: { dailyPrizeZp: prize },
      })
      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: `u-${i + 1}` },
        data: { zigmaPoints: { increment: prize } },
      })
    })
    expect(notifyLeaderboardPrize).toHaveBeenCalledTimes(3)
    // Each winner is told their actual placing + payout, not just "balance changed".
    expect(notifyLeaderboardPrize).toHaveBeenCalledWith("u-1", "Petris", 1, DAILY_PRIZES[0])
  })

  it("dedupes to each user's best run — no user is paid twice", async () => {
    vi.mocked(dbMock.tetrisRun.findMany).mockResolvedValue([
      { id: "r-1", userId: "u-1" }, // u-1's best
      { id: "r-2", userId: "u-1" }, // u-1's second-best — skipped
      { id: "r-3", userId: "u-2" },
    ])
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 1 })

    const awarded = await awardTetrisDailyPrizes(DAY)

    expect(awarded).toBe(2)
    expect(dbMock.tetrisRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "r-2" }) }),
    )
  })

  it("is idempotent — a second fire on the same day credits nothing (dailyPrizeZp already set)", async () => {
    vi.mocked(dbMock.tetrisRun.findMany).mockResolvedValue([{ id: "r-1", userId: "u-1" }])
    // Compare-and-set finds dailyPrizeZp already non-null -> updates 0 rows.
    vi.mocked(dbMock.tetrisRun.updateMany).mockResolvedValue({ count: 0 })

    const awarded = await awardTetrisDailyPrizes(DAY)

    expect(awarded).toBe(0)
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(notifyLeaderboardPrize).not.toHaveBeenCalled()
  })

  it("returns 0 and touches nothing when no one scored that day", async () => {
    vi.mocked(dbMock.tetrisRun.findMany).mockResolvedValue([])
    const awarded = await awardTetrisDailyPrizes(DAY)
    expect(awarded).toBe(0)
    expect(dbMock.tetrisRun.updateMany).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })
})
