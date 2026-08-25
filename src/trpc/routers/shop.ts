// Shop tRPC router — cosmetics catalog, atomic lootbox open (ZP self-sink), and equip.
//
// Procedures:
//   getShop — the COSMETICS registry annotated with the caller's copies (each with its
//             circulation serial, escrow flag and escrow state), the slug's total
//             circulation, and equipped state
//   openBox — atomic ZP debit + server-side roll + a minted CosmeticPurchase copy;
//             a duplicate still grants the copy AND refunds ceil(price/2)
//   equip   — ownership-checked equipped-slug write (or null to unequip), narrowed to
//             the caller's non-escrowed copies — a copy promised to a listing or trade
//             offer does not count as ownership for equipping
//
// Every copy carries a mintNumber: the Nth copy of that slug ever minted (1-based),
// so a card can read "#7 of 12 in circulation". Duplicates are ownable — the same user
// can hold several copies of one slug, each with its own serial.
//
// Security mirrors transfer.ts (spend) / user.ts (P2002 duplicate guard):
//   - protectedProcedure gates auth (UNAUTHORIZED before any DB access)
//   - the acting user is always ctx.session.user.id (never client input — IDOR guard, T-17-04)
//   - openBox debits via a conditional updateMany (zigmaPoints gte box.price) so the balance
//     check and decrement are one atomic, row-locked op — a losing concurrent open debits
//     0 rows and rolls back, never overdrawing the balance negative (T-17-06)
//   - the roll happens server-side (rollLootbox) BEFORE the transaction — the client sends
//     only boxId and can never influence or claim a specific item (T-17-05)
//   - the mint is count-then-insert, which is NOT race-safe under READ COMMITTED: it runs
//     in runSerializable, and the (slug, mintNumber) unique index is the backstop. Two
//     concurrent opens of the same slug can never share a serial — the loser surfaces as a
//     serialization failure (runSerializable retries) or a P2002 on the mint index (retried
//     here); either way the whole tx, debit included, rolls back and re-runs (T-17-08)
//   - a duplicate (the caller already holds a copy) refunds ceil(price/2) in the same
//     transaction as the debit, and still mints the copy (T-17-07)
//   - equip requires a CosmeticPurchase row before writing the equipped field (T-08-08),
//     with one ADMIN-gated exception for the virtual admin-only title (T-22-06): the
//     caller's role is read fresh from the DB via ctx.session.user.id, never trusted from
//     the session payload, and a non-ADMIN is rejected before any write
//   - `escrowed` / `escrowState` are derived entirely server-side from CosmeticPurchase.escrowed
//     and the caller's own ACTIVE listings — no client input can ever set or clear escrow
//     from this router (T-20-06-02); listing.ts and transfer.ts are the only writers

import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import { openBoxSchema, equipSchema } from "@/lib/validation/shop"
import { COSMETICS, getCosmetic, getLootbox, rollLootbox, ADMIN_TITLE } from "@/lib/cosmetics"
import { Prisma } from "../../../prisma/generated/prisma/client"

/** Retries a mint whose serial lost a race to a concurrent open of the same slug. */
async function retryOnMintConflict<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const isSerialTaken =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
      if (isSerialTaken && attempt < retries) continue
      throw e
    }
  }
}

export const shopRouter = createTRPCRouter({
  /**
   * Returns the full cosmetics catalog annotated, per item, with the caller's copies
   * (each with its circulation serial, escrow flag and Listed/Offered state), the
   * slug's total circulation, and equipped state. Escrowed copies are NOT filtered out
   * — the profile inventory (UI-SPEC §5.1) keeps them visible, dimmed, with a pill; the
   * collectible picker does its own client-side filtering of the same payload.
   */
  getShop: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const [purchases, user, activeListings, totals] = await Promise.all([
      db.cosmeticPurchase.findMany({
        where: { userId },
        select: { id: true, slug: true, mintNumber: true, escrowed: true },
        orderBy: { mintNumber: "asc" },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { equippedBackground: true, equippedRing: true, equippedTitle: true },
      }),
      // Scoped to the caller's own ACTIVE listings — distinguishes Listed (found here)
      // from Offered (escrowed but not here, so held by a pending trade offer instead).
      db.listing.findMany({
        where: { sellerId: userId, status: "ACTIVE" },
        select: { cosmeticPurchaseId: true },
      }),
      // Circulation is a global count per slug — one groupBy, not a query per item.
      // This call MUST NEVER gain a filter scoping it by escrow, owner or listing
      // state: circulation is a global per-slug count, and MKT-04 requires it to be
      // identical before and after a listing, sale, offer or take-down (rows move,
      // they are never created or deleted).
      db.cosmeticPurchase.groupBy({ by: ["slug"], _count: { _all: true } }),
    ])
    const circulation = new Map(totals.map((t) => [t.slug, t._count._all]))
    const listedIds = new Set(activeListings.map((l) => l.cosmeticPurchaseId))
    return COSMETICS.map((c) => {
      const copies = purchases
        .filter((p) => p.slug === c.slug)
        .map((p) => ({
          id: p.id,
          mintNumber: p.mintNumber,
          escrowed: p.escrowed,
          escrowState: !p.escrowed ? null : listedIds.has(p.id) ? "LISTED" : "OFFERED",
        }))
      return {
        ...c,
        copies,
        // An inventory that contains only escrowed copies still reads as owned — the
        // copy is still the caller's until it sells or the offer resolves.
        owned: copies.length > 0,
        circulation: circulation.get(c.slug) ?? 0,
        // Equip state is per-slug, not per-copy — the user row stores a slug. Holding
        // three Auroras and equipping one marks all three tiles equipped.
        // ponytail: no equippedPurchaseId column until "which copy is equipped" matters.
        equipped:
          c.kind === "BACKGROUND"
            ? user?.equippedBackground === c.slug
            : c.kind === "RING"
              ? user?.equippedRing === c.slug
              : user?.equippedTitle === c.slug,
      }
    })
  }),

  /**
   * Opens a lootbox: atomic ZP debit (self-sink — no recipient) + server-side weighted
   * roll + a freshly minted copy. Unknown boxId -> NOT_FOUND. Insufficient ZP ->
   * BAD_REQUEST. A duplicate (the caller already holds a copy) still mints the copy and
   * refunds ceil(price/2), returning isNew:false. Returns the copy's mintNumber and the
   * slug's circulation total including it.
   */
  openBox: protectedProcedure
    .input(openBoxSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id // never client input — IDOR guard
      const box = getLootbox(input.boxId)
      if (!box) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That lootbox doesn't exist." })
      }

      // The roll is server-side and happens BEFORE the transaction — the client sends
      // only boxId and can never influence or claim a specific item.
      const slug = rollLootbox(input.boxId)
      const cosmetic = getCosmetic(slug)!

      // Duplicates refund half the box price, rounded up.
      const refundAmount = Math.ceil(box.price / 2)

      // Two concurrent opens rolling the SAME slug can both read the same count and race
      // to the same serial; the (slug, mintNumber) unique index rejects the loser with a
      // P2002 and the whole tx (debit included) rolls back, so a retry re-counts cleanly.
      // runSerializable covers the 40001 flavour of the same conflict.
      const mint = await retryOnMintConflict(() =>
        runSerializable(async (tx) => {
          // The debit itself is the affordability gate: the conditional where evaluates
          // the balance predicate under the row lock, so a losing concurrent open debits
          // 0 rows and rolls back — never a negative balance.
          const debited = await tx.user.updateMany({
            where: { id: userId, zigmaPoints: { gte: box.price } },
            data: { zigmaPoints: { decrement: box.price } },
          })
          if (debited.count === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You don't have enough ZP." })
          }

          // Duplicate = the caller already holds a copy. They still get this copy, plus
          // half the price back (LOOT-03).
          const held = await tx.cosmeticPurchase.count({ where: { userId, slug } })
          if (held > 0) {
            await tx.user.update({
              where: { id: userId },
              data: { zigmaPoints: { increment: refundAmount } },
            })
          }

          const minted = await tx.cosmeticPurchase.count({ where: { slug } })
          const mintNumber = minted + 1
          await tx.cosmeticPurchase.create({
            data: { userId, slug, kind: cosmetic.kind, pricePaid: box.price, mintNumber },
          })

          return { isNew: held === 0, mintNumber, circulation: mintNumber }
        }),
      )

      return {
        boxId: input.boxId,
        slug,
        name: cosmetic.name,
        rarity: cosmetic.rarity,
        kind: cosmetic.kind,
        isNew: mint.isNew,
        mintNumber: mint.mintNumber,
        circulation: mint.circulation,
        pricePaid: box.price,
        refunded: mint.isNew ? 0 : refundAmount,
      }
    }),

  /**
   * Equips (or unequips, slug=null) a cosmetic. Requires ownership of a non-escrowed
   * CosmeticPurchase row — a copy promised to a listing or trade offer cannot be equipped.
   */
  equip: protectedProcedure
    .input(equipSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      if (input.slug !== null) {
        // The admin virtual title has no CosmeticPurchase row by design (22-CONTEXT.md) —
        // that absence is exactly what makes it unlistable and untradeable, since
        // listing.ts and transfer.ts both start from a cosmeticPurchase row that can never
        // exist for it. ADMT-02 needs no block list as a result. The only special case
        // equip needs is this ADMIN-gated entitlement, checked server-side before any
        // write (T-22-06).
        if (input.slug === ADMIN_TITLE.slug && input.kind === "TITLE") {
          const me = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
          if (me?.role !== "ADMIN") {
            throw new TRPCError({ code: "FORBIDDEN", message: "You don't own that." })
          }
        } else {
          // The slug must exist in the registry AND its kind must match the target slot,
          // else a background slug could be written into equippedRing (invalid state).
          const cosmetic = getCosmetic(input.slug)
          if (!cosmetic || cosmetic.kind !== input.kind) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "That item can't go there." })
          }
          // findFirst, not findUnique — (userId, slug) is no longer unique now that a user
          // can hold several copies. Owning any non-escrowed copy is enough to equip the
          // look — an escrowed copy does not count as ownership for equipping, it is
          // promised to a buyer or a trade-offer recipient.
          const owned = await db.cosmeticPurchase.findFirst({
            where: { userId, slug: input.slug, escrowed: false },
            select: { id: true },
          })
          if (!owned) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You don't own that." })
          }
        }
      }

      await db.user.update({
        where: { id: userId },
        data:
          input.kind === "BACKGROUND"
            ? { equippedBackground: input.slug }
            : input.kind === "RING"
              ? { equippedRing: input.slug }
              : { equippedTitle: input.slug },
      })

      return { equipped: true }
    }),
})
