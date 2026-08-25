// /shop — cosmetics store (server component).
//
// Mirrors game-hub's shell: requireSession gate + max-w-2xl main. All the
// interactivity (subtabs, previews, buy/equip, listings) lives in ShopTabs.

import { requireSession } from "@/lib/auth-helpers"
import { ShopTabs } from "@/components/shop/shop-tabs"

export default async function ShopPage() {
  await requireSession() // authenticated users only — same gate as /game-hub

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-1">Shop</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Open boxes for new cosmetics, or buy them from other members.
      </p>

      <ShopTabs />
    </main>
  )
}
