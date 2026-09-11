"use client"

// ShopGrid — the Lootboxes sub-tab. One LootboxCard per kind (Backgrounds, Rings,
// Titles) for the SELECTED TERM. The individual cosmetics are no longer shown or
// bought here — lootboxes are the only acquisition path, and owned items are
// managed/equipped from the profile ("Your cosmetics"). Opening a box is handled by
// the shared LootboxModal (preview carousel + chest-open reveal), which owns the
// openBox + equip money path; this grid only tracks which box's modal is open and
// runs the two query invalidations (shop.getShop, user.getMe) on success.
//
// Terms: the sections are derived from the selected term rather than hardcoded, since
// a term's name IS its collection key (lootboxesForTerm in lib/cosmetics). The picker
// defaults to the current term, and only the current term's boxes can be opened —
// past terms stay fully browsable (contents, odds, circulation) but read-only, so a
// retired collection can be understood without any new copies of it being minted.
// shop.openBox enforces that same rule server-side; this is the affordance, not the
// control. Items from a closed term keep listing and trading normally — nothing here
// touches the Listings sub-tab.

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { LootboxCard } from "@/components/shop/lootbox-card"
import { LootboxModal } from "@/components/shop/lootbox-modal"
import { TermSelect, useTerms } from "@/components/term/term-select"
import { lootboxesForTerm, type CosmeticKind } from "@/lib/cosmetics"

// Fixed display order, so the page doesn't reshuffle between terms whose catalogs
// happen to be declared in a different order.
const KIND_ORDER: { kind: CosmeticKind; heading: string }[] = [
  { kind: "BACKGROUND", heading: "Backgrounds" },
  { kind: "RING", heading: "Rings" },
  { kind: "TITLE", heading: "Titles" },
]

export function ShopGrid() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [openBoxId, setOpenBoxId] = useState<string | null>(null)
  const [termId, setTermId] = useState<string | null>(null)

  const { terms, currentTermId, buyableTermId, isLoading } = useTerms()
  const selectedTermId = termId ?? currentTermId
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null
  // Browse-only unless this is the term the SERVER will mint from. buyableTermId is
  // shop.openBox's own gate value, so the two cannot drift; comparing against
  // currentTermId instead meant that once a term ended the shop still showed live Open
  // buttons on its boxes, and every click failed with FORBIDDEN.
  const readOnly = selectedTermId !== buyableTermId

  const boxes = selectedTerm ? lootboxesForTerm(selectedTerm.name) : []

  return (
    <>
      <div className="mb-5 flex flex-col gap-2">
        <TermSelect
          value={selectedTermId}
          onChange={setTermId}
          ariaLabel="Lootbox term"
          className="w-full"
        />
        {/* Only worth saying when there is something to look inside — on a term with no
            collection the empty state below already explains everything. */}
        {readOnly && boxes.length > 0 ? (
          <p
            role="status"
            className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground text-pretty ring-1 ring-border"
          >
            <span className="font-medium text-foreground">{selectedTerm?.name} has ended.</span>{" "}
            You can look inside these boxes, but only the current term&rsquo;s can be opened.
            Items from past terms still buy, sell and trade as normal.
          </p>
        ) : null}
      </div>

      {isLoading ? (
        // Skeleton, not a spinner: three section-shaped placeholders so the page
        // doesn't jump when the terms land.
        <div className="flex flex-col gap-8">
          {KIND_ORDER.map(({ kind }) => (
            <div key={kind} className="flex flex-col items-center gap-3">
              <div className="h-6 w-32 animate-pulse self-start rounded bg-muted" />
              <div className="h-[212px] w-[220px] animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      ) : boxes.length === 0 ? (
        <div className="py-16 text-center">
          <h2 className="mb-2 text-xl font-semibold">No lootboxes this term.</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {selectedTerm
              ? `${selectedTerm.name} has no collection of its own.`
              : "No term has started yet."}{" "}
            Pick another term to browse its boxes.
          </p>
        </div>
      ) : (
        KIND_ORDER.map(({ kind, heading }, i) => {
          const box = boxes.find((b) => b.kind === kind)
          if (!box) return null
          return (
            <section key={kind} className={i === 0 ? undefined : "mt-8"}>
              <h2 className="mb-3 text-lg font-semibold">{heading}</h2>
              <LootboxCard boxId={box.id} kind={kind} readOnly={readOnly} onOpen={setOpenBoxId} />
            </section>
          )
        })
      )}

      <LootboxModal
        boxId={openBoxId}
        readOnly={readOnly}
        onClose={() => setOpenBoxId(null)}
        onSuccess={() => {
          // Balance + owned/equipped state changed — keep the profile inventory
          // and the header ZP balance fresh even though the shop no longer shows them.
          void qc.invalidateQueries(trpc.shop.getShop.queryFilter())
          void qc.invalidateQueries(trpc.user.getMe.queryFilter())
        }}
      />
    </>
  )
}
