"use client"

// LootboxCard — the shop's per-section acquisition card. A single compact tile
// per section (the same shape for backgrounds and rings) that replaces the grid of
// individually-buyable item cards — lootboxes are the only acquisition path, and
// owned items are managed/equipped from the profile ("Your cosmetics"). Presentational
// only: the parent (shop-grid.tsx) owns the modal + openBox mutation. The chest is the
// shared ChestSvg; its idle bob lives in cosmetics.css.

import { ChestSvg } from "@/components/shop/chest-svg"
import { Button } from "@/components/ui/button"
import { COSMETICS, LOOTBOXES, type CosmeticKind } from "@/lib/cosmetics"

export function LootboxCard({
  boxId,
  kind,
  onOpen,
}: {
  boxId: string
  kind: CosmeticKind
  onOpen: (boxId: string) => void
}) {
  const box = LOOTBOXES[boxId]
  if (!box) return null

  const noun = kind === "BACKGROUND" ? "backgrounds" : kind === "RING" ? "rings" : "titles"
  // Actual number of items in THIS box (its collection + kind) — grows as the
  // collection does, so the tag never drifts from the catalog.
  const count = COSMETICS.filter(
    (c) => c.collection === box.collection && c.kind === box.kind,
  ).length

  return (
    // Whole card is the click target. The inner Button carries no onClick — its
    // native click (mouse or keyboard Enter/Space) bubbles up to this handler, so
    // there's one source of truth and no double-open. Keep it that way.
    <div
      onClick={() => onOpen(boxId)}
      className="mx-auto flex max-w-[220px] cursor-pointer flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex h-16 w-16 items-center justify-center">
        <ChestSvg size={60} />
      </div>
      <div className="text-sm font-medium">{box.name}</div>
      <div className="text-xs text-muted-foreground">
        {count} {noun} · {box.price} ZP
      </div>
      <Button className="min-h-11 w-full">View</Button>
    </div>
  )
}
