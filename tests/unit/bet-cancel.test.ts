// bet.cancelBet — admin-only cancellation of a Betting Pool, and the user-creatable
// half of task.createTask that makes cancellation matter.
//
// The properties pinned down here:
//   1. Only a DB-verified admin can cancel (a stale ADMIN JWT cannot).
//   2. Cancelling refunds EVERY stake exactly once and moves no other ZP.
//   3. Cancelled is "settled with no winningChoice" — so an already-settled pool
//      cannot be cancelled (its pot has already been paid out).
//   4. A plain user may open a BET pool but still may not open a STANDARD task.

import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  task: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  taskBet: { findMany: vi.fn(), update: vi.fn() },
  // Interactive transaction: hand the callback the same mock surface.
  $transaction: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock("@/lib/notifications", () => ({
  notifyZpChange: vi.fn(),
  notifyNewTask: vi.fn(),
}))

import { createCallerFactory } from "@/trpc/init"
import { betRouter } from "@/trpc/routers/bet"
import { taskRouter } from "@/trpc/routers/task"

const callBet = createCallerFactory(betRouter)
const callTask = createCallerFactory(taskRouter)
const TASK_ID = "task-1"

/** A session is just a claim. `role` here is what the JWT asserts, not the truth. */
const session = (id: string, role: string) => ({ session: { user: { id, role } } }) as never

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation((fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
  dbMock.taskBet.findMany.mockResolvedValue([])
  dbMock.task.create.mockResolvedValue({ id: TASK_ID, createdAt: new Date() })
})

describe("bet.cancelBet — authorization", () => {
  it("rejects an unauthenticated caller before any DB access", async () => {
    await expect(callBet({ session: null } as never).cancelBet({ taskId: TASK_ID })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a STALE ADMIN token whose DB role is USER — and writes nothing", async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: "USER" })

    await expect(
      callBet(session("demoted-admin", "ADMIN")).cancelBet({ taskId: TASK_ID })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })
})

describe("bet.cancelBet — refunds", () => {
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue({ role: "ADMIN" }) // adminProcedure's role read
  })

  it("refunds every stake exactly once and marks the pool cancelled (settled, no winner)", async () => {
    dbMock.task.findUnique.mockResolvedValue({ kind: "BET", betSettledAt: null })
    dbMock.taskBet.findMany.mockResolvedValue([
      { id: "b1", userId: "u1", amount: 10 },
      { id: "b2", userId: "u2", amount: 3 },
    ])

    await expect(
      callBet(session("admin-1", "ADMIN")).cancelBet({ taskId: TASK_ID })
    ).resolves.toEqual({ cancelled: true })

    expect(dbMock.user.update).toHaveBeenCalledTimes(2)
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { zigmaPoints: { increment: 10 } },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { zigmaPoints: { increment: 3 } },
    })
    // payout === amount is the refund marker the panel reads back.
    expect(dbMock.taskBet.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { payout: 10 } })

    // Cancelled === settled with winningChoice left null. Writing a winner here would
    // make the pool indistinguishable from a real settlement.
    const write = dbMock.task.update.mock.calls[0][0]
    expect(write.data.betSettledAt).toBeInstanceOf(Date)
    expect(write.data).not.toHaveProperty("winningChoice")
  })

  it("cannot cancel a pool that already settled — its pot has been paid out", async () => {
    dbMock.task.findUnique.mockResolvedValue({ kind: "BET", betSettledAt: new Date() })

    await expect(
      callBet(session("admin-1", "ADMIN")).cancelBet({ taskId: TASK_ID })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(dbMock.task.update).not.toHaveBeenCalled()
  })

  it("rejects a STANDARD task id — only pools are cancellable this way", async () => {
    dbMock.task.findUnique.mockResolvedValue({ kind: "STANDARD", betSettledAt: null })

    await expect(
      callBet(session("admin-1", "ADMIN")).cancelBet({ taskId: TASK_ID })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })
})

// Anyone may open a pool and bet in one — so the procedures that decide where the pot
// GOES are the whole security boundary. Each is checked against the DB role, meaning a
// still-valid token from a demoted admin buys nothing.
describe("only a DB-verified admin can lock, pay out, cancel, or edit a pool", () => {
  const staleAdmin = session("demoted-admin", "ADMIN")

  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue({ role: "USER" }) // the DB is the authority
    dbMock.task.findUnique.mockResolvedValue({ kind: "BET", betSettledAt: null, betsCloseAt: null })
  })

  it("settleBet — a stale ADMIN token cannot pay the pot out", async () => {
    await expect(
      callBet(staleAdmin).settleBet({ taskId: TASK_ID, winningChoice: "A" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.$transaction).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("lockBets — a stale ADMIN token cannot close betting", async () => {
    await expect(callBet(staleAdmin).lockBets({ taskId: TASK_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.task.update).not.toHaveBeenCalled()
  })

  it("updateTask — a stale ADMIN token cannot edit a pool", async () => {
    await expect(
      callTask(staleAdmin).updateTask({ taskId: TASK_ID, title: "t", description: "d" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.task.update).not.toHaveBeenCalled()
  })

  it("a plain user who OPENED the pool still can't settle or edit their own pool", async () => {
    const creator = session("user-1", "USER")

    await expect(
      callBet(creator).settleBet({ taskId: TASK_ID, winningChoice: "A" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(
      callTask(creator).updateTask({ taskId: TASK_ID, title: "t", description: "d" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(callBet(creator).cancelBet({ taskId: TASK_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.task.update).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })
})

describe("task.createTask — who may open what", () => {
  // The DB is the authority on role, and here it says USER — no matter what the
  // session claims. (mockResolvedValue survives clearAllMocks, so set it explicitly.)
  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue({ role: "USER" })
  })

  const bet = {
    title: "Who wins?",
    description: "Pick one",
    kind: "BET" as const,
    minBet: 1,
    choices: ["A", "B"],
  }

  it("lets a plain user open a Betting Pool, with adminId taken from the session", async () => {
    await expect(callTask(session("user-1", "USER")).createTask(bet)).resolves.toMatchObject({
      id: TASK_ID,
    })
    const data = dbMock.task.create.mock.calls[0][0].data
    expect(data.adminId).toBe("user-1") // creator, never client-supplied
    expect(data.kind).toBe("BET")
    expect(data.zpReward).toBe(0) // a pool mints nothing — the pot is user-funded
  })

  it("still refuses a plain user a STANDARD task — that one mints ZP", async () => {
    await expect(
      callTask(session("user-1", "USER")).createTask({
        title: "Do a thing",
        description: "…",
        kind: "STANDARD",
        zpReward: 5,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.task.create).not.toHaveBeenCalled()
  })
})
