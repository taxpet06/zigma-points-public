import { describe, it, expect, vi, beforeEach } from "vitest"

// The rule under test: NOBODY can move ZP into or out of someone else's balance without
// that person approving it. Both a send and a request create a PENDING row, and the
// approver is always the party who did NOT create it (initiatedById).
const dbMock = vi.hoisted(() => {
  const mock = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    transfer: {
      create: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    cosmeticPurchase: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
      // Never called by this router — asserted on directly (V-01 / MKT-04).
      create: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mock)),
  }
  return mock
})

vi.mock("@/lib/db", () => ({
  db: dbMock,
  // runSerializable just adds Serializable isolation + retry around $transaction;
  // for the router's logic it behaves identically, so delegate to the mock.
  runSerializable: (fn: (tx: unknown) => unknown) => dbMock.$transaction(fn),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("next/server", () => ({ after: (fn: () => void) => { void fn() } }))
vi.mock("@/lib/notifications", () => ({
  notifyZpChange: vi.fn(),
  notifyTransferRequest: vi.fn(),
  notifyTradeOffer: vi.fn(),
}))

import { createCallerFactory } from "@/trpc/init"
import { transferRouter } from "@/trpc/routers/transfer"
import { notifyTradeOffer } from "@/lib/notifications"
import { getCosmetic } from "@/lib/cosmetics"

const createCaller = createCallerFactory(transferRouter)
const ME = "user-me"
const OTHER = "user-other"
const ctx = { session: { user: { id: ME, name: "Me" } } } as never
const otherCtx = { session: { user: { id: OTHER, name: "Other" } } } as never

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Call = any

// Real registry entry — matching shop-router.test.ts / listing-router.test.ts's
// "real registry entries" discipline.
const AURORA = getCosmetic("aurora")!

beforeEach(() => {
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.transfer)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.cosmeticPurchase)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(notifyTradeOffer).mockClear()
})

describe("transfer.send", () => {
  it("moves NO ZP — it creates a PENDING row for the recipient to approve", async () => {
    vi.mocked(dbMock.user.findMany).mockResolvedValue([{ id: OTHER }])
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 500 })
    const caller = createCaller(ctx)

    await caller.send({ toUserIds: [OTHER], amount: 50, interestPct: 900, dueAt: futureDate() })

    expect(dbMock.user.update).not.toHaveBeenCalled() // no balance touched anywhere
    expect(dbMock.transfer.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fromUserId: ME,
          toUserId: OTHER,
          amount: 50,
          status: "PENDING",
          initiatedById: ME, // => the RECIPIENT approves
          interestPct: 900,
        }),
      ],
    })
  })

  it("still fast-fails when the sender plainly can't cover it", async () => {
    vi.mocked(dbMock.user.findMany).mockResolvedValue([{ id: OTHER }])
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 10 })
    const caller = createCaller(ctx)

    await expect(caller.send({ toUserIds: [OTHER], amount: 50 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
    expect(dbMock.transfer.createMany).not.toHaveBeenCalled()
  })
})

describe("transfer.request", () => {
  it("records the payee as initiator so the PAYER approves", async () => {
    vi.mocked(dbMock.user.findMany).mockResolvedValue([{ id: OTHER }])
    const caller = createCaller(ctx)

    await caller.request({ fromUserIds: [OTHER], amount: 30 })

    expect(dbMock.transfer.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          fromUserId: OTHER,
          toUserId: ME,
          status: "PENDING",
          initiatedById: ME,
        }),
      ],
    })
  })
})

describe("transfer.respond — who is allowed to answer", () => {
  // A send I created: I'm the payer, OTHER is the recipient who must approve.
  const sendByMe = {
    id: "t-1",
    fromUserId: ME,
    toUserId: OTHER,
    amount: 50,
    status: "PENDING" as const,
    dueAt: null,
    initiatedById: ME,
  }
  // A request I created: OTHER is the payer who must approve.
  const requestByMe = { ...sendByMe, fromUserId: OTHER, toUserId: ME, initiatedById: ME }

  it("blocks the SENDER from approving their own send (the forced-loan hole)", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(sendByMe)
    const caller = createCaller(ctx)

    await expect(
      caller.respond({ transferId: "t-1", action: "APPROVE" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("blocks the REQUESTER from approving their own request", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(requestByMe)
    const caller = createCaller(ctx)

    await expect(
      caller.respond({ transferId: "t-1", action: "APPROVE" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("lets the RECIPIENT approve a send: ZP moves sender -> recipient", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(sendByMe)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 500 })
    const caller = createCaller(otherCtx) // the recipient answers

    await caller.respond({ transferId: "t-1", action: "APPROVE" })

    // The payer is fromUser (the sender) even though the RECIPIENT clicked approve.
    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: ME },
      select: { zigmaPoints: true },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { zigmaPoints: { decrement: 50 } },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: OTHER },
      data: { zigmaPoints: { increment: 50 } },
    })
    expect(dbMock.transfer.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ status: "APPROVED" }),
    })
  })

  it("lets the PAYER approve a request (unchanged behaviour)", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(requestByMe)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 500 })
    const caller = createCaller(otherCtx) // OTHER is the payer here

    await caller.respond({ transferId: "t-1", action: "APPROVE" })

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: OTHER },
      data: { zigmaPoints: { decrement: 50 } },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { zigmaPoints: { increment: 50 } },
    })
  })

  it("refuses a send whose sender spent the ZP while it sat pending", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(sendByMe)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 3 }) // sender is broke
    const caller = createCaller(otherCtx)

    await expect(
      caller.respond({ transferId: "t-1", action: "APPROVE" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("lets the recipient REJECT a send outright — no ZP moves", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(sendByMe)
    const caller = createCaller(otherCtx)

    await caller.respond({ transferId: "t-1", action: "REJECT" })

    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(dbMock.transfer.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ status: "REJECTED" }),
    })
  })

  it("treats a legacy row (no initiator recorded) as a request the payer answers", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      ...requestByMe,
      initiatedById: null,
    })
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 500 })
    const caller = createCaller(otherCtx) // OTHER is fromUser = payer

    await caller.respond({ transferId: "t-1", action: "APPROVE" })

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: OTHER },
      data: { zigmaPoints: { decrement: 50 } },
    })
  })
})

describe("transfer.listPending", () => {
  const person = (id: string) => ({
    id,
    name: id,
    username: id,
    image: null,
    equippedRing: null,
  })

  it("V-14: returns both directions, each with the counterparty, which side pays, and waitingOnMe", async () => {
    vi.mocked(dbMock.transfer.findMany).mockResolvedValue([
      // someone requesting MY ZP — I'm the payer, and I didn't start this one
      {
        id: "t-req",
        amount: 10,
        note: null,
        createdAt: new Date(0),
        interestPct: null,
        dueAt: null,
        fromUserId: ME,
        initiatedById: OTHER,
        cosmeticPurchaseId: null,
        copy: null,
        fromUser: person(ME),
        toUser: person(OTHER),
      },
      // a send I started myself, still awaiting the OTHER party's answer
      {
        id: "t-send",
        amount: 20,
        note: null,
        createdAt: new Date(0),
        interestPct: null,
        dueAt: null,
        fromUserId: OTHER,
        initiatedById: ME,
        cosmeticPurchaseId: null,
        copy: null,
        fromUser: person(OTHER),
        toUser: person(ME),
      },
    ])
    const caller = createCaller(ctx)

    const rows = await caller.listPending()

    // The widened where drops the old NOT: { initiatedById: me } clause — both
    // directions come back now, tagged instead of filtered.
    expect(dbMock.transfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PENDING", OR: [{ fromUserId: ME }, { toUserId: ME }] },
      }),
    )
    expect(rows[0]).toMatchObject({ id: "t-req", iAmPayer: true, waitingOnMe: true })
    expect(rows[0].counterparty.id).toBe(OTHER)
    expect(rows[1]).toMatchObject({ id: "t-send", iAmPayer: false, waitingOnMe: false })
    expect(rows[1].counterparty.id).toBe(OTHER)
  })

  it("V-14 trade row: a row with a cosmeticPurchaseId returns an item block with circulation; a non-trade row returns item null", async () => {
    vi.mocked(dbMock.transfer.findMany).mockResolvedValue([
      {
        id: "t-trade",
        amount: 100,
        note: null,
        createdAt: new Date(0),
        interestPct: null,
        dueAt: null,
        fromUserId: OTHER,
        initiatedById: ME,
        cosmeticPurchaseId: "copy-1",
        copy: { slug: AURORA.slug, mintNumber: 3, kind: AURORA.kind },
        fromUser: person(OTHER),
        toUser: person(ME),
      },
      {
        id: "t-plain",
        amount: 5,
        note: null,
        createdAt: new Date(0),
        interestPct: null,
        dueAt: null,
        fromUserId: ME,
        initiatedById: OTHER,
        cosmeticPurchaseId: null,
        copy: null,
        fromUser: person(ME),
        toUser: person(OTHER),
      },
    ])
    vi.mocked(dbMock.cosmeticPurchase.groupBy).mockResolvedValue([
      { slug: AURORA.slug, _count: { _all: 7 } },
    ])
    const caller = createCaller(ctx)

    const rows = await caller.listPending()

    expect(dbMock.cosmeticPurchase.groupBy).toHaveBeenCalledWith({
      by: ["slug"],
      where: { slug: { in: [AURORA.slug] } },
      _count: { _all: true },
    })
    expect(rows[0].item).toMatchObject({
      slug: AURORA.slug,
      mintNumber: 3,
      name: AURORA.name,
      circulation: 7,
    })
    expect(rows[1].item).toBeNull()
  })

  it("skips the groupBy entirely when no trade rows are present", async () => {
    vi.mocked(dbMock.transfer.findMany).mockResolvedValue([
      {
        id: "t-plain",
        amount: 5,
        note: null,
        createdAt: new Date(0),
        interestPct: null,
        dueAt: null,
        fromUserId: ME,
        initiatedById: OTHER,
        cosmeticPurchaseId: null,
        copy: null,
        fromUser: person(ME),
        toUser: person(OTHER),
      },
    ])
    const caller = createCaller(ctx)

    await caller.listPending()

    expect(dbMock.cosmeticPurchase.groupBy).not.toHaveBeenCalled()
  })
})

describe("transfer.tradeOffer", () => {
  function mockOwnedFreeCopy() {
    vi.mocked(dbMock.user.findUnique).mockImplementation(({ where }: Call) => {
      if (where.id === OTHER) return Promise.resolve({ id: OTHER })
      return Promise.resolve({ equippedBackground: null, equippedRing: null })
    })
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
  }

  it("TRDE-01: creates the Transfer with the trade direction mapping, then claims escrow", async () => {
    mockOwnedFreeCopy()
    vi.mocked(dbMock.transfer.create).mockResolvedValue({ id: "t-new" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 1 })
    const caller = createCaller(ctx)

    await caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 })

    expect(dbMock.transfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromUserId: OTHER,
        toUserId: ME,
        initiatedById: ME,
        amount: 100,
        cosmeticPurchaseId: "copy-1",
        status: "PENDING",
      }),
    })
    expect(dbMock.cosmeticPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: "copy-1", userId: ME, escrowed: false },
      data: { escrowed: true },
    })
  })

  it("XCHG-04: notifies the recipient once with their id and the price", async () => {
    mockOwnedFreeCopy()
    vi.mocked(dbMock.transfer.create).mockResolvedValue({ id: "t-new" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 1 })
    const caller = createCaller(ctx)

    await caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 })

    expect(notifyTradeOffer).toHaveBeenCalledWith(OTHER, "Me", AURORA.name, 100)
  })

  it("V-09: refuses an offer to yourself and never calls transfer.create", async () => {
    const caller = createCaller(ctx)

    await expect(
      caller.tradeOffer({ recipientId: ME, cosmeticPurchaseId: "copy-1", price: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.transfer.create).not.toHaveBeenCalled()
  })

  it("V-11: a copy owned by someone else throws FORBIDDEN and never calls transfer.create", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ id: OTHER })
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: "someone-else",
      slug: AURORA.slug,
      escrowed: false,
    })
    const caller = createCaller(ctx)

    await expect(
      caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.transfer.create).not.toHaveBeenCalled()
  })

  it("V-10: blocks when the caller's equippedRing equals the copy's slug", async () => {
    vi.mocked(dbMock.user.findUnique).mockImplementation(({ where }: Call) => {
      if (where.id === OTHER) return Promise.resolve({ id: OTHER })
      return Promise.resolve({ equippedBackground: null, equippedRing: AURORA.slug })
    })
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    const caller = createCaller(ctx)

    await expect(
      caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.transfer.create).not.toHaveBeenCalled()
  })

  it("T-22-11: blocks when the caller's equippedTitle equals the copy's slug", async () => {
    vi.mocked(dbMock.user.findUnique).mockImplementation(({ where }: Call) => {
      if (where.id === OTHER) return Promise.resolve({ id: OTHER })
      return Promise.resolve({ equippedBackground: null, equippedRing: null, equippedTitle: AURORA.slug })
    })
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    const caller = createCaller(ctx)

    await expect(
      caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.transfer.create).not.toHaveBeenCalled()
  })

  it("escrow race: the claim resolving count 0 throws BAD_REQUEST", async () => {
    mockOwnedFreeCopy()
    vi.mocked(dbMock.transfer.create).mockResolvedValue({ id: "t-new" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 0 })
    const caller = createCaller(ctx)

    await expect(
      caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("transfer.respond — trade branches", () => {
  const tradeOfferRow = {
    id: "t-trade",
    fromUserId: OTHER, // the recipient — pays ZP, receives the copy
    toUserId: ME, // the offerer — owns the copy, wants ZP
    amount: 100,
    status: "PENDING" as const,
    dueAt: null,
    initiatedById: ME, // the offerer created it, so only OTHER may respond
    cosmeticPurchaseId: "copy-1",
  }

  it("V-07: APPROVE with insufficient ZP throws, moves no copy, and leaves the offer PENDING", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(tradeOfferRow)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 3 }) // OTHER is broke
    const caller = createCaller(otherCtx)

    await expect(
      caller.respond({ transferId: "t-trade", action: "APPROVE" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.cosmeticPurchase.update).not.toHaveBeenCalled()
    expect(dbMock.transfer.update).not.toHaveBeenCalled()
  })

  it("TRDE-02: APPROVE moves the copy to the acceptor and both balances move by the offer amount", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(tradeOfferRow)
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 500 })
    const caller = createCaller(otherCtx)

    await caller.respond({ transferId: "t-trade", action: "APPROVE" })

    expect(dbMock.cosmeticPurchase.update).toHaveBeenCalledWith({
      where: { id: "copy-1" },
      data: { userId: OTHER, escrowed: false },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: OTHER },
      data: { zigmaPoints: { decrement: 100 } },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { zigmaPoints: { increment: 100 } },
    })
  })

  it("V-03: REJECT clears escrow on the copy and touches no balance", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue(tradeOfferRow)
    const caller = createCaller(otherCtx)

    await caller.respond({ transferId: "t-trade", action: "REJECT" })

    expect(dbMock.cosmeticPurchase.update).toHaveBeenCalledWith({
      where: { id: "copy-1" },
      data: { escrowed: false },
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })
})

describe("transfer.cancel", () => {
  it("V-13: succeeds for the initiator on a PENDING row", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-1",
      initiatedById: ME,
      status: "PENDING",
      cosmeticPurchaseId: null,
    })
    const caller = createCaller(ctx)

    await caller.cancel({ transferId: "t-1" })

    expect(dbMock.transfer.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ status: "REJECTED" }),
    })
  })

  it("V-13 / V-11: throws FORBIDDEN when the row was initiated by the other party", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-1",
      initiatedById: OTHER,
      status: "PENDING",
      cosmeticPurchaseId: null,
    })
    const caller = createCaller(ctx)

    await expect(caller.cancel({ transferId: "t-1" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.transfer.update).not.toHaveBeenCalled()
  })

  it("V-13: throws BAD_REQUEST on an already-APPROVED row", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-1",
      initiatedById: ME,
      status: "APPROVED",
      cosmeticPurchaseId: null,
    })
    const caller = createCaller(ctx)

    await expect(caller.cancel({ transferId: "t-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.transfer.update).not.toHaveBeenCalled()
  })

  it("V-03: cancelling a trade row clears escrow on the copy", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-1",
      initiatedById: ME,
      status: "PENDING",
      cosmeticPurchaseId: "copy-1",
    })
    const caller = createCaller(ctx)

    await caller.cancel({ transferId: "t-1" })

    expect(dbMock.cosmeticPurchase.update).toHaveBeenCalledWith({
      where: { id: "copy-1" },
      data: { escrowed: false },
    })
  })

  it("cancelling a non-trade row never touches cosmeticPurchase", async () => {
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-1",
      initiatedById: ME,
      status: "PENDING",
      cosmeticPurchaseId: null,
    })
    const caller = createCaller(ctx)

    await caller.cancel({ transferId: "t-1" })

    expect(dbMock.cosmeticPurchase.update).not.toHaveBeenCalled()
  })
})

describe("circulation invariant (V-01 / MKT-04)", () => {
  it("tradeOffer, respond, and cancel never create or delete a CosmeticPurchase row", async () => {
    // tradeOffer
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ equippedBackground: null, equippedRing: null })
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    vi.mocked(dbMock.transfer.create).mockResolvedValue({ id: "t-new" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 1 })
    const caller = createCaller(ctx)
    await caller.tradeOffer({ recipientId: OTHER, cosmeticPurchaseId: "copy-1", price: 100 })

    // respond APPROVE on a trade row
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-trade",
      fromUserId: OTHER,
      toUserId: ME,
      amount: 100,
      status: "PENDING" as const,
      dueAt: null,
      initiatedById: ME,
      cosmeticPurchaseId: "copy-1",
    })
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ zigmaPoints: 500 })
    await createCaller(otherCtx).respond({ transferId: "t-trade", action: "APPROVE" })

    // cancel a trade row
    vi.mocked(dbMock.transfer.findUnique).mockResolvedValue({
      id: "t-2",
      initiatedById: ME,
      status: "PENDING",
      cosmeticPurchaseId: "copy-2",
    })
    await caller.cancel({ transferId: "t-2" })

    expect(dbMock.cosmeticPurchase.create).not.toHaveBeenCalled()
    expect(dbMock.cosmeticPurchase.delete).not.toHaveBeenCalled()
  })
})

function futureDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
}
