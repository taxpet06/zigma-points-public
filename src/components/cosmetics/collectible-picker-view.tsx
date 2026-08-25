"use client"

// CollectiblePickerView — the collectible twin of UserPickerView
// (src/components/feed/user-picker-view.tsx). Same shell, same gesture:
// Back/OK header, search field, responsive card grid, ring + Check selection
// feedback. Different where UI-SPEC §5 says to: single-select (not multi),
// the card face is the item itself (not a person), one card per COPY (not
// per slug — three Auroras means three cards, each with its own serial), and
// escrowed copies are simply absent — they're promised to a listing or trade
// offer elsewhere and need no UI here.

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Check, Package, UserCircle } from "lucide-react"
import Link from "next/link"
import { useTRPC } from "@/trpc/client"
import { CardBackground } from "@/components/cosmetics/card-background"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RARITY_META } from "@/lib/cosmetics"
import { cn } from "@/lib/utils"

type ShopItem = {
  slug: string
  kind: "BACKGROUND" | "RING" | "TITLE"
  name: string
  tag: string
  collection: string
  rarity: "COMMON" | "RARE" | "LEGENDARY"
  owned: boolean
  equipped: boolean
  circulation: number
  copies: {
    id: string
    mintNumber: number
    escrowed: boolean
    escrowState: "LISTED" | "OFFERED" | null
  }[]
}

export function CollectiblePickerView({
  value,
  onConfirm,
  onBack,
}: {
  value: string | null
  onConfirm: (copyId: string) => void
  onBack: () => void
}) {
  const trpc = useTRPC()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(value)

  const { data, isLoading } = useQuery(trpc.shop.getShop.queryOptions())
  const items = (data ?? []) as ShopItem[]

  // One card per free copy, flattened the same way ProfileCosmetics.tiles() does.
  // Escrowed copies are dropped here — they're held by a listing/trade elsewhere
  // (UI-SPEC §5: "Copies already listed or offered simply aren't here"). `blocked`
  // is the strict equipped rule from the CONTEXT addendum: a slug's equipped flag
  // blocks every copy of that slug, not just the last free one.
  const tiles = items.flatMap((item) =>
    item.copies
      .filter((copy) => !copy.escrowed)
      .map((copy) => ({ item, copy, blocked: item.equipped }))
  )

  const filtered =
    query.trim().length === 0
      ? tiles
      : tiles.filter(({ item }) =>
          item.name.toLowerCase().includes(query.trim().toLowerCase())
        )

  return (
    <div className="flex min-h-[60vh] flex-col">
      {/* Deliberately NOT sticky — see UserPickerView for the rationale; same
          block, mirrored verbatim. */}
      <div className="flex flex-col gap-3 bg-background pb-3">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selected === null}
            onClick={() => selected && onConfirm(selected)}
          >
            OK
          </Button>
        </div>
        <Input
          aria-label="Search your collectibles"
          placeholder="Search your collectibles…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Equipped items can&apos;t be listed — unequip from your profile first.
        </p>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Package className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-semibold">Nothing to sell yet.</h2>
          <p className="text-sm text-muted-foreground">Open a lootbox to start a collection.</p>
          <Button asChild size="sm" variant="link">
            <Link href="/shop">Go to Lootboxes</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map(({ item, copy, blocked }) => {
            const isSelected = selected === copy.id
            return (
              <button
                key={copy.id}
                type="button"
                disabled={blocked}
                aria-disabled={blocked}
                aria-pressed={isSelected}
                onClick={() => !blocked && setSelected(copy.id)}
                className={cn(
                  "relative isolate overflow-hidden flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-[transform,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]",
                  isSelected ? "ring-2 ring-primary" : "hover:border-primary/30",
                  blocked && "opacity-50"
                )}
              >
                {isSelected && (
                  <span className="animate-in zoom-in-50 fade-in-0 duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                )}
                {blocked && (
                  <span className="absolute right-2 top-2 z-10 rounded-full border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Equipped</span>
                )}
                {item.kind === "BACKGROUND" ? (
                  <div
                    className={cn(
                      "relative h-16 w-16 overflow-hidden rounded-md",
                      RARITY_META[item.rarity].glowClass
                    )}
                  >
                    <CardBackground variant={item.slug} />
                  </div>
                ) : item.kind === "TITLE" ? (
                  <div
                    className={cn(
                      "flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted p-1 text-center",
                      RARITY_META[item.rarity].glowClass,
                    )}
                  >
                    <span className="font-semibold leading-tight" style={{ color: RARITY_META[item.rarity].hex, fontSize: 12 }}>
                      {item.name}
                    </span>
                  </div>
                ) : (
                  <div className={cn("rounded-full", RARITY_META[item.rarity].glowClass)}>
                    <AvatarRing variant={item.slug} size={48}>
                      <Avatar className="h-12 w-12">
                        <AvatarFallback>
                          <UserCircle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                        </AvatarFallback>
                      </Avatar>
                    </AvatarRing>
                  </div>
                )}
                <div className="w-full min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: RARITY_META[item.rarity].hex }}
                  >
                    {RARITY_META[item.rarity].label}
                  </span>
                  <p className="mt-1 font-mono tabular-nums text-[10px] text-muted-foreground">
                    #{copy.mintNumber} / {item.circulation}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
