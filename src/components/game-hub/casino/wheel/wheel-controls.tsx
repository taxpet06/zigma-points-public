"use client"

// WheelControls — segments stepper, risk radiogroup, and the distinct-multiplier legend
// (14-RESEARCH.md § Pattern 2, § Pattern 5). Presentational only: owns no bet state beyond the
// risk radiogroup's roving focus, and makes no tRPC call.
//
// The legend is what actually satisfies WHEL-01 — the ring (wheel-face.tsx) is colour and
// convenience, redundant with every value rendered here as full-size DOM text. There are at
// most 6 distinct multipliers in any of the 15 configs, so this row never scales with segment
// count (plinko-controls.tsx's chip-grid precedent).
//
// Deliberately NO cap-disclosure line and NO net-0 disclosure line (14-CONTEXT § Two deliberate
// deletions): 49.5x * MAX_BET 1,000 = 49,500 < MAX_PAYOUT 100,000, and the smallest non-zero
// multiplier 1.2x always floors above the stake for wagers at or above MIN_BET 5.

import * as React from "react"
import { presetButton } from "@/components/game-hub/casino/bet-input"
import { WHEEL_RISKS, WHEEL_SEGMENTS, WHEEL_TABLES, type WheelRisk } from "@/lib/casino/wheel"
import { cn } from "@/lib/utils"

const RISK_LABELS: Record<WheelRisk, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" }

// The identical colour formula wheel-face.tsx's ring uses, duplicated here (not
// exported/shared) — a segment and its legend chip must read as the same colour at the same
// strength, and the two files are otherwise independent (plinko-board.tsx/plinko-controls.tsx
// precedent).
const PAY_HEX = "#059669"
const LOSE_HEX = "#B45309"
const ZERO_ALPHA = 0.25

function hexToRgba(hex: string, alpha: number): string {
  const int = Number.parseInt(hex.slice(1), 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function payAlpha(rank: number, distinct: number): number {
  return distinct === 1 ? 0.6 : 0.2 + 0.4 * (rank / (distinct - 1))
}

export function WheelControls({
  segments,
  risk,
  locked,
  landedMultiplier,
  onSegmentsChange,
  onRiskChange,
}: {
  segments: number
  risk: WheelRisk
  /** A spin is in flight — mirrors plinko-controls.tsx's `locked` precedent. */
  locked: boolean
  /** The multiplier a just-landed spin settled at, or null. Rings its chip for one
   *  --duration-settle beat. */
  landedMultiplier: number | null
  onSegmentsChange: (segments: number) => void
  onRiskChange: (risk: WheelRisk) => void
}) {
  const table = WHEEL_TABLES[risk][segments]
  const segmentIdx = WHEEL_SEGMENTS.indexOf(segments as (typeof WHEEL_SEGMENTS)[number])

  const riskRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  function moveRiskFocus(delta: number) {
    const i = WHEEL_RISKS.indexOf(risk)
    const next = WHEEL_RISKS[(i + delta + WHEEL_RISKS.length) % WHEEL_RISKS.length]
    onRiskChange(next)
    riskRefs.current[WHEEL_RISKS.indexOf(next)]?.focus()
  }

  function handleRiskKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      moveRiskFocus(1)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      moveRiskFocus(-1)
    }
  }

  // legend — one chip per DISTINCT multiplier, sorted descending so the jackpot reads first.
  const counts = new Map<number, number>()
  for (const m of table) counts.set(m, (counts.get(m) ?? 0) + 1)
  const legend = [...counts.entries()].sort((a, b) => b[0] - a[0])

  const distinct = [...new Set(table.filter((m) => m > 0))].sort((a, b) => a - b)
  const colorFor = (m: number) =>
    m === 0
      ? hexToRgba(LOSE_HEX, ZERO_ALPHA)
      : hexToRgba(PAY_HEX, payAlpha(distinct.indexOf(m), distinct.length))

  return (
    <div>
      <div
        className={cn("space-y-3", locked && "pointer-events-none opacity-50")}
        aria-disabled={locked || undefined}
      >
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-sm font-medium">Risk</span>
          <div
            role="radiogroup"
            aria-label="Risk"
            onKeyDown={handleRiskKeyDown}
            className="grid flex-1 grid-cols-3 gap-1 rounded-md bg-muted p-1"
          >
            {WHEEL_RISKS.map((r, i) => {
              const selected = r === risk
              return (
                <button
                  key={r}
                  ref={(el) => {
                    riskRefs.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onRiskChange(r)}
                  className={cn(
                    "min-h-11 rounded-sm text-sm font-medium transition-[color,background-color,transform] duration-150 ease-[var(--ease-out-quint)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    selected ? "bg-background text-foreground font-semibold shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {RISK_LABELS[r]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-sm font-medium">Segments</span>
          <div className="grid flex-1 grid-cols-[44px_1fr_44px] gap-2">
            <button
              type="button"
              disabled={segmentIdx === 0}
              aria-disabled={segmentIdx === 0}
              aria-label="Fewer segments"
              onClick={() => onSegmentsChange(WHEEL_SEGMENTS[segmentIdx - 1])}
              className={presetButton}
            >
              −
            </button>
            <span
              className="flex min-h-11 items-center justify-center font-mono text-sm tabular-nums"
              aria-live="off"
            >
              {segments}
            </span>
            <button
              type="button"
              disabled={segmentIdx === WHEEL_SEGMENTS.length - 1}
              aria-disabled={segmentIdx === WHEEL_SEGMENTS.length - 1}
              aria-label="More segments"
              onClick={() => onSegmentsChange(WHEEL_SEGMENTS[segmentIdx + 1])}
              className={presetButton}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Fixed h-5 helper, always rendered (empty string when unlocked) — the lock never
          shifts layout. */}
      <p className="h-5 text-sm text-muted-foreground">
        {locked ? "Locked while the wheel is spinning." : ""}
      </p>

      <p className="mt-3 text-sm text-muted-foreground">Segment distribution</p>
      <div className="flex flex-wrap gap-1">
        {legend.map(([multiplier, count]) => (
          <span
            key={multiplier}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-sm tabular-nums",
              landedMultiplier === multiplier && "ring-2 ring-foreground/30",
            )}
            style={{ backgroundColor: colorFor(multiplier) }}
          >
            {multiplier}× ×{count}
          </span>
        ))}
      </div>
    </div>
  )
}
