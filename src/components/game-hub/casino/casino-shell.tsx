"use client"

// CasinoShell — the layout contract every casino game inherits (10-UI-SPEC.md
// § CasinoShell). Renders INSIDE the existing GameDialog; no new route, no new
// dialog. Three regions in a column: a scrollable board, a permanently-mounted
// outcome slot, and a sticky thumb-zone control bar.

import * as React from "react"
import { Lock } from "lucide-react"
import { MAX_PAYOUT } from "@/lib/casino/limits"
import { cn } from "@/lib/utils"

export type CasinoOutcome = {
  /** Signed net ZP change for the round — NOT gross payout. A 0.20x bucket on
   *  a 100 ZP bet is `net: -80`, not `net: 20`. */
  net: number
  staked: number
  multiplier: number
  /** True when payoutFor() clamped this round at MAX_PAYOUT. */
  capped?: boolean
}

function formatNet(net: number): string {
  // U+2212 MINUS SIGN (not a hyphen) per 10-UI-SPEC.md — aligns with tabular-nums.
  const sign = net < 0 ? "−" : "+"
  return `${sign}${Math.abs(net).toLocaleString()} ZP`
}

function secondaryLine(o: CasinoOutcome): string {
  const base = `${o.staked} ZP staked · ${o.multiplier.toFixed(2)}×`
  return o.capped ? `${base} · capped at ${MAX_PAYOUT.toLocaleString()} ZP max payout` : base
}

export function CasinoShell({
  board,
  outcome,
  balance,
  controls,
  panels,
  className,
}: {
  board: React.ReactNode
  outcome: CasinoOutcome | null
  balance: number
  controls: React.ReactNode
  panels?: React.ReactNode
  className?: string
}) {
  return (
    // game-motion opts this whole subtree out of the global prefers-reduced-motion
    // freeze in globals.css. The animation IS the game — and iOS Low Power Mode and
    // Android battery saver both report reduced-motion, so without this the games
    // look broken on a phone that is merely low on battery.
    <div className={cn("game-motion flex flex-col", className)}>
      {/* Board region — games fill this. Deliberately NOT its own scroll container.
          It used to be `flex-1 overflow-y-auto`, but this shell has no definite height
          (DialogContent is the sized, scrolling ancestor), so `flex-1` resolved against
          content and the region never actually scrolled — it just grew, and the sticky
          bar below ended up overlapping the last row of the board. One scroller, not two:
          the board flows at its natural height and DialogContent does the scrolling.
          Still never horizontally scrollable — width-constrained via min-w-0. */}
      <div className="w-full min-w-0">{board}</div>

      {/* Outcome slot — PERMANENTLY MOUNTED at a fixed h-16. It never mounts or
          unmounts; only its content changes. That single decision removes all
          settle-time layout shift and is the highest-value line in this file. */}
      <div aria-live="polite" className={cn("h-16 shrink-0", !outcome && "opacity-60")}>
        {outcome && (
          <div
            key={`${outcome.net}-${outcome.staked}-${outcome.multiplier}-${outcome.capped ?? false}`}
            className={cn(
              "flex h-full flex-col justify-center gap-0.5",
              // No motion-reduce: variant here, deliberately. `.game-motion` opts this subtree out
              // of the OS reduced-motion setting (globals.css) because iOS Low Power Mode and
              // Android battery saver both report `reduce` — a Tailwind motion-reduce: utility
              // would re-freeze the settle beat on a phone that is merely low on battery.
              "animate-in fade-in-0 slide-in-from-bottom-1 duration-[var(--duration-settle)] ease-out",
            )}
          >
            <p
              className={cn(
                "font-mono text-[20px] font-semibold leading-[1.2] tabular-nums",
                outcome.net < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {formatNet(outcome.net)}
            </p>
            <p className="flex items-center gap-1 font-mono text-sm text-muted-foreground">
              {outcome.capped && <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              {secondaryLine(outcome)}
            </p>
          </div>
        )}
      </div>

      {panels && <div className="mt-8 flex flex-col gap-6">{panels}</div>}

      {/* Sticky control bar — LAST element in the scroll container, so it is
          reachable without scrolling at any content height. */}
      <div className="sticky bottom-0 z-10 border-t bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-sm">
        {/* Balance is repeated here deliberately: when GameDialog is maximized it
            is inset-0 and covers the app header's ZP badge — without this line the
            user bets blind. Snaps on change, no count-up tween. */}
        {/* text-xs + nowrap, not text-sm: at 14px these two strings total ~286px against
            ~296px of usable width at a 360px viewport, so any balance over three digits
            wrapped the row onto two lines and pushed the controls down. */}
        <div className="flex items-baseline justify-between gap-2 font-mono text-xs tabular-nums text-muted-foreground">
          <span className="whitespace-nowrap">
            Balance <span className="text-foreground">{balance.toLocaleString()}</span> ZP
          </span>
          <span className="whitespace-nowrap">Max payout {MAX_PAYOUT.toLocaleString()} ZP</span>
        </div>
        <div className="mt-3">{controls}</div>
      </div>
    </div>
  )
}
