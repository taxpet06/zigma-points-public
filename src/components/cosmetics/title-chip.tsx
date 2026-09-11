"use client"

import "./cosmetics.css"
import { cn } from "@/lib/utils"
import { ADMIN_TITLE, RARITY_META, getCosmetic } from "@/lib/cosmetics"

// TitleChip — the single attribution primitive for TITL-05. It resolves a slug
// rather than taking a name so no caller has to thread display text through its
// payload, and the name it renders is already env-overlaid by src/lib/cosmetics.ts
// (22-01), so this component has no redaction logic and needs none.
// Deliberate non-goal: never rendered in header.tsx (22-UI-SPEC §4, last row).
export function TitleChip({
  slug,
  size = "xs",
}: {
  slug: string | null | undefined
  size?: "xs" | "sm"
}) {
  if (!slug) return null

  let name: string
  let hex: string
  let glowClass: string

  if (slug === ADMIN_TITLE.slug) {
    name = ADMIN_TITLE.name
    hex = ADMIN_TITLE.hex
    glowClass = ADMIN_TITLE.glowClass
  } else {
    const cosmetic = getCosmetic(slug)
    if (!cosmetic) return null
    name = cosmetic.name
    hex = RARITY_META[cosmetic.rarity].hex
    glowClass = RARITY_META[cosmetic.rarity].glowClass
  }

  return (
    <span
      className={cn(
        // rounded-full needs more horizontal than vertical padding or the curved
        // caps crowd the text and it reads off-centre. justify-center keeps it
        // centred if a flex parent ever stretches the chip wider than its text.
        //
        // bg-background/70 + blur is the same fill MaxxerTrophy wears: these chips
        // sit on equipped card backgrounds, where coloured text on a busy cosmetic
        // has nothing to hold contrast against and stops reading.
        //
        // The leading class MUST come after the text-size utility: tailwind-merge
        // puts font-size and line-height in one conflict group (Tailwind's text-*
        // sizes set both), so whichever is later in argument order wins. Listed
        // first, it was silently evicted and the chip inherited line-height 1.5.
        //
        // leading-tight, not leading-none: a long title wraps to two lines in the
        // narrow People grid card, and at 1.0 the line boxes (10px) are shorter
        // than the glyph content (12px), so line 1's descenders collide with line
        // 2's ascenders. 1.25 keeps a single line compact and a wrapped pair legible.
        "inline-flex items-center justify-center rounded-full border bg-background/70 font-semibold backdrop-blur-sm",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2 py-0.5 text-[10px]",
        "leading-tight",
        glowClass,
      )}
      style={{ color: hex, borderColor: hex }}
    >
      {name}
    </span>
  )
}
