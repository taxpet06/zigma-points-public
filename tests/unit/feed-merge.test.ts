// post.getFeed merges two tables (posts + BET tasks) behind one keyset cursor.
// The failure modes worth a test are the paging ones: a row shown twice, a row
// skipped, or same-millisecond rows losing their tie-break between the tables.

import { describe, it, expect, vi } from "vitest"

type Row = { id: string; createdAt: Date }

// Minimal Prisma double: honours the keyset `where.OR`, the (createdAt desc, id desc)
// ordering and `take`. Everything else in the query is passed through untouched.
function paginate<T extends Row>(rows: T[], where: Record<string, unknown> | undefined, take: number): T[] {
  let out = rows
  const or = where?.OR as
    | [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt?: string; lte?: string } }]
    | undefined
  if (or) {
    const at = or[0].createdAt.lt
    // Read the tie operator as written rather than assuming `lt` — an accidental
    // `lte` in the router is exactly the bug that duplicates a row across pages,
    // and a fake that hardcodes `lt` would silently absolve it.
    const tie = or[1].id
    out = out.filter(
      (r) =>
        r.createdAt < at ||
        (r.createdAt.getTime() === at.getTime() &&
          (tie.lt !== undefined ? r.id < tie.lt : r.id <= tie.lte!)),
    )
  }
  return [...out]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, take)
}

const T = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min))

// Two rows deliberately share T(5) across the two tables — the tie-break case.
const POSTS = [
  { id: "p9", createdAt: T(9) },
  { id: "p7", createdAt: T(7) },
  { id: "p5", createdAt: T(5) },
  { id: "p2", createdAt: T(2) },
  { id: "p1", createdAt: T(1) },
].map((r) => ({
  ...r,
  type: "AWARD" as const,
  title: r.id,
  explanation: "",
  zpAmount: 1,
  mediaUrl: null,
  images: [],
  outcome: null,
  settled: false,
  votingEndsAt: r.createdAt,
  author: { id: "u1", name: "A", image: null, username: null, equippedRing: null },
  targets: [],
  votes: [],
  _count: { replies: 0 },
}))

const POOLS = [
  { id: "b8", createdAt: T(8) },
  { id: "b6", createdAt: T(6) },
  { id: "b5", createdAt: T(5) },
  { id: "b0", createdAt: T(0) },
].map((r) => ({
  ...r,
  title: r.id,
  description: "",
  mediaUrl: null,
  images: [],
  minBet: 5,
  betsCloseAt: null,
  winningChoice: null,
  betSettledAt: null,
  admin: { id: "u1", name: "A", image: null, username: null, equippedRing: null },
  _count: { replies: 0 },
}))

const dbMock = vi.hoisted(() => ({
  post: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ db: dbMock, runSerializable: vi.fn() }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { postRouter } from "@/trpc/routers/post"

const caller = createCallerFactory(postRouter)({
  session: { user: { id: "u1" } },
} as never)

dbMock.post.findMany.mockImplementation(({ where, take }) => paginate(POSTS, where, take))
dbMock.task.findMany.mockImplementation(({ where, take }) => paginate(POOLS, where, take))

/** The global order both tables should collapse into: createdAt desc, then id desc. */
const EXPECTED = ["p9", "b8", "p7", "b6", "p5", "b5", "p2", "p1", "b0"]

describe("post.getFeed — merged posts + betting pools", () => {
  it("returns one chronological page across both tables", async () => {
    const page = await caller.getFeed({ limit: 20 })
    expect(page.items.map((i) => i.id)).toEqual(EXPECTED)
    expect(page.nextCursor).toBeUndefined()
  })

  it("pages through everything exactly once", async () => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard++) {
      const page: Awaited<ReturnType<typeof caller.getFeed>> = await caller.getFeed({
        limit: 2,
        cursor,
      })
      seen.push(...page.items.map((i) => i.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toEqual(EXPECTED) // no duplicates, no skips, order preserved
  })

  it("tags pools so the feed can render them with TaskCard", async () => {
    const { items } = await caller.getFeed({ limit: 20 })
    const pool = items.find((i) => i.id === "b8")!
    expect(pool.type).toBe("BET")
    expect(pool.minBet).toBe(5)
    expect(pool.agreeCount).toBe(0)
    // A post carries the same shape with the bet fields nulled — one item type.
    expect(items.find((i) => i.id === "p9")!.minBet).toBeNull()
  })
})
