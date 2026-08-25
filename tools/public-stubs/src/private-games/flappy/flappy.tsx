"use client"

// PUBLIC-MIRROR STUB. The real implementation is private (see docs/public-mirror.md).
// This file's exports must track src/private-games/flappy/flappy.tsx's public API.
//
// Renders the same GameCard every other hub tile renders, so the public build's grid looks
// intentional rather than broken. Disabled + no dialog: there is nothing to open.

import { Bird } from "lucide-react"
import { GameCard } from "@/components/game-hub/game-card"

export function Flappy({ index = 0 }: { index?: number }) {
  return (
    <GameCard
      icon={Bird}
      name="Flappy ZP"
      hint="This game isn't publicly available."
      ariaLabel="Flappy ZP — this game isn't publicly available."
      index={index}
      disabled
      onClick={() => {}}
    />
  )
}
