import { describe, it, expect, vi, beforeEach } from "vitest"

// downtimeState decides whether the entire site is reachable, so its three branches are
// the whole feature: an empty terms table must NOT close the app (a fresh or restored
// database would boot bricked, with nobody able to sign in and schedule the term that
// reopens it), a term containing now keeps it open, and terms that exist but none of
// which contains now is the only combination that closes it.
//
// The row shape mirrors what the Neon HTTP driver returns: counts arrive as strings
// because Postgres count() is bigint.

const query = vi.fn()
vi.mock("@neondatabase/serverless", () => ({ neon: () => query }))

async function stateFor(row: Record<string, unknown>) {
  // forced_down defaults to null (AUTO) unless a test overrides it.
  row = { forced_down: null, ...row }
  // Fresh module each time — downtimeState caches its verdict in module scope.
  vi.resetModules()
  query.mockResolvedValueOnce([row])
  const { downtimeState } = await import("@/lib/downtime")
  return downtimeState()
}

beforeEach(() => {
  query.mockReset()
  process.env.DATABASE_URL = "postgres://test/test"
})

describe("downtimeState", () => {
  it("stays OPEN when no term has ever existed", async () => {
    const s = await stateFor({ total: "0", active: "0", next_starts_at: null, next_name: null })
    expect(s.down).toBe(false)
  })

  it("stays OPEN while a term contains now", async () => {
    const s = await stateFor({ total: "2", active: "1", next_starts_at: null, next_name: null })
    expect(s.down).toBe(false)
  })

  it("closes when terms exist but none contains now", async () => {
    const s = await stateFor({
      total: "2",
      active: "0",
      next_starts_at: "2026-09-01T18:54:00.000Z",
      next_name: "26F",
    })
    expect(s.down).toBe(true)
    expect(s.nextName).toBe("26F")
    expect(s.nextStartsAt?.toISOString()).toBe("2026-09-01T18:54:00.000Z")
  })

  it("closes with no return date when nothing is scheduled yet", async () => {
    const s = await stateFor({ total: "1", active: "0", next_starts_at: null, next_name: null })
    expect(s.down).toBe(true)
    expect(s.nextStartsAt).toBeNull()
  })

  it("serves OPEN rather than throwing when the database is unreachable", async () => {
    vi.resetModules()
    query.mockRejectedValueOnce(new Error("neon unreachable"))
    const { downtimeState } = await import("@/lib/downtime")
    // A cold isolate that never got an answer must not wedge the site shut.
    await expect(downtimeState()).resolves.toMatchObject({ down: false })
  })

  it("caches, so gating every request does not mean querying on every request", async () => {
    vi.resetModules()
    query.mockResolvedValue([{ total: "1", active: "0", next_starts_at: null, next_name: null }])
    const { downtimeState } = await import("@/lib/downtime")
    await downtimeState()
    await downtimeState()
    await downtimeState()
    expect(query).toHaveBeenCalledTimes(1)
  })
})

// The admin override. null = follow the schedule; true/false win outright. This is what
// makes an interim DEFAULT to closed rather than IMPLY closed.
describe("downtimeState — admin override", () => {
  const between = { total: "2", active: "0", next_starts_at: null, next_name: null }
  const during = { total: "2", active: "1", next_starts_at: null, next_name: null }

  it("stays CLOSED between terms when following the schedule", async () => {
    const s = await stateFor(between)
    expect(s.down).toBe(true)
    expect(s.scheduledDown).toBe(true)
    expect(s.forcedDown).toBeNull()
  })

  it("FORCED OPEN keeps the app up between terms", async () => {
    const s = await stateFor({ ...between, forced_down: false })
    expect(s.down).toBe(false)
    // The schedule still says closed — the panel shows both so "open" is explicable.
    expect(s.scheduledDown).toBe(true)
    expect(s.forcedDown).toBe(false)
  })

  it("FORCED CLOSED shuts the app mid-term", async () => {
    const s = await stateFor({ ...during, forced_down: true })
    expect(s.down).toBe(true)
    expect(s.scheduledDown).toBe(false)
    expect(s.forcedDown).toBe(true)
  })

  it("clearing the override falls straight back to the schedule", async () => {
    expect((await stateFor({ ...during, forced_down: null })).down).toBe(false)
    expect((await stateFor({ ...between, forced_down: null })).down).toBe(true)
  })
})
