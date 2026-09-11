// Shared Zod schemas for the Shop's openBox/equip input.
// Single source of truth for tRPC server-side validation and client forms.
//
// Slug existence is NOT validated here — it's checked server-side against the
// COSMETICS registry (getCosmetic) so the registry stays the single source of
// truth for what slugs exist (T-08-09).

import { z } from "zod"

// Open a lootbox by boxId. Price/collection/kind are looked up server-side
// from the LOOTBOXES registry; the roll happens server-side too.
// .strict(): zod's default .object() silently STRIPS unknown keys. A client-sent
// extra field becomes inexpressible, not merely ignored — .strict() makes it a rejection.
export const openBoxSchema = z.object({
  boxId: z.string(),
}).strict()

// Equip (slug set) or unequip (slug null) a cosmetic for the given kind.
export const equipSchema = z.object({
  slug: z.string().min(1).nullable(),
  kind: z.enum(["BACKGROUND", "RING", "TITLE"]),
})
