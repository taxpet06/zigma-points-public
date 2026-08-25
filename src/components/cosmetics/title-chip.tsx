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
        "inline-flex items-center justify-center rounded-full border font-semibold leading-none",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2 py-0.5 text-[10px]",
        glowClass,
      )}
      style={{ color: hex, borderColor: hex }}
    >
      {name}
    </span>
  )
}
