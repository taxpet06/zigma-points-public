"use client"

// ProfileCosmetics — the owner-only Inventory tab on the profile page.
//
// Three nested <details> levels, all closed by default, so a big collection is a
// few short rows instead of a wall of tiles:
//
//   26X Collection            29/30
//     Backgrounds             10/10
//       Aurora Drift  ×3  [Equip]     <- one row per ITEM, not per copy
//         #7 / 12                     <- the copies, only when you open the item
//
// Every fold shows owned/total for what it contains: owned counts DISTINCT items
// (50 copies of one title is still 1), total is the catalog size for that scope —
// so an admin, whose virtual The Zigma has no catalog entry, reads 11/10.
//
// Native <details>, matching the casino's bet-history/fairness-panel disclosures,
// not a new dependency. Equip stays a per-slug action (the server stores a slug),
// so its button lives on the item row; the copy rows below it only carry the
// circulation serial and escrow state.
//
// router.refresh() re-runs the server profile component so the card/avatar above
// updates immediately.

import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { CardBackground } from "@/components/cosmetics/card-background"
import { UserAvatar } from "@/components/cosmetics/user-avatar"
import { TitleChip } from "@/components/cosmetics/title-chip"
import { Button } from "@/components/ui/button"
import { ADMIN_TITLE, RARITY_META, collectionProgress } from "@/lib/cosmetics"
import { cn } from "@/lib/utils"
import "./cosmetics.css"

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

const KINDS = [
  { kind: "BACKGROUND", label: "Backgrounds" },
  { kind: "RING", label: "Rings" },
  { kind: "TITLE", label: "Titles" },
] as const

/** One disclosure row. The chevron must stay a direct child of <summary> —
 *  cosmetics.css rotates it with `details[open] > summary > .fold-chevron`,
 *  a child chain Tailwind's descendant-based group-open can't express without
 *  every open ancestor flipping its descendants' chevrons too. */
function Fold({
  label,
  meta,
  className,
  children,
}: {
  label: React.ReactNode
  meta?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <details>
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 hover:bg-muted/50 [&::-webkit-details-marker]:hidden",
          className,
        )}
      >
        <ChevronDown className="fold-chevron h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {label}
        {meta}
      </summary>
      {children}
    </details>
  )
}

function Count({ owned, total }: { owned: number; total: number }) {
  return (
    <span className="ml-auto shrink-0 tabular-nums text-xs font-normal text-muted-foreground">
      {owned}/{total}
    </span>
  )
}

export function ProfileCosmetics() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const router = useRouter()
  const { data, isLoading } = useQuery(trpc.shop.getShop.queryOptions())
  const { data: me } = useQuery(trpc.user.getMe.queryOptions())
  const isAdmin = me?.role === "ADMIN"

  const equip = useMutation(
    trpc.shop.equip.mutationOptions({
      onError: (e) => toast.error(e.message || "Couldn't update equip state."),
      onSuccess: () => {
        void qc.invalidateQueries(trpc.shop.getShop.queryFilter())
        void qc.invalidateQueries(trpc.user.getMe.queryFilter())
        router.refresh() // re-render the server profile card with the new equip
      },
    }),
  )

  const items = (data ?? []) as ShopItem[]
  const owned = items.filter((c) => c.owned)

  if (isLoading) return null

  if (owned.length === 0 && !isAdmin) {
    return (
      <section className="rounded-lg border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">
          You haven&apos;t unboxed any cosmetics yet.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-3">
          <Link href="/shop">Visit the Shop</Link>
        </Button>
      </section>
    )
  }

  // Every catalog collection, not just the ones with something in them — the
  // x/y counts are the point, and 0/30 is a legitimate thing to read.
  const collections = [...new Set(items.map((c) => c.collection))]

  // Distinct owned slugs — the admin's virtual title included, which is what makes
  // collectionProgress read 11/10 for a complete admin (it has no catalog row).
  const ownedSlugs = new Set(owned.map((c) => c.slug))
  if (isAdmin) ownedSlugs.add(ADMIN_TITLE.slug)

  function toggle(c: ShopItem) {
    equip.mutate({ slug: c.equipped ? null : c.slug, kind: c.kind })
  }

  function preview(c: ShopItem) {
    if (c.kind === "BACKGROUND") {
      return (
        <div className="relative isolate h-9 w-14 shrink-0 overflow-hidden rounded-md">
          <CardBackground variant={c.slug} />
        </div>
      )
    }
    if (c.kind === "RING") return <UserAvatar ring={c.slug} size={36} />
    // A title's whole appearance IS its text, so the chip stands in for both the
    // swatch and the name — no second copy of the name next to it.
    return <TitleChip slug={c.slug} size="sm" />
  }

  function itemRow(c: ShopItem) {
    const equippable = c.copies.some((copy) => !copy.escrowed)
    return (
      <Fold
        key={c.slug}
        className="ml-8 text-sm"
        label={
          <>
            {preview(c)}
            <span className="min-w-0 truncate">
              {c.kind !== "TITLE" && <span className="font-medium">{c.name}</span>}
              <span
                className="ml-2 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: RARITY_META[c.rarity].hex }}
              >
                {RARITY_META[c.rarity].label}
              </span>
            </span>
          </>
        }
        meta={
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="tabular-nums text-xs text-muted-foreground">×{c.copies.length}</span>
            <Button
              size="sm"
              variant={c.equipped ? "secondary" : "outline"}
              disabled={equip.isPending || (!equippable && !c.equipped)}
              title={!equippable && !c.equipped ? "Every copy is listed or offered." : undefined}
              // preventDefault, not stopPropagation: toggling <details> is the
              // click's DEFAULT action on <summary>, so equipping must cancel it
              // or the row folds open every time you equip.
              onClick={(e) => {
                e.preventDefault()
                toggle(c)
              }}
              className="min-h-11"
            >
              {c.equipped ? "Unequip" : "Equip"}
            </Button>
          </span>
        }
      >
        {/* UI-SPEC §5.1 — an escrowed copy stays visible, dimmed, with a
            non-interactive Listed/Offered pill. It is the user's only breadcrumb
            back to a listing/offer they forgot about; never filter them out. */}
        <ul className="ml-16 mr-2 mb-1 space-y-1">
          {c.copies.map((copy) => (
            <li
              key={copy.id}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                copy.escrowed && "opacity-60",
              )}
            >
              <span
                className="tabular-nums text-muted-foreground"
                title={`Copy ${copy.mintNumber} of ${c.circulation} in circulation`}
              >
                #{copy.mintNumber} / {c.circulation}
              </span>
              {copy.escrowed && (
                <span className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {copy.escrowState === "LISTED" ? "Listed" : "Offered"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Fold>
    )
  }

  // The Zigma — a virtual admin-only entitlement with no CosmeticPurchase row
  // ever (ADMT-02), so it has no copies and nothing to expand: a plain row, not
  // a Fold. The server (shop.equip, T-22-06) is the real authorization boundary;
  // this render is an affordance only, gated on role from user.getMe (T-22-30).
  function adminRow() {
    const equipped = me?.equippedTitle === ADMIN_TITLE.slug
    return (
      <div className="ml-8 flex min-h-11 items-center gap-2 rounded-md px-2 text-sm">
        <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        <TitleChip slug={ADMIN_TITLE.slug} size="sm" />
        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Admin
        </span>
        <Button
          size="sm"
          variant={equipped ? "secondary" : "outline"}
          disabled={equip.isPending}
          onClick={() => equip.mutate({ slug: equipped ? null : ADMIN_TITLE.slug, kind: "TITLE" })}
          className="ml-auto min-h-11"
        >
          {equipped ? "Unequip" : "Equip"}
        </Button>
      </div>
    )
  }

  return (
    <section className="rounded-lg border bg-card p-2">
      {collections.map((collection) => (
        <Fold
          key={collection}
          className="text-base font-semibold"
          label={<span>{collection} Collection</span>}
          meta={<Count {...collectionProgress(ownedSlugs, collection)} />}
        >
          {KINDS.map(({ kind, label }) => {
            const kindItems = owned.filter((c) => c.collection === collection && c.kind === kind)
            const showAdmin =
              isAdmin && collection === ADMIN_TITLE.collection && kind === ADMIN_TITLE.kind
            return (
              <Fold
                key={kind}
                className="ml-4 text-sm font-medium"
                label={<span>{label}</span>}
                meta={<Count {...collectionProgress(ownedSlugs, collection, kind)} />}
              >
                {kindItems.length === 0 && !showAdmin ? (
                  <p className="ml-16 py-1 text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <>
                    {kindItems.map(itemRow)}
                    {showAdmin && adminRow()}
                  </>
                )}
              </Fold>
            )
          })}
        </Fold>
      ))}
    </section>
  )
}
