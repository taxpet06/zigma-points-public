"use client"

// PlinkoControls — risk segmented control, rows stepper, the payout chip grid, and the
// conditional cap-disclosure line (11-UI-SPEC.md § Rows and Risk Selectors, § Payout Chip Grid
// Contract, § Cap Disclosure Contract). Fully controlled and presentational: it owns no bet
// state beyond the risk radiogroup's roving focus, and makes no tRPC call.
//
// The chip grid is what actually satisfies PLNK-01 — the canvas bucket strip (plinko-board.tsx)
// is colour and convenience, redundant with every value rendered here as 14px DOM text.

import * as React from "react"
import { Lock } from "lucide-react"
import { presetButton } from "@/components/game-hub/casino/bet-input"
import {
  PLINKO_MAX_ROWS,
  PLINKO_MIN_ROWS,
  PLINKO_RISKS,
  PLINKO_TABLES,
  type PlinkoRisk,
} from "@/lib/casino/plinko"
import { MAX_PAYOUT } from "@/lib/casino/limits"
import { cn } from "@/lib/utils"

const RISK_LABELS: Record<PlinkoRisk, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" }

// Distance-from-centre alpha and the emerald/amber pair — the identical formula
// plinko-board.tsx's canvas strip uses, duplicated here (not exported/shared) because a
// bucket and its chip must read as the same colour at the same strength, and this file does
// not otherwise depend on the board.
function bucketAlpha(k: number, rows: number): number {
  return 0.1 + 0.3 * (Math.abs(k - rows / 2) / (rows / 2))
}

function bucketColor(multiplier: number): string {
  return multiplier >= 1 ? "#059669" : "#B45309"
}

function hexToRgba(hex: string, alpha: number): string {
  const int = Number.parseInt(hex.slice(1), 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function PlinkoControls({
  rows,
  risk,
  bet,
  locked,
  landedBucket,
  onRowsChange,
  onRiskChange,
}: {
  rows: number
  risk: PlinkoRisk
  bet: number
  /** A ball is in flight — mirrors BetInput's `locked` precedent. */
  locked: boolean
  /** The bucket a just-landed ball settled in, or null. Rings its chip for one --duration-settle beat. */
  landedBucket: number | null
  onRowsChange: (rows: number) => void
  onRiskChange: (risk: PlinkoRisk) => void
}) {
  const table = PLINKO_TABLES[risk][rows]
  const bestMultiplier = Math.max(...table)
  // Interpolated from MAX_PAYOUT, not a hardcoded 10000 — only the fixed "10,000 ZP cap"
  // phrasing below is the literal contracted copy.
  const showCap = Math.floor(bet * bestMultiplier) > MAX_PAYOUT

  const riskRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  function moveRiskFocus(delta: number) {
    const i = PLINKO_RISKS.indexOf(risk)
    const next = PLINKO_RISKS[(i + delta + PLINKO_RISKS.length) % PLINKO_RISKS.length]
    onRiskChange(next)
    riskRefs.current[PLINKO_RISKS.indexOf(next)]?.focus()
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

  return (
    <div>
      {/* A ball already falling was bet under a specific rows/risk table. Letting the board
          re-lay-out beneath it would land it in a bucket whose label belongs to a different
          game — one boolean removes the entire class of bug. BetInput/BetButton stay live;
          only this selector block locks. */}
      <div
        className={cn("space-y-3", locked && "pointer-events-none opacity-50")}
        aria-disabled={locked || undefined}
      >
        <div className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-sm font-medium">Risk</span>
          <div
            role="radiogroup"
            aria-label="Risk"
            onKeyDown={handleRiskKeyDown}
            className="grid flex-1 grid-cols-3 gap-1 rounded-md bg-muted p-1"
          >
            {PLINKO_RISKS.map((r, i) => {
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
                    "min-h-11 rounded-sm text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    // The selected segment is an achromatic elevation step — never crimson.
                    // Crimson is reserved for the one control that spends ZP (BetButton).
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
          <span className="w-12 shrink-0 text-sm font-medium">Rows</span>
          <div className="grid flex-1 grid-cols-[44px_1fr_44px] gap-2">
            <button
              type="button"
              disabled={rows === PLINKO_MIN_ROWS}
              aria-disabled={rows === PLINKO_MIN_ROWS}
              aria-label="Fewer rows"
              onClick={() => onRowsChange(rows - 1)}
              className={presetButton}
            >
              −
            </button>
            <span
              className="flex min-h-11 items-center justify-center font-mono text-sm tabular-nums"
              aria-live="off"
            >
              {rows}
            </span>
            <button
              type="button"
              disabled={rows === PLINKO_MAX_ROWS}
              aria-disabled={rows === PLINKO_MAX_ROWS}
              aria-label="More rows"
              onClick={() => onRowsChange(rows + 1)}
              className={presetButton}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Fixed h-5 helper, always rendered (empty string when unlocked) — the same anti-shift
          discipline BetInput applies. The lock state is never conveyed by opacity alone. */}
      <p className="h-5 text-sm text-muted-foreground">{locked ? "Locked while balls are falling." : ""}</p>

      <p className="mt-3 text-sm text-muted-foreground">Payouts — left bucket to right</p>
      {/* Three redundant links between a bucket and its chip — colour identity (same hex, same
          alpha as bucket k on the canvas), order identity (both read board-order, left to
          right), and landing identity (the ring below). That redundancy is deliberate: there is
          nothing to tap here because nothing is hidden. */}
      <div className="flex flex-wrap gap-1">
        {table.map((multiplier, k) => (
          <span
            key={k}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-sm tabular-nums",
              landedBucket === k && "ring-2 ring-foreground/30",
            )}
            style={{ backgroundColor: hexToRgba(bucketColor(multiplier), bucketAlpha(k, rows)) }}
          >
            {multiplier}×
          </span>
        ))}
      </div>

      {/* Always-mounted min-h-5, empty string when the cap doesn't bite. This is the third of
          four disclosures (after the rules card and the control bar's permanent "Max payout
          10,000 ZP"), phrased as a fact about the current config — not a warning, not an
          apology. A Low-risk 8-row player never sees it.
          min-h-5 + items-start (not h-5 + items-center): at 360px this line can wrap to two
          lines (e.g. "At 25 ZP, buckets above 400× pay the / 10,000 ZP cap.") — a FIXED h-5
          with items-center vertically centers the overflowing content, spilling it both
          upward into the chip grid above and downward into the balance bar below (confirmed
          via 11-08's 360x640 UAT screenshot). min-h-5 lets the box grow instead of clipping,
          and items-start keeps a single-line render pixel-identical to before. */}
      <p className="flex min-h-5 items-start gap-1 text-sm text-muted-foreground">
        {showCap && (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              At <span className="font-mono tabular-nums">{bet}</span> ZP, buckets above{" "}
              <span className="font-mono tabular-nums">{Math.floor(MAX_PAYOUT / bet)}×</span> pay the{" "}
              {MAX_PAYOUT.toLocaleString()} ZP cap.
            </span>
          </>
        )}
      </p>
    </div>
  )
}
