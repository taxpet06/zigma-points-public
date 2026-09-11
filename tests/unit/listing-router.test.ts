import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks — mirrors shop-router.test.ts's dbMock/runSerializable-mock convention.
const dbMock = vi.hoisted(() => {
  const mock = {
    listing: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
vi.mock("@/lib/notifications", () => ({ notifyListingSold: vi.fn() }))
// `after` from next/server must be a pass-through: run the callback so notifyListingSold
// fires in the same tick, which is what the assertions rely on.
vi.mock("next/server", () => ({ after: (fn: () => void) => { void fn() } }))

import { createCallerFactory } from "@/trpc/init"
import { listingRouter } from "@/trpc/routers/listing"
import { getCosmetic } from "@/lib/cosmetics"
import { notifyListingSold } from "@/lib/notifications"

const createCaller = createCallerFactory(listingRouter)

const ME = "user-me"
const BUYER = "user-buyer"
const SELLER = "user-seller"

const meCtx = { session: { user: { id: ME, name: "Me" } } } as never
const buyerCtx = { session: { user: { id: BUYER, name: "Buyer Name" } } } as never
const sellerCtx = { session: { user: { id: SELLER, name: "Seller Name" } } } as never

// Real registry entries — matching shop-router.test.ts's "real registry entries" discipline.
const AURORA = getCosmetic("aurora")!

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Call = any

beforeEach(() => {
  for (const fn of Object.values(dbMock.listing)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.cosmeticPurchase)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
  vi.mocked(notifyListingSold).mockClear()
})

describe("listing.create", () => {
  function mockOwnedFreeCopy() {
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      equippedBackground: null,
      equippedRing: null,
    })
  }

  it("V-02: calls listing.create then the escrow-claim updateMany, in that order, with the right where/data", async () => {
    mockOwnedFreeCopy()
    vi.mocked(dbMock.listing.create).mockResolvedValue({ id: "listing-1" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 1 })

    const caller = createCaller(meCtx)
    await caller.create({ cosmeticPurchaseId: "copy-1", price: 100 })

    expect(dbMock.listing.create).toHaveBeenCalledWith({
      data: { sellerId: ME, cosmeticPurchaseId: "copy-1", price: 100 },
    })
    expect(dbMock.cosmeticPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: "copy-1", userId: ME, escrowed: false },
      data: { escrowed: true },
    })
    const createOrder = vi.mocked(dbMock.listing.create).mock.invocationCallOrder[0]
    const claimOrder = vi.mocked(dbMock.cosmeticPurchase.updateMany).mock.invocationCallOrder[0]
    expect(createOrder).toBeLessThan(claimOrder)
  })

  it("V-05 create race: throws BAD_REQUEST when the escrow-claim updateMany loses the race (count 0)", async () => {
    mockOwnedFreeCopy()
    vi.mocked(dbMock.listing.create).mockResolvedValue({ id: "listing-1" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 0 })

    const caller = createCaller(meCtx)
    await expect(caller.create({ cosmeticPurchaseId: "copy-1", price: 100 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
  })

  it("V-11 create IDOR: a copy whose userId is not the caller throws FORBIDDEN and never claims escrow", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: "someone-else",
      slug: AURORA.slug,
      escrowed: false,
    })

    const caller = createCaller(meCtx)
    await expect(caller.create({ cosmeticPurchaseId: "copy-1", price: 100 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.cosmeticPurchase.updateMany).not.toHaveBeenCalled()
    expect(dbMock.listing.create).not.toHaveBeenCalled()
  })

  it("V-10 create equipped: blocks when the caller's equippedBackground equals the copy's slug", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      equippedBackground: AURORA.slug,
      equippedRing: null,
    })

    const caller = createCaller(meCtx)
    await expect(caller.create({ cosmeticPurchaseId: "copy-1", price: 100 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
    expect(dbMock.listing.create).not.toHaveBeenCalled()
  })

  it("T-22-10: blocks when the caller's equippedTitle equals the copy's slug", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      equippedBackground: null,
      equippedRing: null,
      equippedTitle: AURORA.slug,
    })

    const caller = createCaller(meCtx)
    await expect(caller.create({ cosmeticPurchaseId: "copy-1", price: 100 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
    expect(dbMock.listing.create).not.toHaveBeenCalled()
  })

  it("rejects an already-escrowed copy with BAD_REQUEST before any write", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: true,
    })

    const caller = createCaller(meCtx)
    await expect(caller.create({ cosmeticPurchaseId: "copy-1", price: 100 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
    expect(dbMock.listing.create).not.toHaveBeenCalled()
    expect(dbMock.cosmeticPurchase.updateMany).not.toHaveBeenCalled()
  })
})

describe("listing.buy", () => {
  function mockActiveListing(overrides: Partial<Call> = {}) {
    vi.mocked(dbMock.listing.findUnique).mockResolvedValue({
      id: "listing-1",
      sellerId: SELLER,
      price: 100,
      status: "ACTIVE",
      cosmeticPurchaseId: "copy-1",
      copy: { slug: AURORA.slug },
      ...overrides,
    })
  }

  it("V-06 buy insufficient ZP: throws BAD_REQUEST, never touches the listing or the copy", async () => {
    mockActiveListing()
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 0 })

    const caller = createCaller(buyerCtx)
    await expect(caller.buy({ listingId: "listing-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.listing.updateMany).not.toHaveBeenCalled()
    expect(dbMock.cosmeticPurchase.update).not.toHaveBeenCalled()
  })

  it("V-04 buy race: debit succeeds but the SOLD compare-and-set loses (count 0) — nothing changes hands", async () => {
    mockActiveListing()
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.listing.updateMany).mockResolvedValue({ count: 0 })

    const caller = createCaller(buyerCtx)
    await expect(caller.buy({ listingId: "listing-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.cosmeticPurchase.update).not.toHaveBeenCalled()
  })

  it("V-08 buy no fee: the seller's increment equals exactly the buyer's decrement", async () => {
    mockActiveListing()
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.listing.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.user.update).mockResolvedValue({})
    vi.mocked(dbMock.cosmeticPurchase.update).mockResolvedValue({})

    const caller = createCaller(buyerCtx)
    await caller.buy({ listingId: "listing-1" })

    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: BUYER, zigmaPoints: { gte: 100 } },
      data: { zigmaPoints: { decrement: 100 } },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: SELLER },
      data: { zigmaPoints: { increment: 100 } },
    })
  })

  it("V-08 buy ownership move: cosmeticPurchase.update moves the copy to the buyer and clears escrow", async () => {
    mockActiveListing()
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.listing.updateMany).mockResolvedValue({ count: 1 })

    const caller = createCaller(buyerCtx)
    await caller.buy({ listingId: "listing-1" })

    expect(dbMock.cosmeticPurchase.update).toHaveBeenCalledWith({
      where: { id: "copy-1" },
      data: { userId: BUYER, escrowed: false },
    })
  })

  it("V-09 buy self: refuses when sellerId is the caller, never calls the debit", async () => {
    mockActiveListing({ sellerId: ME })

    const caller = createCaller(meCtx)
    await expect(caller.buy({ listingId: "listing-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
  })

  it("XCHG-04: a successful buy calls notifyListingSold once with the seller id and the price", async () => {
    mockActiveListing()
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.listing.updateMany).mockResolvedValue({ count: 1 })

    const caller = createCaller(buyerCtx)
    await caller.buy({ listingId: "listing-1" })

    expect(notifyListingSold).toHaveBeenCalledTimes(1)
    expect(notifyListingSold).toHaveBeenCalledWith(SELLER, "Buyer Name", AURORA.name, 100)
  })

  it("throws NOT_FOUND for a missing listing", async () => {
    vi.mocked(dbMock.listing.findUnique).mockResolvedValue(null)
    const caller = createCaller(buyerCtx)
    await expect(caller.buy({ listingId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("throws BAD_REQUEST for a non-ACTIVE listing", async () => {
    mockActiveListing({ status: "SOLD" })
    const caller = createCaller(buyerCtx)
    await expect(caller.buy({ listingId: "listing-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("listing.takeDown", () => {
  function mockOwnedActiveListing() {
    vi.mocked(dbMock.listing.findUnique).mockResolvedValue({
      sellerId: SELLER,
      status: "ACTIVE",
      cosmeticPurchaseId: "copy-1",
    })
  }

  it("V-11 takeDown IDOR: a listing whose sellerId is not the caller throws FORBIDDEN, never touches the copy", async () => {
    mockOwnedActiveListing()
    const caller = createCaller(buyerCtx)
    await expect(caller.takeDown({ listingId: "listing-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.cosmeticPurchase.update).not.toHaveBeenCalled()
  })

  it("throws BAD_REQUEST for a non-ACTIVE listing", async () => {
    vi.mocked(dbMock.listing.findUnique).mockResolvedValue({
      sellerId: SELLER,
      status: "CANCELLED",
      cosmeticPurchaseId: "copy-1",
    })
    const caller = createCaller(sellerCtx)
    await expect(caller.takeDown({ listingId: "listing-1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
  })

  it("success: sets the listing CANCELLED and clears escrowed on the copy, touching no balance", async () => {
    mockOwnedActiveListing()
    const caller = createCaller(sellerCtx)
    await caller.takeDown({ listingId: "listing-1" })

    expect(dbMock.listing.update).toHaveBeenCalledWith({
      where: { id: "listing-1" },
      data: { status: "CANCELLED", resolvedAt: expect.any(Date) },
    })
    expect(dbMock.cosmeticPurchase.update).toHaveBeenCalledWith({
      where: { id: "copy-1" },
      data: { escrowed: false },
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
  })
})

describe("listing.list — circulation invariant (V-01 / MKT-04)", () => {
  it("returns isMine/circulation/name derived server-side, and the groupBy carries no escrowed/userId/status filter", async () => {
    vi.mocked(dbMock.listing.findMany).mockResolvedValue([
      {
        id: "listing-1",
        price: 100,
        sellerId: SELLER,
        createdAt: new Date(),
        copy: { slug: AURORA.slug, mintNumber: 3, kind: "BACKGROUND" },
        seller: { id: SELLER, name: "Seller", username: "seller", image: null, equippedRing: null },
      },
    ])
    vi.mocked(dbMock.cosmeticPurchase.groupBy).mockResolvedValue([
      { slug: AURORA.slug, _count: { _all: 5 } },
    ])

    const caller = createCaller(meCtx)
    const r = await caller.list()

    expect(r[0]).toMatchObject({
      id: "listing-1",
      price: 100,
      isMine: false,
      circulation: 5,
      name: AURORA.name,
    })

    const groupByCall = vi.mocked(dbMock.cosmeticPurchase.groupBy).mock.calls[0][0] as Call
    expect(groupByCall.where).toBeUndefined()
  })

  it("V-01: create, buy and takeDown never call cosmeticPurchase.create or .delete — rows only move, never mint/destroy", async () => {
    // Drive all three mutating flows in one test so the assertion covers the router's
    // real behavior, not just an untouched mock's default state.
    vi.mocked(dbMock.cosmeticPurchase.findUnique).mockResolvedValue({
      userId: ME,
      slug: AURORA.slug,
      escrowed: false,
    })
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      equippedBackground: null,
      equippedRing: null,
    })
    vi.mocked(dbMock.listing.create).mockResolvedValue({ id: "listing-1" })
    vi.mocked(dbMock.cosmeticPurchase.updateMany).mockResolvedValue({ count: 1 })
    await createCaller(meCtx).create({ cosmeticPurchaseId: "copy-1", price: 100 })

    vi.mocked(dbMock.listing.findUnique).mockResolvedValue({
      id: "listing-1",
      sellerId: SELLER,
      price: 100,
      status: "ACTIVE",
      cosmeticPurchaseId: "copy-1",
      copy: { slug: AURORA.slug },
    })
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.listing.updateMany).mockResolvedValue({ count: 1 })
    await createCaller(buyerCtx).buy({ listingId: "listing-1" })

    vi.mocked(dbMock.listing.findUnique).mockResolvedValue({
      sellerId: SELLER,
      status: "ACTIVE",
      cosmeticPurchaseId: "copy-1",
    })
    await createCaller(sellerCtx).takeDown({ listingId: "listing-1" })

    expect(dbMock.cosmeticPurchase.create).not.toHaveBeenCalled()
    expect(dbMock.cosmeticPurchase.delete).not.toHaveBeenCalled()
  })
})
