// Zigma Maxxer: the crown is a single app-wide slot, so the thing worth testing is
// that both writers (setWinner, setCrown) clear every other holder in the SAME
// transaction as they set the new one. Nothing in the schema can enforce "at most one
// row is true", so this test IS the constraint.

import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMock = vi.hoisted(() => {
  const mock = {
    term: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  }
  return mock
})

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { termRouter } from "@/trpc/routers/term"

const createCaller = createCallerFactory(termRouter)
const ADMIN = "user-admin"
const adminCtx = { session: { user: { id: ADMIN, name: "Admin" } } } as never

// adminProcedure re-reads the role from the DB, so every admin call hits user.findUnique
// for { role } first. Return ADMIN for that lookup and the row for existence checks.
function asAdmin() {
  dbMock.user.findUnique.mockImplementation(({ select }: { select?: Record<string, boolean> }) =>
    select?.role ? { role: "ADMIN" } : { id: "user-winner" },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asAdmin()
  dbMock.term.findUnique.mockResolvedValue({ id: "term-1" })
})

describe("term.setWinner", () => {
  it("writes the winner AND the crown handoff in one transaction", async () => {
    const caller = createCaller(adminCtx)
    await caller.setWinner({ termId: "term-1", userId: "user-winner" })

    expect(dbMock.term.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "term-1" }, data: { winnerId: "user-winner" } }),
    )
    // Clear-all excludes the new holder, so the crown is never momentarily nobody's.
    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { hasCrown: true, NOT: { id: "user-winner" } },
      data: { hasCrown: false },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-winner" },
      data: { hasCrown: true },
    })
    // All three are one atomic batch — a half-applied handoff would leave two crowns.
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1)
    expect(dbMock.$transaction.mock.calls[0][0]).toHaveLength(3)
  })

  it("clearing a term's winner leaves the crown where it is", async () => {
    const caller = createCaller(adminCtx)
    await caller.setWinner({ termId: "term-1", userId: null })

    expect(dbMock.term.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { winnerId: null } }),
    )
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("rejects an unknown term before writing anything", async () => {
    dbMock.term.findUnique.mockResolvedValue(null)
    const caller = createCaller(adminCtx)
    await expect(caller.setWinner({ termId: "nope", userId: "user-winner" })).rejects.toThrow(
      /not found/i,
    )
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("rejects an unknown user before writing anything", async () => {
    dbMock.user.findUnique.mockImplementation(({ select }: { select?: Record<string, boolean> }) =>
      select?.role ? { role: "ADMIN" } : null,
    )
    const caller = createCaller(adminCtx)
    await expect(caller.setWinner({ termId: "term-1", userId: "ghost" })).rejects.toThrow(
      /not found/i,
    )
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("is admin-only", async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: "USER" })
    const caller = createCaller(adminCtx)
    await expect(caller.setWinner({ termId: "term-1", userId: "user-winner" })).rejects.toThrow(
      /admin only/i,
    )
  })
})

describe("term.setCrown", () => {
  it("moves the crown by clearing every other holder first", async () => {
    const caller = createCaller(adminCtx)
    await caller.setCrown({ userId: "user-winner" })

    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { hasCrown: true, NOT: { id: "user-winner" } },
      data: { hasCrown: false },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-winner" },
      data: { hasCrown: true },
    })
    expect(dbMock.$transaction.mock.calls[0][0]).toHaveLength(2)
  })

  it("null takes the crown off everyone", async () => {
    const caller = createCaller(adminCtx)
    await caller.setCrown({ userId: null })

    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { hasCrown: true },
      data: { hasCrown: false },
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("is admin-only", async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: "USER" })
    const caller = createCaller(adminCtx)
    await expect(caller.setCrown({ userId: "user-winner" })).rejects.toThrow(/admin only/i)
  })
})
