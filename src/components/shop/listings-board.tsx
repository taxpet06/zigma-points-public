"use client"

// ListingsBoard — the community marketplace board behind /shop's Listings subtab.
// Three views owned locally: "board" (the default — sell action + your listings +
// everyone else's), "picker" (CollectiblePickerView swapped in full-screen, exactly
// as TransferForm swaps itself for UserPickerView — no modal), and "price" (a
// compact panel to name the price before listing.create fires).

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Tag, Store, ArrowLeft, UserCircle } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CardBackground } from "@/components/cosmetics/card-background"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { CollectiblePickerView } from "@/components/cosmetics/collectible-picker-view"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"
import { RARITY_META } from "@/lib/cosmetics"
import { ListingCard, type ListingRow } from "@/components/shop/listing-card"

type ShopItem = {
  slug: string
  kind: "BACKGROUND" | "RING" | "TITLE"
  name: string
  rarity: "COMMON" | "RARE" | "LEGENDARY"
  circulation: number
  copies: { id: string; mintNumber: number; escrowed: boolean }[]
}

export function ListingsBoard() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [view, setView] = useState<"board" | "picker" | "price">("board")
  const [copyId, setCopyId] = useState<string | null>(null)
  const [price, setPrice] = useState("")
  const [actingId, setActingId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery(trpc.listing.list.queryOptions())
  // Shared with CollectiblePickerView (same query key) — reused here only to render
  // the chosen copy's inline preview on the price step, no second endpoint.
  const { data: shopData } = useQuery(trpc.shop.getShop.queryOptions())

  function invalidateAll() {
    void qc.invalidateQueries(trpc.listing.list.queryFilter())
    void qc.invalidateQueries(trpc.shop.getShop.queryFilter())
    void qc.invalidateQueries(trpc.user.getMe.queryFilter())
  }

  const create = useMutation(
    trpc.listing.create.mutationOptions({
      onSuccess: () => {
        toast.success("Listed.")
        setView("board")
        setCopyId(null)
        setPrice("")
        invalidateAll()
      },
      onError: (e) => toast.error(e.message || "Couldn't list that item."),
    }),
  )
  const buy = useMutation(
    trpc.listing.buy.mutationOptions({
      onMutate: ({ listingId }) => setActingId(listingId),
      onSuccess: () => {
        toast.success("Bought.")
        invalidateAll()
      },
      // Server refusals ("You don't have enough ZP.", "Someone already bought this.")
      // surface verbatim — no client affordability gate, one money-error vocabulary
      // across the app (matches openBox).
      onError: (e) => toast.error(e.message || "Couldn't buy that item."),
      onSettled: () => setActingId(null),
    }),
  )
  const takeDown = useMutation(
    trpc.listing.takeDown.mutationOptions({
      onMutate: ({ listingId }) => setActingId(listingId),
      onSuccess: () => {
        toast.success("Taken down.")
        invalidateAll()
      },
      onError: (e) => toast.error(e.message || "Couldn't take that down."),
      onSettled: () => setActingId(null),
    }),
  )
  // Note: buying moves ZP into the SELLER's balance, but the seller isn't the one
  // making this request — their own user.getMe cache can't be invalidated from the
  // buyer's client. It refreshes on their next load/query, same as notifyZpChange
  // already relies on for transfer sends.

  if (view === "picker") {
    return (
      <CollectiblePickerView
        value={copyId}
        onConfirm={(id) => { setCopyId(id); setView("price") }}
        onBack={() => setView("board")}
      />
    )
  }

  if (view === "price") {
    const items = (shopData ?? []) as ShopItem[]
    const chosen = items.flatMap((item) => item.copies.map((copy) => ({ item, copy }))).find(
      ({ copy }) => copy.id === copyId,
    )
    const amt = Number(price)
    const valid = Number.isInteger(amt) && amt >= 1

    return (
      <div className="space-y-4 animate-card-rise">
        {chosen && (
          <div className="flex items-center gap-3 rounded-md border p-3">
            {chosen.item.kind === "BACKGROUND" ? (
              <div className={cn("relative isolate h-11 w-11 shrink-0 overflow-hidden rounded-md", RARITY_META[chosen.item.rarity].glowClass)}>
                <CardBackground variant={chosen.item.slug} />
              </div>
            ) : chosen.item.kind === "TITLE" ? (
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted p-1 text-center",
                  RARITY_META[chosen.item.rarity].glowClass,
                )}
              >
                <span className="font-semibold leading-tight" style={{ color: RARITY_META[chosen.item.rarity].hex, fontSize: 10 }}>
                  {chosen.item.name}
                </span>
              </div>
            ) : (
              <div className={cn("shrink-0 rounded-full", RARITY_META[chosen.item.rarity].glowClass)}>
                <AvatarRing variant={chosen.item.slug} size={44}>
                  <Avatar className="h-11 w-11">
                    <AvatarFallback>
                      <UserCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </AvatarFallback>
                  </Avatar>
                </AvatarRing>
              </div>
            )}
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium">{chosen.item.name}</p>
              <p className="font-mono tabular-nums text-[10px] text-muted-foreground">
                #{chosen.copy.mintNumber} / {chosen.item.circulation}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="listing-price" className="text-sm font-medium">Price (ZP)</label>
          <Input
            id="listing-price"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <Button
          className="w-full"
          disabled={!valid || !copyId || create.isPending}
          onClick={() => copyId && create.mutate({ cosmeticPurchaseId: copyId, price: amt })}
        >
          {create.isPending ? "Listing…" : "List it"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setView("picker")}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button className="w-full" onClick={() => setView("picker")}><Tag className="mr-2 h-4 w-4" aria-hidden="true" />Sell an item</Button>

      {isLoading ? (
        <FeedSkeleton count={3} />
      ) : isError ? (
        <div role="alert" className="py-16 text-center animate-card-rise">
          <p className="mb-3 text-sm font-medium">Couldn&apos;t load listings.</p>
          <Button variant="link" size="sm" onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="py-16 text-center animate-card-rise">
          <Store className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mb-2 text-xl font-semibold">Nothing for sale yet.</h2>
          <p className="text-sm text-muted-foreground">
            When members list a collectible, it shows up here. You can be the first — tap Sell an item.
          </p>
        </div>
      ) : (
        <>
          {(() => {
            const mine = data.filter((l) => l.isMine)
            const others = data.filter((l) => !l.isMine)
            return (
              <>
                {mine.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-muted-foreground">Your listings</h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {mine.map((l, i) => (
                        <ListingCard
                          key={l.id}
                          listing={l as ListingRow}
                          i={i}
                          busy={actingId === l.id}
                          onBuy={(id) => buy.mutate({ listingId: id })}
                          onTakeDown={(id) => takeDown.mutate({ listingId: id })}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {others.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-muted-foreground">All listings</h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {others.map((l, i) => (
                        <ListingCard
                          key={l.id}
                          listing={l as ListingRow}
                          i={i}
                          busy={actingId === l.id}
                          onBuy={(id) => buy.mutate({ listingId: id })}
                          onTakeDown={(id) => takeDown.mutate({ listingId: id })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}
