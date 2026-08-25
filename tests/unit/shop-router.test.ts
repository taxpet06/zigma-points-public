import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocks — mirrors flappy-router.test.ts's $transaction-over-shared-mock style.
const dbMock = vi.hoisted(() => {
  const mock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    cosmeticPurchase: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    listing: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mock)),
  }
  return mock
})

// runSerializable just adds Serializable isolation + retry around $transaction;
// the callback and the tx double are what these tests assert on.
vi.mock("@/lib/db", () => ({
  db: dbMock,
  runSerializable: (fn: (tx: unknown) => unknown) => dbMock.$transaction(fn),
}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { shopRouter } from "@/trpc/routers/shop"
import { getCosmetic, getLootbox, ADMIN_TITLE } from "@/lib/cosmetics"
import { Prisma } from "../../prisma/generated/prisma/client"

const createCaller = createCallerFactory(shopRouter)
const USER_ID = "user-1"
const ctx = { session: { user: { id: USER_ID } } } as never

// Real registry entries so affordability numbers are the actual registry values.
const RING = getCosmetic("spectrum")!
const BOX = getLootbox("26x-background")! // price 100

beforeEach(() => {
  for (const fn of Object.values(dbMock.user)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.cosmeticPurchase)) vi.mocked(fn).mockReset()
  for (const fn of Object.values(dbMock.listing)) vi.mocked(fn).mockReset()
  vi.mocked(dbMock.$transaction).mockClear()
})

describe("shop.openBox", () => {
  it("rejects NOT_FOUND for an unknown boxId before any $transaction", async () => {
    const caller = createCaller(ctx)

    await expect(caller.openBox({ boxId: "not-a-real-box" })).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(dbMock.$transaction).not.toHaveBeenCalled()
  })

  it("rejects BAD_REQUEST when balance < price, without granting anything", async () => {
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 0 })
    const caller = createCaller(ctx)

    await expect(caller.openBox({ boxId: BOX.id })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.cosmeticPurchase.create).not.toHaveBeenCalled()
  })

  // count() is called twice per open, in this order: copies the CALLER holds (duplicate
  // check), then copies of the slug in existence (the serial).
  function mockCounts(held: number, minted: number) {
    vi.mocked(dbMock.cosmeticPurchase.count)
      .mockResolvedValueOnce(held)
      .mockResolvedValueOnce(minted)
  }

  it("mints a new item at the next serial, debiting the box price under the session userId", async () => {
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    mockCounts(0, 6) // 6 already in circulation -> this copy is #7
    vi.mocked(dbMock.cosmeticPurchase.create).mockResolvedValue({ id: "p-1" })
    const caller = createCaller(ctx)

    const r = await caller.openBox({ boxId: BOX.id })

    expect(r.isNew).toBe(true)
    expect(r.mintNumber).toBe(7)
    expect(r.circulation).toBe(7)
    expect(r.refunded).toBe(0)
    expect(r.pricePaid).toBe(BOX.price)
    expect(dbMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, zigmaPoints: { gte: BOX.price } },
      data: { zigmaPoints: { decrement: BOX.price } },
    })
    expect(dbMock.cosmeticPurchase.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, slug: r.slug, kind: r.kind, pricePaid: BOX.price, mintNumber: 7 },
    })
    expect(dbMock.user.update).not.toHaveBeenCalled() // no refund on a first copy
  })

  it("mints the copy AND refunds half (rounded up) when the caller already holds one", async () => {
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    mockCounts(1, 2) // caller holds 1; 2 in circulation -> this copy is #3
    vi.mocked(dbMock.cosmeticPurchase.create).mockResolvedValue({ id: "p-2" })
    const caller = createCaller(ctx)

    const r = await caller.openBox({ boxId: BOX.id })

    expect(r.isNew).toBe(false)
    expect(r.mintNumber).toBe(3)
    expect(r.refunded).toBe(Math.ceil(BOX.price / 2))
    expect(dbMock.user.updateMany).toHaveBeenCalled() // debit still happened
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { zigmaPoints: { increment: Math.ceil(BOX.price / 2) } },
    })
    // The duplicate is a real copy now — it still gets minted.
    expect(dbMock.cosmeticPurchase.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, slug: r.slug, kind: r.kind, pricePaid: BOX.price, mintNumber: 3 },
    })
  })

  it("retries the whole tx when a concurrent open takes the serial (P2002 on the mint index)", async () => {
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.cosmeticPurchase.count)
      .mockResolvedValueOnce(0) // attempt 1: not held
      .mockResolvedValueOnce(4) // attempt 1: serial #5 — lost the race
      .mockResolvedValueOnce(0) // attempt 2: not held
      .mockResolvedValueOnce(5) // attempt 2: re-counted, serial #6
    vi.mocked(dbMock.cosmeticPurchase.create)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.8.0",
        }),
      )
      .mockResolvedValueOnce({ id: "p-3" })
    const caller = createCaller(ctx)

    const r = await caller.openBox({ boxId: BOX.id })

    expect(r.mintNumber).toBe(6) // the re-counted serial, never the collided one
    expect(dbMock.$transaction).toHaveBeenCalledTimes(2)
  })

  it("gives up rather than looping forever when the serial keeps colliding", async () => {
    vi.mocked(dbMock.user.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(dbMock.cosmeticPurchase.count).mockResolvedValue(4)
    vi.mocked(dbMock.cosmeticPurchase.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
      }),
    )
    const caller = createCaller(ctx)

    // Exhausted retries surface as a 500 — the tx rolled back, so no ZP was lost.
    await expect(caller.openBox({ boxId: BOX.id })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    })
    expect(dbMock.$transaction).toHaveBeenCalledTimes(4) // 1 attempt + 3 retries
  })
})

describe("shop.getShop", () => {
  function mockGetShop(opts: {
    purchases: { id: string; slug: string; mintNumber: number; escrowed: boolean }[]
    totals: { slug: string; _count: { _all: number } }[]
    activeListings?: { cosmeticPurchaseId: string }[]
    equippedBackground?: string | null
    equippedRing?: string | null
  }) {
    vi.mocked(dbMock.cosmeticPurchase.findMany).mockResolvedValue(opts.purchases)
    vi.mocked(dbMock.cosmeticPurchase.groupBy).mockResolvedValue(opts.totals)
    vi.mocked(dbMock.listing.findMany).mockResolvedValue(opts.activeListings ?? [])
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      equippedBackground: opts.equippedBackground ?? null,
      equippedRing: opts.equippedRing ?? null,
    })
  }

  it("annotates each item with the caller's copies and the slug's circulation", async () => {
    const AURORA = getCosmetic("aurora")!
    mockGetShop({
      purchases: [
        { id: "p-1", slug: AURORA.slug, mintNumber: 2, escrowed: false },
        { id: "p-2", slug: AURORA.slug, mintNumber: 9, escrowed: false },
      ],
      totals: [{ slug: AURORA.slug, _count: { _all: 12 } }],
      equippedBackground: AURORA.slug,
    })
    const caller = createCaller(ctx)

    const shop = await caller.getShop()
    const aurora = shop.find((c) => c.slug === AURORA.slug)!
    const unowned = shop.find((c) => c.slug === RING.slug)!

    expect(aurora.owned).toBe(true)
    expect(aurora.equipped).toBe(true)
    expect(aurora.circulation).toBe(12)
    expect(aurora.copies).toEqual([
      { id: "p-1", mintNumber: 2, escrowed: false, escrowState: null },
      { id: "p-2", mintNumber: 9, escrowed: false, escrowState: null },
    ])
    expect(unowned.owned).toBe(false)
    expect(unowned.copies).toEqual([])
    expect(unowned.circulation).toBe(0) // no rows for that slug -> nothing in circulation
  })

  it("tags a copy in the caller's ACTIVE listing set as LISTED, the other escrowed copy as OFFERED", async () => {
    const AURORA = getCosmetic("aurora")!
    mockGetShop({
      purchases: [
        { id: "p-listed", slug: AURORA.slug, mintNumber: 1, escrowed: true },
        { id: "p-offered", slug: AURORA.slug, mintNumber: 2, escrowed: true },
      ],
      totals: [{ slug: AURORA.slug, _count: { _all: 2 } }],
      activeListings: [{ cosmeticPurchaseId: "p-listed" }],
    })
    const caller = createCaller(ctx)

    const shop = await caller.getShop()
    const aurora = shop.find((c) => c.slug === AURORA.slug)!

    expect(aurora.copies).toEqual([
      { id: "p-listed", mintNumber: 1, escrowed: true, escrowState: "LISTED" },
      { id: "p-offered", mintNumber: 2, escrowed: true, escrowState: "OFFERED" },
    ])
  })

  it("still reports owned:true when the caller's only copy is escrowed", async () => {
    const AURORA = getCosmetic("aurora")!
    mockGetShop({
      purchases: [{ id: "p-1", slug: AURORA.slug, mintNumber: 1, escrowed: true }],
      totals: [{ slug: AURORA.slug, _count: { _all: 1 } }],
      activeListings: [{ cosmeticPurchaseId: "p-1" }],
    })
    const caller = createCaller(ctx)

    const shop = await caller.getShop()
    const aurora = shop.find((c) => c.slug === AURORA.slug)!

    expect(aurora.owned).toBe(true)
    expect(aurora.copies[0].escrowState).toBe("LISTED")
  })

  it("issues the circulation groupBy with no escrowed/userId/status filter (V-01 / MKT-04)", async () => {
    const AURORA = getCosmetic("aurora")!
    mockGetShop({
      purchases: [{ id: "p-1", slug: AURORA.slug, mintNumber: 1, escrowed: true }],
      totals: [{ slug: AURORA.slug, _count: { _all: 1 } }],
      activeListings: [{ cosmeticPurchaseId: "p-1" }],
    })
    const caller = createCaller(ctx)

    await caller.getShop()

    const call = vi.mocked(dbMock.cosmeticPurchase.groupBy).mock.calls[0][0] as {
      where?: Record<string, unknown>
    }
    const where = call.where ?? {}
    expect(Object.keys(where)).not.toEqual(
      expect.arrayContaining(["escrowed", "userId", "status"]),
    )
  })
})

describe("shop.equip", () => {
  it("rejects FORBIDDEN when the caller does not own a non-escrowed copy, without writing", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findFirst).mockResolvedValue(null)
    const caller = createCaller(ctx)

    await expect(caller.equip({ slug: RING.slug, kind: "RING" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("rejects FORBIDDEN when the caller's only copy is escrowed (T-20-06-01)", async () => {
    // The ownership findFirst is scoped to escrowed:false, so a mock that only ever
    // resolves for that where clause returns null when the copy is promised elsewhere.
    vi.mocked(dbMock.cosmeticPurchase.findFirst).mockResolvedValue(null)
    const caller = createCaller(ctx)

    await expect(caller.equip({ slug: RING.slug, kind: "RING" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(dbMock.cosmeticPurchase.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, slug: RING.slug, escrowed: false },
      select: { id: true },
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("writes equippedRing when the caller owns a non-escrowed RING copy", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findFirst).mockResolvedValue({ id: "p-1" })
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    const caller = createCaller(ctx)

    await caller.equip({ slug: RING.slug, kind: "RING" })

    expect(dbMock.cosmeticPurchase.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, slug: RING.slug, escrowed: false },
      select: { id: true },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { equippedRing: RING.slug },
    })
  })

  it("writes equippedBackground when the caller owns a BACKGROUND slug", async () => {
    const BACKGROUND = getCosmetic("aurora")!
    vi.mocked(dbMock.cosmeticPurchase.findFirst).mockResolvedValue({ id: "p-1" })
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    const caller = createCaller(ctx)

    await caller.equip({ slug: BACKGROUND.slug, kind: "BACKGROUND" })

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { equippedBackground: BACKGROUND.slug },
    })
  })

  it("unequips with slug=null without an ownership check", async () => {
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    const caller = createCaller(ctx)

    await caller.equip({ slug: null, kind: "RING" })

    expect(dbMock.cosmeticPurchase.findFirst).not.toHaveBeenCalled()
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { equippedRing: null },
    })
  })
})

describe("shop.equip — titles", () => {
  const TITLE = getCosmetic("title-common-1")!

  it("equips the admin virtual title for an ADMIN caller with no ownership lookup", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ role: "ADMIN" })
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    const caller = createCaller(ctx)

    await caller.equip({ slug: ADMIN_TITLE.slug, kind: "TITLE" })

    expect(dbMock.cosmeticPurchase.findFirst).not.toHaveBeenCalled()
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { equippedTitle: ADMIN_TITLE.slug },
    })
  })

  it("rejects a USER caller equipping the admin virtual title, writing nothing", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ role: "USER" })
    const caller = createCaller(ctx)

    await expect(caller.equip({ slug: ADMIN_TITLE.slug, kind: "TITLE" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.cosmeticPurchase.findFirst).not.toHaveBeenCalled()
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("rejects the admin virtual title slug under kind BACKGROUND even for an ADMIN", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({ role: "ADMIN" })
    const caller = createCaller(ctx)

    await expect(
      caller.equip({ slug: ADMIN_TITLE.slug, kind: "BACKGROUND" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("writes equippedTitle when the caller owns a non-escrowed TITLE copy", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findFirst).mockResolvedValue({ id: "p-1" })
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    const caller = createCaller(ctx)

    await caller.equip({ slug: TITLE.slug, kind: "TITLE" })

    expect(dbMock.cosmeticPurchase.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, slug: TITLE.slug, escrowed: false },
      select: { id: true },
    })
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { equippedTitle: TITLE.slug },
    })
  })

  it("rejects FORBIDDEN equipping a title copy the caller does not own", async () => {
    vi.mocked(dbMock.cosmeticPurchase.findFirst).mockResolvedValue(null)
    const caller = createCaller(ctx)

    await expect(caller.equip({ slug: TITLE.slug, kind: "TITLE" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("unequips a title (slug=null) with no ownership lookup, touching only equippedTitle", async () => {
    vi.mocked(dbMock.user.update).mockResolvedValue({ id: USER_ID })
    const caller = createCaller(ctx)

    await caller.equip({ slug: null, kind: "TITLE" })

    expect(dbMock.cosmeticPurchase.findFirst).not.toHaveBeenCalled()
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { equippedTitle: null },
    })
  })
})
