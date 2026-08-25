"use client"

// ShopGrid — the /shop page body. Two sections (Backgrounds, Rings), each a single
// LootboxCard shaped like the collectibles it replaces. The individual cosmetics
// are no longer shown or bought here — lootboxes are the only acquisition path, and
// owned items are managed/equipped from the profile ("Your cosmetics"). Opening a
// box is handled by the shared LootboxModal (preview carousel + chest-open reveal),
// which owns the openBox + equip money path; this grid only tracks which box's modal
// is open and runs the two query invalidations (shop.getShop, user.getMe) on success.

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { LootboxCard } from "@/components/shop/lootbox-card"
import { LootboxModal } from "@/components/shop/lootbox-modal"

export function ShopGrid() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [openBoxId, setOpenBoxId] = useState<string | null>(null)

  return (
    <>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Backgrounds</h2>
        <LootboxCard boxId="26x-background" kind="BACKGROUND" onOpen={setOpenBoxId} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Rings</h2>
        <LootboxCard boxId="26x-ring" kind="RING" onOpen={setOpenBoxId} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Titles</h2>
        <LootboxCard boxId="26x-title" kind="TITLE" onOpen={setOpenBoxId} />
      </section>

      <LootboxModal
        boxId={openBoxId}
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
