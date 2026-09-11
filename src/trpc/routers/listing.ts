// Listing tRPC router — the community marketplace money path (Phase 20 Listings board).
//
// Procedures:
//   list     — every ACTIVE listing, newest first, with per-slug circulation attached
//   create   — list a copy you own at a price you set; escrows it atomically
//   buy      — buy an ACTIVE listing; full price moves, no fee; the copy lands with you
//   takeDown — seller reclaims their own listing at any time; no money moves
//
// Security mirrors shop.ts (money path) / transfer.ts (approver gate):
//   - protectedProcedure gates auth (UNAUTHORIZED before any DB access)
//   - the acting user is always ctx.session.user.id (never client input — IDOR guard,
//     T-20-04-01): create refuses a copy whose userId isn't the caller, takeDown refuses
//     a listing whose sellerId isn't the caller, buy never lets the seller buy their own
//     listing
//   - create's escrow claim is a conditional updateMany (where: { ..., escrowed: false })
//     inside the SAME transaction that creates the Listing row — count === 0 rolls the
//     listing back (T-20-04-04). No standalone "check then write" anywhere.
//   - buy runs in runSerializable and re-verifies status === "ACTIVE" inside the
//     transaction via a second conditional updateMany — two concurrent buyers can only
//     ever produce one sale; the loser's own debit rolls back with them (T-20-04-02)
//   - buy's debit IS the affordability check: a conditional updateMany on the buyer's
//     balance, never a negative balance (T-20-04-03)
//   - no fee: the seller's credit is the exact price the buyer was debited (T-20-04-06 —
//     price always comes from the stored Listing row, never client input)
//   - the circulation groupBy is unfiltered on purpose — rows move, they are never
//     created or deleted (T-20-04-08 / MKT-04)
//   - notifyListingSold fires post-commit via after(), never awaited inline (T-20-04-09)

import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import { createListingSchema, listingIdSchema } from "@/lib/validation/listing"
import { getCosmetic } from "@/lib/cosmetics"
import { notifyListingSold } from "@/lib/notifications"

export const listingRouter = createTRPCRouter({
  /**
   * Every ACTIVE listing, newest first — the community board. isMine is derived
   * server-side so the client never re-derives direction (the listPending/listLoans
   * convention). Circulation is a single unfiltered groupBy, exactly like getShop's.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id // never client input — IDOR guard

    const [rows, totals] = await Promise.all([
      db.listing.findMany({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          price: true,
          sellerId: true,
          createdAt: true,
          copy: { select: { slug: true, mintNumber: true, kind: true } },
          seller: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              equippedRing: true,
            },
          },
        },
      }),
      // Circulation must stay unfiltered by escrowed/userId/status — MKT-04. A listed or
      // sold copy is still in circulation; only ownership moves, never this count.
      db.cosmeticPurchase.groupBy({
        by: ["slug"],
        _count: { _all: true },
      }),
    ])
    const circulation = new Map(totals.map((t) => [t.slug, t._count._all]))

    return rows.map((r) => {
      const cosmetic = getCosmetic(r.copy.slug)
      return {
        id: r.id,
        price: r.price,
        sellerId: r.sellerId,
        createdAt: r.createdAt,
        isMine: r.sellerId === me,
        seller: r.seller,
        copy: r.copy,
        name: cosmetic?.name ?? r.copy.slug,
        rarity: cosmetic?.rarity,
        circulation: circulation.get(r.copy.slug) ?? 0,
      }
    })
  }),

  /**
   * Lists a copy you own at a price you set, escrowing it in the same transaction that
   * creates the Listing row. The escrow claim is a conditional updateMany
   * (where: { ..., escrowed: false }) whose count === 0 rolls the just-created row back
   * — Pattern 1 from 20-RESEARCH.md. No runSerializable needed: the conditional update
   * IS the atomic gate, there's no separate count-then-insert read racing a write.
   */
  create: protectedProcedure
    .input(createListingSchema)
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id // never client input — IDOR guard

      const copy = await db.cosmeticPurchase.findUnique({
        where: { id: input.cosmeticPurchaseId },
        select: { userId: true, slug: true, escrowed: true },
      })
      if (!copy || copy.userId !== me) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own that." })
      }
      if (copy.escrowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That item is already listed or offered.",
        })
      }

      // Equipped-block is the STRICT rule (20-CONTEXT.md addendum, supersedes
      // 20-RESEARCH.md's "last non-escrowed copy" nuance): ALL copies of an equipped
      // slug are blocked, not just the last free one. Unequip first. All three equipped
      // slots (background/ring/title) are checked — a future fourth kind is an obvious
      // edit site here, not a silent omission.
      const user = await db.user.findUnique({
        where: { id: me },
        select: { equippedBackground: true, equippedRing: true, equippedTitle: true },
      })
      if (
        user?.equippedBackground === copy.slug ||
        user?.equippedRing === copy.slug ||
        user?.equippedTitle === copy.slug
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unequip this item before listing it.",
        })
      }

      return db.$transaction(async (tx) => {
        const listing = await tx.listing.create({
          data: { sellerId: me, cosmeticPurchaseId: input.cosmeticPurchaseId, price: input.price },
        })
        // The escrow claim — count === 0 means someone else claimed this copy (a
        // concurrent listing/offer, or it stopped being free) since the read above; the
        // throw rolls the just-created listing back with it. Never a standalone write.
        const claimed = await tx.cosmeticPurchase.updateMany({
          where: { id: input.cosmeticPurchaseId, userId: me, escrowed: false },
          data: { escrowed: true },
        })
        if (claimed.count === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That item isn't available to list right now.",
          })
        }
        return listing
      })
    }),

  /**
   * Buys an ACTIVE listing: the buyer pays the full price, the seller receives the full
   * price (no fee, no burn — V-08), and the copy moves to the buyer. Runs in
   * runSerializable with the ACTIVE status re-read inside the transaction: two
   * concurrent buyers must produce exactly one sale and one clean error (V-04).
   */
  buy: protectedProcedure
    .input(listingIdSchema)
    .mutation(async ({ ctx, input }) => {
      const buyerId = ctx.session.user.id // never client input — IDOR guard

      const result = await runSerializable(async (tx) => {
        const listing = await tx.listing.findUnique({
          where: { id: input.listingId },
          select: {
            id: true,
            sellerId: true,
            price: true,
            status: true,
            cosmeticPurchaseId: true,
            copy: { select: { slug: true } },
          },
        })
        if (!listing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found." })
        }
        if (listing.status !== "ACTIVE") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That listing is no longer available.",
          })
        }
        if (listing.sellerId === buyerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You can't buy your own listing." })
        }

        // Gate 1 — the debit IS the affordability check (same shape as openBox).
        const debited = await tx.user.updateMany({
          where: { id: buyerId, zigmaPoints: { gte: listing.price } },
          data: { zigmaPoints: { decrement: listing.price } },
        })
        if (debited.count === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You don't have enough ZP." })
        }

        // Gate 2 — the race gate. Only one concurrent buyer's updateMany affects a row;
        // the loser gets a clean error and the whole tx (their debit above included)
        // rolls back automatically.
        const sold = await tx.listing.updateMany({
          where: { id: listing.id, status: "ACTIVE" },
          data: { status: "SOLD", buyerId, resolvedAt: new Date() },
        })
        if (sold.count === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Someone already bought this." })
        }

        // No fee: the seller receives the FULL price, no cut, no burn (V-08).
        await tx.user.update({
          where: { id: listing.sellerId },
          data: { zigmaPoints: { increment: listing.price } },
        })
        await tx.cosmeticPurchase.update({
          where: { id: listing.cosmeticPurchaseId },
          data: { userId: buyerId, escrowed: false },
        })

        return { sellerId: listing.sellerId, price: listing.price, slug: listing.copy.slug }
      })

      // Post-commit, fire-and-forget — delivery failure must never affect the sale.
      after(() =>
        notifyListingSold(
          result.sellerId,
          ctx.session.user.name ?? "Someone",
          getCosmetic(result.slug)?.name ?? result.slug,
          result.price,
        ),
      )
      return { bought: true }
    }),

  /**
   * Seller takes down their own ACTIVE listing at any time — no money moves, the copy
   * returns to their inventory (escrowed cleared).
   */
  takeDown: protectedProcedure
    .input(listingIdSchema)
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id // never client input — IDOR guard

      await db.$transaction(async (tx) => {
        const listing = await tx.listing.findUnique({
          where: { id: input.listingId },
          select: { sellerId: true, status: true, cosmeticPurchaseId: true },
        })
        if (!listing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found." })
        }
        if (listing.sellerId !== me) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "That listing isn't yours to take down.",
          })
        }
        if (listing.status !== "ACTIVE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That listing is no longer active." })
        }

        await tx.listing.update({
          where: { id: input.listingId },
          data: { status: "CANCELLED", resolvedAt: new Date() },
        })
        await tx.cosmeticPurchase.update({
          where: { id: listing.cosmeticPurchaseId },
          data: { escrowed: false },
        })
      })

      return { takenDown: true }
    }),
})
