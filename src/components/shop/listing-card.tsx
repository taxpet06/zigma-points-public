"use client"

// ListingCard — the transaction card for the community board (Slop guard,
// 20-UI-SPEC.md §0/§3.1): the picker card (collectible-picker-view.tsx) is a
// SELECTION card (ring + check, no price, no seller). This card is the
// TRANSACTION card — the price is the anchor, the seller is named, and
// there is exactly one committing action. Same tokens, different content.
//
// Presentational only: no query, no mutation. ListingsBoard owns both and
// passes down a row + the grid stagger index + a busy flag + the two callbacks.

import { UserCircle } from "lucide-react"
import { CardBackground } from "@/components/cosmetics/card-background"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UserAvatar } from "@/components/cosmetics/user-avatar"
import { Button } from "@/components/ui/button"
import { RARITY_META } from "@/lib/cosmetics"
import { cn } from "@/lib/utils"

export type ListingRow = {
  id: string
  price: number
  sellerId: string
  isMine: boolean
  name: string
  rarity: "COMMON" | "RARE" | "LEGENDARY" | undefined
  circulation: number
  copy: { slug: string; kind: "BACKGROUND" | "RING" | "TITLE"; mintNumber: number }
  seller: { id: string; name: string | null; username: string | null; image: string | null; equippedRing: string | null }
}

export function ListingCard({
  listing,
  i,
  busy,
  onBuy,
  onTakeDown,
}: {
  listing: ListingRow
  i: number
  busy: boolean
  onBuy: (listingId: string) => void
  onTakeDown: (listingId: string) => void
}) {
  const rarity = listing.rarity ?? "COMMON"
  const meta = RARITY_META[rarity]
  const initials = ((listing.seller.name || "?")[0] ?? "?").toUpperCase()

  return (
    <div
      style={{ "--i": i % 8 } as React.CSSProperties}
      className="rounded-lg border bg-card p-3 text-center animate-card-rise"
    >
      {listing.copy.kind === "BACKGROUND" ? (
        <div className={cn("relative isolate mx-auto h-16 w-16 overflow-hidden rounded-md", meta.glowClass)}>
          <CardBackground variant={listing.copy.slug} />
        </div>
      ) : listing.copy.kind === "TITLE" ? (
        <div
          className={cn(
            "mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted p-1 text-center",
            meta.glowClass,
          )}
        >
          <span className="font-semibold leading-tight" style={{ color: meta.hex, fontSize: 12 }}>
            {listing.name}
          </span>
        </div>
      ) : (
        <div className={cn("mx-auto w-fit rounded-full", meta.glowClass)}>
          <AvatarRing variant={listing.copy.slug} size={44}>
            <Avatar className="h-11 w-11">
              <AvatarFallback>
                <UserCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </AvatarFallback>
            </Avatar>
          </AvatarRing>
        </div>
      )}

      <p className="mt-2 truncate text-sm font-medium">{listing.name}</p>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: meta.hex }}>
        {meta.label}
      </span>
      <p className="mt-1 font-mono tabular-nums text-[10px] text-muted-foreground">
        #{listing.copy.mintNumber} / {listing.circulation}
      </p>

      {!listing.isMine && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <UserAvatar
            userId={listing.seller.id}
            image={listing.seller.image}
            name={listing.seller.name}
            ring={listing.seller.equippedRing}
            size={20}
            fallback={<span className="text-[9px] font-semibold">{initials}</span>}
          />
          <span className="truncate text-xs text-muted-foreground">{listing.seller.name ?? "Someone"}</span>
        </div>
      )}

      {listing.isMine ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 min-h-11 w-full"
          disabled={busy}
          onClick={() => onTakeDown(listing.id)}
        >Take down</Button>
      ) : (
        <Button
          size="sm"
          className="mt-3 min-h-11 w-full"
          disabled={busy}
          onClick={() => onBuy(listing.id)}
        >
          Buy · <span className="font-mono tabular-nums">{listing.price} ZP</span>
        </Button>
      )}
    </div>
  )
}
