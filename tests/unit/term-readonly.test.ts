// Past-term content is READ-ONLY — the interaction half of the terms feature.
//
// Voting needed no new rule: every post's window is 24h (post.createPost), so an
// old-term post is always past `votingEndsAt` and castVote's existing guard already
// refuses it. Replies and bets had no such natural expiry, so they get an explicit
// isCurrentTerm gate — that is what these tests pin down.
//
// The properties here:
//   1. A reply to a post or task from a past term is refused; the current term's is not.
//   2. A stake on a pool from a past term is refused BEFORE any ZP moves — including
//      the forgotten-pool case (betsCloseAt null, never settled) that motivated it.
//   3. Nothing is stamped before the first term starts, and nothing is locked then
//      either — null termId with no current term stays writable.

import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMock = vi.hoisted(() => ({
  // currentTermId() reads this; it is the whole of the read-only rule.
  term: { findFirst: vi.fn(), count: vi.fn(async () => 0) },
  post: { findUnique: vi.fn() },
  task: { findUnique: vi.fn() },
  reply: { findUnique: vi.fn(), create: vi.fn() },
  taskBet: { findUnique: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock("@/lib/notifications", () => ({
  notifyZpChange: vi.fn(),
  notifyNewReply: vi.fn(),
  notifyRepliedToYou: vi.fn(),
}))

import { createCallerFactory } from "@/trpc/init"
import { replyRouter } from "@/trpc/routers/reply"
import { betRouter } from "@/trpc/routers/bet"

const callReply = createCallerFactory(replyRouter)
const callBet = createCallerFactory(betRouter)
const ctx = { session: { user: { id: "user-1" } } } as never

const CURRENT = { id: "term-now", name: "26X", startsAt: new Date(), endsAt: new Date() }
const PAST_ID = "term-old"

beforeEach(() => {
  for (const group of [dbMock.term, dbMock.post, dbMock.task, dbMock.reply, dbMock.taskBet, dbMock.user]) {
    for (const fn of Object.values(group)) vi.mocked(fn).mockReset()
  }
  vi.mocked(dbMock.$transaction).mockReset()
  vi.mocked(dbMock.term.findFirst).mockResolvedValue(CURRENT)
  vi.mocked(dbMock.reply.create).mockResolvedValue({ id: "reply-1", createdAt: new Date() })
})

describe("replies — a past term's thread is closed", () => {
  it("refuses a reply to a post from a past term", async () => {
    vi.mocked(dbMock.post.findUnique).mockResolvedValue({ id: "post-1", termId: PAST_ID })
    await expect(
      callReply(ctx).createReply({ postId: "post-1", content: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.reply.create).not.toHaveBeenCalled()
  })

  it("allows a reply to a post from the current term", async () => {
    vi.mocked(dbMock.post.findUnique).mockResolvedValue({ id: "post-1", termId: CURRENT.id })
    await callReply(ctx).createReply({ postId: "post-1", content: "hi" })
    expect(dbMock.reply.create).toHaveBeenCalled()
  })

  it("refuses a reply to a task from a past term", async () => {
    vi.mocked(dbMock.task.findUnique).mockResolvedValue({ id: "task-1", termId: PAST_ID })
    await expect(
      callReply(ctx).createReply({ taskId: "task-1", content: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.reply.create).not.toHaveBeenCalled()
  })

  it("an unstamped post locks once a term is running", async () => {
    // Nothing should be in this state after the backfill, but if one is, the safe
    // reading of "older than the term system" is closed, not open.
    vi.mocked(dbMock.post.findUnique).mockResolvedValue({ id: "post-1", termId: null })
    await expect(
      callReply(ctx).createReply({ postId: "post-1", content: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("locks nothing before the first term starts", async () => {
    vi.mocked(dbMock.term.findFirst).mockResolvedValue(null)
    vi.mocked(dbMock.post.findUnique).mockResolvedValue({ id: "post-1", termId: null })
    await callReply(ctx).createReply({ postId: "post-1", content: "hi" })
    expect(dbMock.reply.create).toHaveBeenCalled()
  })
})

describe("the term board's empty-state and loading edges", () => {
  it("isCurrentTerm treats 'past its endsAt, no successor' as CURRENT", async () => {
    // The rule the backfill must agree with: currentTermId is the most recent term
    // that has STARTED, with no endsAt bound. The first backfill used a window match
    // instead and left gap rows null, which silently froze them (migration
    // 20260825175500 corrects it). Pinning the rule here so they can't drift again.
    const { isCurrentTerm } = await import("@/lib/terms")
    vi.mocked(dbMock.term.findFirst).mockResolvedValue({
      ...CURRENT,
      endsAt: new Date(Date.now() - 86_400_000), // ended yesterday, nothing replaced it
    })
    expect(await isCurrentTerm(CURRENT.id)).toBe(true)
  })
})

describe("bets — a past term's pool takes no new stakes", () => {
  const pool = (patch: Record<string, unknown> = {}) => ({
    id: "task-1",
    kind: "BET",
    choices: ["a", "b"],
    minBet: 1,
    betsCloseAt: null,
    betSettledAt: null,
    termId: CURRENT.id,
    ...patch,
  })

  it("refuses a stake on a pool from a past term before any ZP moves", async () => {
    // The exact shape that motivated the guard: never settled, no cutoff, so every
    // other existing check passes and it would have accepted stakes forever.
    vi.mocked(dbMock.task.findUnique).mockResolvedValue(pool({ termId: PAST_ID }))
    await expect(
      callBet(ctx).placeBet({ taskId: "task-1", choice: "a", amount: 5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("still takes a stake on the current term's pool", async () => {
    vi.mocked(dbMock.task.findUnique).mockResolvedValue(pool())
    vi.mocked(dbMock.$transaction).mockResolvedValue(undefined)
    await callBet(ctx).placeBet({ taskId: "task-1", choice: "a", amount: 5 })
    expect(dbMock.$transaction).toHaveBeenCalled()
  })
})
