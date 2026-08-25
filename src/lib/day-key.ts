// Single source of truth for the daily-reset boundary. Everything that resets once a
// day — the slot spin, Wordle, the "come back tomorrow" countdown — keys off the
// calendar day in RESET_TZ, so the whole app rolls over together at local midnight.
//
// RESET_TZ is an IANA zone name, so DST is handled by the platform (Intl), not by us.

export const RESET_TZ = "America/New_York"

/** Calendar-day key ("YYYY-MM-DD") in RESET_TZ. Doubles as the per-user unique key
 *  and the reset boundary; en-CA formats as ISO yyyy-mm-dd. */
export function dayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: RESET_TZ }).format(now)
}

/** The day-key for the calendar day BEFORE dayKey(now) — i.e. the day a midnight reset
 *  closes out. Pure calendar-string math (subtract one UTC day from the YYYY-MM-DD), so
 *  it's correct regardless of how soon after midnight the cron actually fires. */
export function previousDayKey(now: Date = new Date()): string {
  const d = new Date(dayKey(now) + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Milliseconds until the next RESET_TZ midnight — for the live "next reset" countdown.
 *  Derived from the wall-clock time in RESET_TZ, so it stays correct across DST. */
export function msUntilReset(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RESET_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now)
  const val = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const hour = val("hour") % 24 // Intl can report "24" at midnight
  const elapsed = hour * 3600 + val("minute") * 60 + val("second")
  return (86_400 - elapsed) * 1000 - now.getMilliseconds()
}
