// Shared Zod schemas for the community Listings board (buy/sell a minted CosmeticPurchase copy).
// Single source of truth for tRPC server-side validation and client forms.
//
// The acting user is always ctx.session.user.id server-side — never a client field
// (mass-assignment / IDOR guard), so only the listing/copy ids and the price are accepted here.
//
// zpPriceSchema is the ONE marketplace price bound: it governs a listing price here AND a
// trade-offer price in ./transfer (tradeOfferSchema imports it) so the two can never drift
// apart into two different ceilings. Integer, >= 1, <= 1,000,000 per 20-CONTEXT.md's addendum.
// .strict(): zod's default .object() silently STRIPS unknown keys. A client-sent
// extra field becomes inexpressible, not merely ignored — .strict() makes it a rejection.

import { z } from "zod"

export const zpPriceSchema = z.coerce
  .number()
  .int()
  .min(1, "Price must be at least 1 ZP")
  .max(1_000_000, "Price is too high")

// List a copy you own for sale at a price you set.
export const createListingSchema = z
  .object({
    cosmeticPurchaseId: z.string().min(1),
    price: zpPriceSchema,
  })
  .strict()

// One schema serves both `buy` and `takeDown` — both act on a single listing by id.
export const listingIdSchema = z
  .object({
    listingId: z.string().min(1),
  })
  .strict()
