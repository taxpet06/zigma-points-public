// post.cancelPost — admin-only cancellation.
//
// The security properties this file pins down:
//   1. A non-admin session cannot cancel, and nothing is written.
//   2. A session whose JWT *claims* ADMIN but whose DB row says USER cannot cancel.
//      This is the stale-token elevation path adminProcedure exists to close.
//   3. The write is a compare-and-set on `settled: false` — a post whose ZP has
//      already moved can never be rewritten to "Cancelled".
//   4. Cancelling is idempotent, and never touches a user balance.

import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  post: { updateMany: vi.fn(), findUnique: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/notifications", () => ({
  notifyTaggedInPost: vi.fn(),
  notifyNewPost: vi.fn(),
}))

import { createCallerFactory } from "@/trpc/init"
import { postRouter } from "@/trpc/routers/post"

const createCaller = createCallerFactory(postRouter)
const POST_ID = "post-1"

/** A session is just a claim. `role` here is what the JWT asserts, not the truth. */
const session = (id: string, role: string) => ({ session: { user: { id, role } } }) as never

beforeEach(() => {
  vi.mocked(dbMock.user.findUnique).mockReset()
  vi.mocked(dbMock.user.update).mockReset()
  vi.mocked(dbMock.post.updateMany).mockReset()
  vi.mocked(dbMock.post.findUnique).mockReset()
})

describe("post.cancelPost — authorization", () => {
  it("rejects an unauthenticated caller with UNAUTHORIZED before any DB access", async () => {
    const caller = createCaller({ session: null } as never)

    await expect(caller.cancelPost({ postId: POST_ID })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    expect(dbMock.user.findUnique).not.toHaveBeenCalled()
    expect(dbMock.post.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a plain user with FORBIDDEN and writes nothing", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ role: "USER" })
    const caller = createCaller(session("user-1", "USER"))

    await expect(caller.cancelPost({ postId: POST_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.post.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a STALE ADMIN token whose DB role is USER — role is read from the DB, not the JWT", async () => {
    // The session claims ADMIN (as a pre-demotion JWT would). The DB is the authority.
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ role: "USER" })
    const caller = createCaller(session("demoted-admin", "ADMIN"))

    await expect(caller.cancelPost({ postId: POST_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.post.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a session whose user row no longer exists", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue(null)
    const caller = createCaller(session("deleted-user", "ADMIN"))

    await expect(caller.cancelPost({ postId: POST_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.post.updateMany).not.toHaveBeenCalled()
  })
})

describe("post.cancelPost — cancellation", () => {
  beforeEach(() => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ role: "ADMIN" })
  })

  it("cancels an open post via a compare-and-set, moving no ZP", async () => {
    vi.mocked(dbMock.post.updateMany).mockResolvedValue({ count: 1 })
    const caller = createCaller(session("admin-1", "ADMIN"))

    await expect(caller.cancelPost({ postId: POST_ID })).resolves.toEqual({ cancelled: true })
    expect(dbMock.post.updateMany).toHaveBeenCalledWith({
      where: { id: POST_ID, settled: false, votingEndsAt: { gt: expect.any(Date) } },
      data: { settled: true, outcome: "Cancelled" },
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  // BOTH halves of the predicate are required. Settlement runs on an external cron, so
  // a post whose window closed hours ago still reads settled:false until that cron
  // runs — `settled: false` alone would leave every such post cancellable.
  it("requires the voting window to still be open, not merely settled:false", async () => {
    vi.mocked(dbMock.post.updateMany).mockResolvedValue({ count: 1 })
    const caller = createCaller(session("admin-1", "ADMIN"))

    await caller.cancelPost({ postId: POST_ID })

    const where = vi.mocked(dbMock.post.updateMany).mock.calls[0][0].where
    expect(where.votingEndsAt).toEqual({ gt: expect.any(Date) })
    expect(where.settled).toBe(false)
  })

  // A decided post and an unknown id are indistinguishable here by design: the CAS
  // matches no row either way, and neither is cancellable.
  it("cannot cancel a post that is settled or past its window — no balance moves", async () => {
    vi.mocked(dbMock.post.updateMany).mockResolvedValue({ count: 0 })
    const caller = createCaller(session("admin-1", "ADMIN"))

    await expect(caller.cancelPost({ postId: POST_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    // No follow-up read — the CAS result is the whole answer.
    expect(dbMock.post.findUnique).not.toHaveBeenCalled()
  })

  it("rejects an empty postId at the schema boundary, before touching the DB", async () => {
    const caller = createCaller(session("admin-1", "ADMIN"))

    await expect(caller.cancelPost({ postId: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
    expect(dbMock.post.updateMany).not.toHaveBeenCalled()
  })
})
