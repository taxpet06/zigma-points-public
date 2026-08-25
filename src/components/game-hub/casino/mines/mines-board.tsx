"use client"

// MinesBoard — the 5x5 tile grid (12-UI-SPEC.md § Board Contract). Presentational only: it
// derives every tile's state from props and makes no tRPC call. It imports nothing from
// fairness.ts or mines.ts (T-12-12) — the board is structurally incapable of rendering a
// mid-round answer because `mines` (the end-of-round board) is the only source it has, and the
// router never hands that prop a value until the round is SETTLED.

import * as React from "react"
import { Bomb, Gem } from "lucide-react"
import { cn } from "@/lib/utils"

const TILE_BASE =
  "mines-tile aspect-square min-h-11 rounded-md flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"

type TileState = "face-down" | "gem" | "hit" | "mine" | "unpicked-gem"

// Stagger for the end-of-round board reveal. Derived from grid geometry ONLY — never from what
// a tile hides — so it stays inert with respect to T-12-12: on a bust it ripples outward from
// the tile the player actually tapped (already public), on a cash-out it runs in index order.
function settleDelayMs(i: number, hitTile: number | null): number {
  if (hitTile === null) return i * 28
  const dr = Math.abs(Math.floor(i / 5) - Math.floor(hitTile / 5))
  const dc = Math.abs((i % 5) - (hitTile % 5))
  return (dr + dc) * 45 // 0–360ms across the board
}

// Row/column, 1-indexed — a 5x5 board read by ear needs spatial coordinates, not a linear
// "Tile 8" (12-UI-SPEC.md § Accessibility).
function tileLabel(row: number, col: number, state: TileState): string {
  const pos = `Row ${row}, column ${col}`
  switch (state) {
    case "gem":
      return `${pos}, gem`
    case "hit":
      return `${pos}, mine — you hit this one`
    case "mine":
      return `${pos}, mine`
    case "unpicked-gem":
      return `${pos}, gem, not picked`
    default:
      return pos
  }
}

export function MinesBoard({
  revealed,
  mines,
  hitTile,
  roundActive,
  revealPending,
  pendingTile,
  onReveal,
}: {
  revealed: number[]
  /** The end-of-round board — null while the round is live. */
  mines: number[] | null
  hitTile: number | null
  roundActive: boolean
  /** A reveal is in flight for `pendingTile` — locks the other 24 tiles with no visual change
   *  (12-UI-SPEC state 4: dimming every tap for a 150-300ms round trip is a strobe, not a state). */
  revealPending: boolean
  pendingTile: number | null
  onReveal: (tile: number) => void
}) {
  // Cash-out — the round settled with no mine hit. The tiles the player banked get their own
  // celebration beat; on a bust they don't (the loss moment belongs to the hit tile).
  const bankedOut = mines !== null && hitTile === null

  return (
    <div className="mines-grid grid grid-cols-5 gap-2">
      {/* Keyframes kept LOCAL to this component (chicken-road.tsx's precedent) rather than added
          to globals.css. Every rule below animates transform/opacity only, and none of it is
          gated on prefers-reduced-motion: CasinoShell's `.game-motion` root already exempts this
          subtree from the global freeze, and the freeze is what iOS Low Power Mode / Android
          battery saver trip. The tile flip IS the game — it must always run. */}
      <style>{`
        .mines-grid { perspective: 600px; }
        .mines-tile { transition: transform 100ms cubic-bezier(0.23, 1, 0.32, 1); }
        .mines-tile:active:not(:disabled) { transform: scale(0.97); }

        /* Safe reveal — the core beat, fired many times a round, so it stays at 150ms. */
        @keyframes mines-reveal {
          0%   { transform: rotateX(-70deg) scale(0.88); opacity: 0.4; }
          55%  { transform: rotateX(0deg) scale(1.05); opacity: 1; }
          100% { transform: rotateX(0deg) scale(1); opacity: 1; }
        }
        .mines-reveal { animation: mines-reveal 150ms cubic-bezier(0.23, 1, 0.32, 1) backwards; }

        /* The loss moment: one punch on the tapped tile. No shake, no board-wide flash — the
           fill is already destructive at frame 0 (12-UI-SPEC § The Loss Moment, step 1), this
           only gives it weight. */
        @keyframes mines-hit {
          0%   { transform: scale(1); }
          22%  { transform: scale(1.12); }
          52%  { transform: scale(0.96); }
          100% { transform: scale(1); }
        }
        .mines-hit { animation: mines-hit 260ms cubic-bezier(0.23, 1, 0.32, 1) backwards; }

        /* End-of-round board, staggered via --d so the 24 other tiles arrive as a ripple
           instead of a single 25-tile snap. */
        @keyframes mines-settle {
          0%   { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .mines-settle {
          animation: mines-settle var(--duration-settle) cubic-bezier(0.23, 1, 0.32, 1) backwards;
          animation-delay: var(--d, 0ms);
        }

        /* Cash out — the banked gems acknowledge the collect, one after another. */
        @keyframes mines-bank {
          0%   { transform: scale(1); }
          35%  { transform: scale(1.16); }
          100% { transform: scale(1); }
        }
        .mines-bank {
          animation: mines-bank 340ms cubic-bezier(0.23, 1, 0.32, 1) backwards;
          animation-delay: var(--d, 0ms);
        }
      `}</style>

      {Array.from({ length: 25 }, (_, i) => {
        const row = Math.floor(i / 5) + 1
        const col = (i % 5) + 1
        const isHit = hitTile === i
        const isSafeGem = revealed.includes(i)
        // mines is null while live, so this is naturally false until the round settles — no
        // separate "settled" flag needed to gate it.
        const isUnhitMine = !isHit && !isSafeGem && (mines?.includes(i) ?? false)
        const isUnpickedGem = mines !== null && !isSafeGem && !isHit && !isUnhitMine
        const isCommitted = revealPending && pendingTile === i

        let label: string
        let fill: string
        let glyph: React.ReactNode = null
        let delay: number | null = null

        if (isHit) {
          // The tapped tile carries the hit-mine treatment at 0ms — the punch below scales it,
          // it never fades in (12-UI-SPEC § The Loss Moment, step 1).
          label = tileLabel(row, col, "hit")
          fill = "bg-destructive/15 ring-2 ring-destructive mines-hit"
          glyph = <Bomb className="h-6 w-6 text-destructive" aria-hidden="true" />
        } else if (isSafeGem) {
          // Safe reveal — feedback, not result: 150ms (12-UI-SPEC's `duration-micro`), the beat
          // that repeats most often in a round, so it stays the fastest one here. On a cash-out
          // it then takes the banking pulse, ordered by when the player revealed it.
          label = tileLabel(row, col, "gem")
          fill = "bg-emerald-600/15 dark:bg-emerald-400/15 " + (bankedOut ? "mines-bank" : "mines-reveal")
          if (bankedOut) delay = Math.max(0, revealed.indexOf(i)) * 60
          glyph = <Gem className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        } else if (isUnhitMine) {
          // End-of-round reveal — result, not feedback: the shared --duration-settle beat, but
          // rippling out from the tapped tile rather than all 24 landing on the same frame.
          label = tileLabel(row, col, "mine")
          fill = "bg-muted mines-settle"
          delay = settleDelayMs(i, hitTile)
          glyph = <Bomb className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        } else if (isUnpickedGem) {
          label = tileLabel(row, col, "unpicked-gem")
          fill = "bg-muted mines-settle"
          delay = settleDelayMs(i, hitTile)
          glyph = <Gem className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        } else if (isCommitted) {
          label = tileLabel(row, col, "face-down")
          fill = "bg-muted-foreground/15"
        } else {
          // Live face-down, locked face-down (another tile's reveal in flight) and the idle
          // board are all this same fill — state 1's "full opacity, not dimmed" ruling means
          // there is nothing here to differentiate; `disabled` alone makes the idle board inert.
          label = tileLabel(row, col, "face-down")
          fill = "bg-muted"
        }

        return (
          <button
            type="button"
            key={i}
            disabled={!roundActive || revealPending || isSafeGem || mines !== null}
            aria-label={label}
            onClick={() => onReveal(i)}
            className={cn(TILE_BASE, fill)}
            style={delay === null ? undefined : ({ "--d": `${delay}ms` } as React.CSSProperties)}
          >
            {glyph}
          </button>
        )
      })}
    </div>
  )
}
