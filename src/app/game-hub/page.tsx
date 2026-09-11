// /game-hub — games users can play to earn ZP (server component).
//
// Top + bottom bars come from the root layout, so they stay visible here for free.
// The Casual/Competitive split and every game card live in <GameHubTabs /> (client) —
// add each new game as another card in the tab it belongs to.

import { requireSession } from "@/lib/auth-helpers"
import { GameHubTabs } from "@/components/game-hub/game-hub-tabs"

export default async function GameHubPage() {
  await requireSession() // authenticated users only — same gate as /tasks

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold mb-1">Game Hub</h1>
      <p className="mb-6 text-sm text-muted-foreground">Play games to earn ZP.</p>

      <GameHubTabs />
    </main>
  )
}
