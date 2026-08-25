// Casino games registry — the display list for the Casino tab. Slugs are typed against
// the Prisma CasinoGame enum so a missing or misspelled member is a compile error, not a
// runtime surprise. This is a display list only, not a plugin system: each game wires up
// its own three exported functions and router file (RESEARCH § Anti-Patterns).

import type { LucideIcon } from "lucide-react"
import { CircleDot, Bomb, Dice5, CircleDashed, Bird, Plane, Spade } from "lucide-react"
import type { CasinoGame } from "../../../prisma/generated/prisma/client"
import type { ZpRule } from "@/components/game-hub/zp-rules"
import { MIN_BET, MAX_BET, MAX_PAYOUT } from "@/lib/casino/limits"

export const CASINO_GAMES: ReadonlyArray<{
  slug: CasinoGame
  name: string
  hint: string
  icon: LucideIcon
}> = [
  { slug: "PLINKO", name: "Plinko", hint: "Drop and multiply", icon: CircleDot },
  { slug: "MINES", name: "Mines", hint: "Pick your way through", icon: Bomb },
  { slug: "DICE", name: "Dice", hint: "Call the roll", icon: Dice5 },
  { slug: "WHEEL", name: "Wheel", hint: "Spin for a multiplier", icon: CircleDashed },
  { slug: "CHICKEN", name: "Chicken Cross", hint: "Cross while you can", icon: Bird },
  // No cash-out and no in-round decision of any kind (AVIA-01) — the old hint promised a
  // cash-out that this game structurally cannot have (16-RESEARCH § Pitfall 8). Also: our
  // model's CV is 2.27, above Plinko MEDIUM's 1.48, so do not describe this game as low
  // volatility here — that would repeat a claim this repo's own yardstick contradicts
  // (16-CONTEXT § Honesty note).
  { slug: "AVIAMASTERS", name: "Avia Masters", hint: "No cash-out — fly and land", icon: Plane },
  { slug: "BLACKJACK", name: "Blackjack", hint: "Beat the dealer", icon: Spade },
]

// Rules copy derived FROM limits.ts, never restated — the same discipline zp-rules.tsx
// already applies to game-economy.ts, so this card can't drift from what the server enforces.
export const CASINO_RULES: ZpRule[] = [
  { what: "Minimum bet", zp: `${MIN_BET} ZP` },
  { what: "Maximum bet", zp: `${MAX_BET} ZP` },
  { what: "Max payout per round", zp: `${MAX_PAYOUT.toLocaleString()} ZP` },
  // Plinko, Mines, Dice and Wheel are 99% RTP (1% edge); Chicken Cross is 98% RTP (2% edge) per
  // ROADMAP § Phase 15 — its one exception; Avia Masters is 97% RTP (3% edge) per Phase 16 — the
  // milestone's SECOND exception. This is the one rule that isn't a single number, and it must
  // be revisited if another game ever ships at a different edge.
  { what: "House edge", zp: "1% (2% Chicken Cross, 3% Avia Masters)" },
]
