"use client"

// PUBLIC-MIRROR STUB. The real implementation is private (see docs/public-mirror.md).
// This file's exports must track src/private-games/jj/jj.tsx's public API.
//
// Renders the same GameCard every other hub tile renders, so the public build's grid looks
// intentional rather than broken. Disabled + no dialog: there is nothing to open.

import { Egg } from "lucide-react"
import { GameCard } from "@/components/game-hub/game-card"

export function Jj({ index = 0 }: { index?: number }) {
  return (
    <GameCard
      icon={Egg}
      name="JJ"
      hint="This game isn't publicly available."
      ariaLabel="JJ — this game isn't publicly available."
      index={index}
      disabled
      onClick={() => {}}
    />
  )
}
