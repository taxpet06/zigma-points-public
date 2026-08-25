"use client"

// ShopTabs — the /shop page body. Two subtabs in the same segmented control
// TransferPanel uses (mb-5 w-full list, equal-width triggers): Lootboxes
// (today's ShopGrid, unchanged) and Listings (the new community board). Two
// triggers fit at 360px unaided — no padding override needed (that's only for
// Exchange's five-trigger list, see 20-UI-SPEC.md §2.2).

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ShopGrid } from "@/components/shop/shop-grid"
import { ListingsBoard } from "@/components/shop/listings-board"

export function ShopTabs() {
  return (
    <Tabs defaultValue="lootboxes">
      <TabsList className="mb-5 w-full">
        <TabsTrigger value="lootboxes" className="flex-1">Lootboxes</TabsTrigger>
        <TabsTrigger value="listings" className="flex-1">Listings</TabsTrigger>
      </TabsList>
      <TabsContent value="lootboxes" className="mt-0">
        <ShopGrid />
      </TabsContent>
      <TabsContent value="listings" className="mt-0">
        <ListingsBoard />
      </TabsContent>
    </Tabs>
  )
}
