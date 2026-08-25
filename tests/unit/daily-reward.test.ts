import { describe, it, expect } from "vitest"
import { ZP_BY_TICKS, todayKey, rollDailyReward } from "@/lib/daily-reward"

describe("daily reward roll", () => {
  it("maps tick count to the ZP tiers (0/1/3/5)", () => {
    expect(ZP_BY_TICKS).toEqual([0, 1, 3, 5])
  })

  // todayKey re-exports dayKey, whose boundary is RESET_TZ (America/New_York) — NOT UTC.
  // The whole app rolls over together at ET midnight (src/lib/day-key.ts), so the cases
  // below straddle the ET boundary, not the UTC one. This test previously asserted UTC
  // and had been failing since the reset boundary moved to ET; the assertion was stale,
  // the function is correct — switching dayKey to UTC would shift every daily reset.
  it("todayKey is a YYYY-MM-DD string on the ET reset boundary", () => {
    // 23:59:59 UTC on the 12th is still 19:59:59 ET on the 12th.
    expect(todayKey(new Date("2026-07-12T23:59:59Z"))).toBe("2026-07-12")
    // 00:00 UTC on the 13th is only 20:00 ET on the 12th — the day has NOT rolled yet.
    expect(todayKey(new Date("2026-07-13T00:00:00Z"))).toBe("2026-07-12")
    // 03:59:59 UTC is 23:59:59 EDT — the last second of the 12th in RESET_TZ.
    expect(todayKey(new Date("2026-07-13T03:59:59Z"))).toBe("2026-07-12")
    // 04:00 UTC is exactly ET midnight in July (EDT, UTC-4) — the roll-over instant.
    expect(todayKey(new Date("2026-07-13T04:00:00Z"))).toBe("2026-07-13")
  })

  it("rolls three reels and zp always matches the tick count", () => {
    for (let i = 0; i < 500; i++) {
      const { slots, ticks, zp } = rollDailyReward()
      expect(slots).toHaveLength(3)
      expect(ticks).toBe(slots.filter(Boolean).length)
      expect(zp).toBe(ZP_BY_TICKS[ticks])
    }
  })
})
