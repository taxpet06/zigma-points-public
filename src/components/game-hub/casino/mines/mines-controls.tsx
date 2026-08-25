"use client"

// MinesReadout + MinesControls (12-UI-SPEC.md § Readout Contract, § Mine-Count Selector,
// § "Pick a tile for me", § Cap disclosure). Two exports in one file because the grid sits
// between them in the layout — the readout renders directly above the board, the controls
// directly below it. Fully controlled and presentational: no state owned here, no tRPC call.

import * as React from "react"
import { Lock } from "lucide-react"
import { presetButton } from "@/components/game-hub/casino/bet-input"
import { minesMultiplier, MINES_MAX, MINES_MIN, MINES_TILES } from "@/lib/casino/mines"
import { MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"
import { cn } from "@/lib/utils"

const MINE_PRESETS = [1, 3, 5, 10, 24] as const

function formatNet(net: number): string {
  const sign = net < 0 ? "−" : "+" // U+2212, matching CasinoShell's outcome slot
  return `${sign}${Math.abs(net)} ZP`
}

/** Tweens a number toward `target` so the Current multiplier ticks up on each reveal instead of
 *  snapping. rAF, no dependency, and it always lands EXACTLY on `target` on the final frame —
 *  the figure is money, so it may look approximate in flight but never at rest. 180ms is under
 *  the reveal-to-reveal cadence, so it is settled long before the next tap can resolve. */
function useTick(target: number | null): number | null {
  const [value, setValue] = React.useState(target)
  // The value currently on screen — so a reveal landing mid-tween retargets from where the eye
  // is, never from the previous target.
  const shownRef = React.useRef(target)

  React.useEffect(() => {
    const from = shownRef.current
    if (target === null || from === null || from === target) {
      shownRef.current = target
      queueMicrotask(() => setValue(target))
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 180)
      // ease-out cubic — fast off the mark, matching every other reveal-time beat in Mines.
      const next = t === 1 ? target : from + (target - from) * (1 - Math.pow(1 - t, 3))
      shownRef.current = next
      setValue(next)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return value
}

export function MinesReadout({
  mineCount,
  bet,
  k,
  currentMultiplier,
  nextMultiplier,
}: {
  mineCount: number
  bet: number
  /** Gems revealed so far this round. */
  k: number
  currentMultiplier: number | null
  nextMultiplier: number | null
}) {
  const showCurrent = k >= 1 && currentMultiplier !== null
  // Ticks toward the new multiplier on every reveal rather than snapping. The net ZP figure is
  // derived from the SAME tweened number, so the two never disagree mid-flight, and both land
  // on the exact server figure on the final frame.
  const tickedMultiplier = useTick(currentMultiplier) ?? currentMultiplier

  return (
    <div className="flex min-h-5 flex-wrap items-start justify-between gap-x-4 text-sm" aria-live="polite">
      <span>
        {showCurrent ? (
          <>
            <span className="text-muted-foreground">Current </span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {(tickedMultiplier ?? currentMultiplier).toFixed(2)}×
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {formatNet(payoutFor(bet, tickedMultiplier ?? currentMultiplier) - bet)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{mineCount === 1 ? "1 mine" : `${mineCount} mines`}</span>
        )}
      </span>

      <span>
        {nextMultiplier === null ? (
          <span className="text-muted-foreground">Next —</span>
        ) : (
          <>
            <span className="text-muted-foreground">Next </span>
            <span className="font-mono tabular-nums text-muted-foreground">{nextMultiplier.toFixed(2)}×</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatNet(payoutFor(bet, nextMultiplier) - bet)}
            </span>
          </>
        )}
      </span>
    </div>
  )
}

export function MinesControls({
  mineCount,
  onMineCountChange,
  bet,
  locked,
  roundActive,
  revealPending,
  onPickRandom,
}: {
  mineCount: number
  onMineCountChange: (mines: number) => void
  bet: number
  /** An ACTIVE round exists — whole selector block locks (mirrors BetInput/PlinkoControls). */
  locked: boolean
  roundActive: boolean
  revealPending: boolean
  onPickRandom: () => void
}) {
  const atMin = mineCount === MINES_MIN
  const atMax = mineCount === MINES_MAX
  // Interpolated from MAX_PAYOUT — only the fixed "10,000 ZP cap" phrasing below is literal copy.
  const showCap = Math.floor(bet * minesMultiplier(mineCount, MINES_TILES - mineCount)) > MAX_PAYOUT

  return (
    <div>
      {/* Only while a round is ACTIVE, and it sits below the grid — mounting it never moves
          the grid (12-UI-SPEC § "Pick a tile for me"). */}
      {roundActive && (
        <button
          type="button"
          disabled={revealPending}
          onClick={onPickRandom}
          className="mt-3 min-h-11 w-full rounded-md border border-input bg-background text-sm font-medium transition-transform duration-100 ease-out active:scale-[0.97] hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Pick a tile for me
        </button>
      )}

      <div className={cn("mt-3 space-y-3", locked && "pointer-events-none opacity-50")} aria-disabled={locked || undefined}>
        <div className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-sm font-medium">Mines</span>
          <div className="grid flex-1 grid-cols-[44px_1fr_44px] gap-2">
            <button
              type="button"
              disabled={atMin}
              aria-disabled={atMin}
              aria-label="Fewer mines"
              onClick={() => onMineCountChange(mineCount - 1)}
              className={presetButton}
            >
              −
            </button>
            <span
              className="flex min-h-11 items-center justify-center font-mono text-sm tabular-nums"
              aria-live="off"
            >
              {mineCount}
            </span>
            <button
              type="button"
              disabled={atMax}
              aria-disabled={atMax}
              aria-label="More mines"
              onClick={() => onMineCountChange(mineCount + 1)}
              className={presetButton}
            >
              +
            </button>
          </div>
        </div>

        {/* The board's own rhythm, verbatim — grid grid-cols-5 gap-2 lands five chips directly
            under five columns of tiles on the same 8px rhythm (12-UI-SPEC § Rhythm). */}
        <div className="grid grid-cols-5 gap-2">
          {MINE_PRESETS.map((n) => {
            const selected = n === mineCount
            return (
              <button
                key={n}
                type="button"
                aria-pressed={selected}
                aria-label={n === 1 ? "1 mine" : `${n} mines`}
                onClick={() => onMineCountChange(n)}
                className={cn(presetButton, selected && "bg-muted font-semibold")}
              >
                {n}
              </button>
            )
          })}
        </div>
      </div>

      {/* Fixed h-5, empty string when unlocked — the same anti-shift discipline as
          PlinkoControls/BetInput. Deliberately its own sentence rather than BetInput's locked
          copy, which is already rendered elsewhere in the layout. */}
      <p className="h-5 text-sm text-muted-foreground">{locked ? "Locked until the round ends." : ""}</p>

      {/* Always mounted min-h-5 + items-start, never h-5 + items-center — the 11-08 UAT wrap
          bug. A cap is information, not an outcome: no colour. */}
      <p className="flex min-h-5 items-start gap-1 text-sm text-muted-foreground">
        {showCap && (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              At <span className="font-mono tabular-nums">{bet}</span> ZP, multipliers above{" "}
              <span className="font-mono tabular-nums">{Math.floor(MAX_PAYOUT / bet)}×</span> pay the{" "}
              {MAX_PAYOUT.toLocaleString()} ZP cap.
            </span>
          </>
        )}
      </p>
    </div>
  )
}
