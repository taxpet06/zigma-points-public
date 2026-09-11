import { describe, it, expect } from "vitest"
import { nextDueBoundary, START_LEAD_MS, TERM_RESET_WINDOW_DAYS } from "@/lib/term-reset"

// This rule decides whether every balance in the app gets zeroed, so the cases worth
// pinning are the ones that would either fire when they shouldn't or fail to fire when
// they should.

const NOW = new Date("2026-08-26T00:00:00Z")
const CUTOFF = new Date(NOW.getTime() - TERM_RESET_WINDOW_DAYS * 86400_000)
const d = (iso: string) => new Date(iso)

// Start boundaries default to long ago (outside the window), so the end-boundary cases
// below only see their end boundary. Pass `startsAt` to exercise the start wipe.
const term = (name: string, endsAt: string, wipedAt?: Date, startsAt = "2026-01-01T00:00:00Z") => ({
  id: `id-${name}`,
  name,
  startsAt: d(startsAt),
  endsAt: d(endsAt),
  zpResetStartedAt: null as Date | null,
  zpResetEndedAt: wipedAt ?? null,
})

describe("nextDueBoundary", () => {
  it("fires on a term that ENDED recently even though it started months ago", () => {
    // The regression this exists for: filtering terms by startsAt alone missed 26X
    // entirely — started 1 June, ended hours ago — so the end-of-term wipe never ran.
    const t = term("26X", "2026-08-25T22:00:00Z")
    expect(nextDueBoundary([t], NOW, CUTOFF)?.label).toBe("26X:end")
  })

  it("never fires for boundaries older than the window", () => {
    // A term from last spring must not wipe balances on the first deploy.
    const old = term("26S", "2026-05-31T04:00:00Z")
    expect(nextDueBoundary([old], NOW, CUTOFF)).toBeUndefined()
  })

  it("does not fire for a boundary that has not passed yet", () => {
    const future = term("26F", "2026-11-26T09:59:00Z")
    expect(nextDueBoundary([future], NOW, CUTOFF)).toBeUndefined()
  })

  it("skips a boundary already marked done", () => {
    const t = term("26X", "2026-08-25T22:00:00Z", d("2026-08-25T22:05:00Z"))
    expect(nextDueBoundary([t], NOW, CUTOFF)).toBeUndefined()
  })

  it("takes the OLDEST outstanding boundary first", () => {
    // Two terms closed without a wipe — they run in the order they ended, one per tick.
    const a = term("26A", "2026-08-10T00:00:00Z")
    const b = term("26B", "2026-08-20T00:00:00Z")
    expect(nextDueBoundary([b, a], NOW, CUTOFF)?.label).toBe("26A:end")
    a.zpResetEndedAt = d("2026-08-10T00:05:00Z")
    expect(nextDueBoundary([b, a], NOW, CUTOFF)?.label).toBe("26B:end")
  })

  it("fires a START boundary one lead before the term opens, not after", () => {
    // The break-time balances 26F would otherwise have opened on.
    const f = term("26F", "2026-11-26T09:59:00Z", undefined, "2026-09-11T04:00:00Z")
    const at = (iso: string) => {
      const now = d(iso)
      return nextDueBoundary([f], now, new Date(now.getTime() - TERM_RESET_WINDOW_DAYS * 86400_000))
    }
    expect(at("2026-09-11T03:44:59Z")).toBeUndefined()
    expect(START_LEAD_MS).toBe(15 * 60 * 1000)
    expect(at("2026-09-11T03:45:00Z")?.label).toBe("26F:start")
    // A missed tick still wipes, late.
    expect(at("2026-09-11T04:10:00Z")?.label).toBe("26F:start")
    f.zpResetStartedAt = d("2026-09-11T03:45:00Z")
    expect(at("2026-09-11T04:10:00Z")).toBeUndefined()
  })

  it("runs the previous term's END before the next term's START", () => {
    const x = term("26X", "2026-08-25T22:00:00Z")
    const f = term("26F", "2026-11-26T09:59:00Z", undefined, "2026-08-25T23:00:00Z")
    expect(nextDueBoundary([f, x], NOW, CUTOFF)?.label).toBe("26X:end")
    x.zpResetEndedAt = d("2026-08-25T22:05:00Z")
    expect(nextDueBoundary([f, x], NOW, CUTOFF)?.label).toBe("26F:start")
  })

  it("skips the START wipe of a back-to-back term — the previous term is still running", () => {
    // Firing a lead before 26F opens would zero 26X's balances before 26X is scored.
    const now = d("2026-08-25T21:50:00Z")
    const x = term("26X", "2026-08-25T22:00:00Z")
    const f = term("26F", "2026-11-26T09:59:00Z", undefined, "2026-08-25T22:00:00Z")
    expect(nextDueBoundary([x, f], now, CUTOFF)).toBeUndefined()
  })

  it("returns nothing for an empty term table", () => {
    expect(nextDueBoundary([], NOW, CUTOFF)).toBeUndefined()
  })
})
