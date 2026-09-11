// Downtime — the one place "is Zigma Points open?" is answered.
//
// A term is a fixed calendar window (schema.prisma § Terms). By DEFAULT the app is
// OPEN while now sits inside one and CLOSED in the gap between them — from the last
// term's endsAt until the next term's startsAt.
//
// An admin can disagree with that schedule: downtime_override.forcedDown is a
// tri-state (null = follow the schedule, true = closed now, false = open now) and, when
// set, it wins outright. So an interim no longer *implies* downtime — it defaults to
// it. See schema.prisma § DowntimeOverride and admin.setDowntime.
//
// This is deliberately NOT the rule currentTerm() uses in lib/terms.ts, nor
// latestStartedTerm()'s. currentTerm() moves to the NEXT term the moment one ends (so
// new activity belongs there); latestStartedTerm() keeps returning the term that just
// ended (so a finished board stays readable). Open-vs-closed is a third question and
// must not disturb either.
//
// Zero terms in the table is NOT downtime. That is the pre-term state the schema already
// models with `termId: null`, and isCurrentTerm() already refuses to lock there: "before
// any term exists nothing gets stamped, and nothing should be locked either." It also
// keeps a fresh database (dev, CI, a restored dump) from booting bricked — closed, with
// no admin able to log in and schedule the term that would reopen it.
//
// Queried over Neon's HTTP driver rather than Prisma: middleware runs on the Edge
// Runtime, where the WebSocket adapter in lib/db.ts cannot follow.

import { neon } from "@neondatabase/serverless"

export type DowntimeState = {
  /** The verdict every caller acts on: the override if one is set, else the schedule. */
  down: boolean
  /** What the term schedule alone would say — what `down` reverts to at AUTO. */
  scheduledDown: boolean
  /** The admin override in force: null = following the schedule. */
  forcedDown: boolean | null
  /** When the next term opens — null if no future term is scheduled yet. */
  nextStartsAt: Date | null
  nextName: string | null
}

const OPEN: DowntimeState = {
  down: false,
  scheduledDown: false,
  forcedDown: null,
  nextStartsAt: null,
  nextName: null,
}

// ponytail: module-scope cache, not a store. A gate on every request costs ~one query
// per minute per isolate, and the door opens and shuts up to 60s late — noise against a
// three-week break.
//
// That lateness now also applies to the ADMIN TOGGLE: flipping downtime takes up to
// TTL_MS to reach every serverless isolate, because each one caches independently and
// nothing can invalidate them from outside. The admin's own next request is served by
// whichever isolate it lands on, so the portal can briefly disagree with itself. 15s
// keeps a manual flip feeling deliberate rather than broken, at 4x the query rate on a
// gate that is one indexed lookup. Lower it further only if that ever matters.
const TTL_MS = 15_000
let cached: DowntimeState = OPEN
let cachedAt = 0

export async function downtimeState(): Promise<DowntimeState> {
  if (Date.now() - cachedAt < TTL_MS) return cached

  try {
    const sql = neon(process.env.DATABASE_URL!)
    // startsAt/endsAt are TIMESTAMP(3) WITHOUT time zone holding UTC (Prisma's mapping),
    // so now() — a timestamptz — must be pulled into UTC before comparing, and the value
    // read back out must be re-tagged as UTC. Skip either and the answer silently follows
    // whatever TimeZone the session happens to have.
    const [row] = await sql`
      SELECT
        -- The override, read in the same round trip as the schedule it can veto.
        (SELECT "forcedDown" FROM downtime_override WHERE id = 'singleton') AS forced_down,
        (SELECT count(*) FROM terms) AS total,
        (SELECT count(*) FROM terms
          WHERE "startsAt" <= (now() AT TIME ZONE 'UTC')
            AND "endsAt"   >= (now() AT TIME ZONE 'UTC')) AS active,
        -- id breaks the tie: two terms sharing a startsAt would otherwise let these two
        -- independent subqueries land on different rows, printing one term's name above
        -- another term's date.
        (SELECT "startsAt" AT TIME ZONE 'UTC' FROM terms
          WHERE "startsAt" > (now() AT TIME ZONE 'UTC')
          ORDER BY "startsAt", id LIMIT 1) AS next_starts_at,
        (SELECT name FROM terms
          WHERE "startsAt" > (now() AT TIME ZONE 'UTC')
          ORDER BY "startsAt", id LIMIT 1) AS next_name
    `
    const scheduledDown = Number(row.total) > 0 && Number(row.active) === 0
    // Postgres NULL arrives as JS null, which is exactly the AUTO case — so `?? ` is
    // the whole tri-state, no branching needed.
    const forcedDown = (row.forced_down as boolean | null) ?? null
    cached = {
      down: forcedDown ?? scheduledDown,
      scheduledDown,
      forcedDown,
      nextStartsAt: row.next_starts_at ? new Date(row.next_starts_at as string) : null,
      nextName: (row.next_name as string | null) ?? null,
    }
    cachedAt = Date.now()
  } catch (err) {
    // Fail OPEN, and do NOT stamp cachedAt — a transient Neon error must never close the
    // app for everyone, and the next request retries instead of serving a stale verdict
    // for a minute. Worst case the site stays up a little into a break.
    //
    // LOUDLY, though. This query also reads downtime_override, so an unapplied migration
    // makes every call throw and the app silently never closes — a failure whose only
    // symptom is the absence of one. Log it so the cause is in the logs, not inferred.
    console.error("[downtime] state lookup failed — failing OPEN", err)
    return cached
  }

  return cached
}
