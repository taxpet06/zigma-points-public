import { describe, it, expect } from "vitest"
import { pickDailyWinners, claimsAllTimeCrown } from "@/lib/daily-prizes"
import { previousDayKey } from "@/lib/day-key"
import { DAILY_PRIZES } from "@/lib/game-economy"

// rankedRuns must already be sorted best-first (the DB query does that).
describe("pickDailyWinners", () => {
  it("awards the top 3 distinct users the podium prizes, in order", () => {
    const runs = [{ userId: "a" }, { userId: "b" }, { userId: "c" }, { userId: "d" }]
    expect(pickDailyWinners(runs)).toEqual([
      { run: { userId: "a" }, rank: 1, prize: DAILY_PRIZES[0] },
      { run: { userId: "b" }, rank: 2, prize: DAILY_PRIZES[1] },
      { run: { userId: "c" }, rank: 3, prize: DAILY_PRIZES[2] },
    ])
  })

  it("counts only each user's best run — no user wins twice", () => {
    // 'a' has the two best runs; they should still only take rank 1.
    const runs = [{ userId: "a", n: 1 }, { userId: "a", n: 2 }, { userId: "b" }, { userId: "c" }]
    const winners = pickDailyWinners(runs)
    expect(winners.map((w) => w.run.userId)).toEqual(["a", "b", "c"])
    expect(winners[0].run).toEqual({ userId: "a", n: 1 }) // the first (best) 'a' run
  })

  it("awards fewer prizes when fewer than 3 users played", () => {
    expect(pickDailyWinners([{ userId: "a" }]).map((w) => w.prize)).toEqual([DAILY_PRIZES[0]])
    expect(pickDailyWinners([]).length).toBe(0)
  })
})

describe("claimsAllTimeCrown", () => {
  it("awards when dethroning another user (strictly ahead)", () => {
    // score 120, best other user 100, my own previous best 90 → I take the crown.
    expect(claimsAllTimeCrown(120, 100, 90)).toBe(true)
  })

  it("awards on an empty board (sentinels -1)", () => {
    expect(claimsAllTimeCrown(50, -1, -1)).toBe(true)
  })

  it("no award when already #1 and just beating your own record", () => {
    // I was already ahead (myBestBefore 100 > othersBest 90) — staying first pays nothing.
    expect(claimsAllTimeCrown(110, 90, 100)).toBe(false)
  })

  it("no award for merely tying the top", () => {
    expect(claimsAllTimeCrown(100, 100, 50)).toBe(false)
  })

  it("no award for a zero score", () => {
    expect(claimsAllTimeCrown(0, -1, -1)).toBe(false)
  })
})

describe("previousDayKey", () => {
  it("returns the day before, across a month boundary", () => {
    // 00:05 ET on Aug 1 → the day that just closed is Jul 31.
    expect(previousDayKey(new Date("2026-08-01T04:05:00Z"))).toBe("2026-07-31")
  })
})
