"use client"

// BetInput — the most-reused control in the casino milestone (10-UI-SPEC.md § 2).
// ½ / value / 2× / Max, all six states, clamp-don't-shout on the presets, and a
// fixed-height helper line so no state transition ever shifts layout.

import * as React from "react"
import { Input } from "@/components/ui/input"
import { clampBet, MIN_BET, MAX_BET } from "@/lib/casino/limits"
import { cn } from "@/lib/utils"

// Exported for plinko-controls.tsx's rows stepper — the same 44px preset-button treatment,
// reused rather than re-declared (there is no shared "casino button" abstraction for two call sites).
export const presetButton =
  "min-h-11 rounded-md border border-input text-sm font-medium transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

export function BetInput({
  value,
  onChange,
  balance,
  locked = false,
  className,
}: {
  value: number
  onChange: (value: number) => void
  balance: number
  /** An ACTIVE round exists for this game — whole row disabled. */
  locked?: boolean
  className?: string
}) {
  // Typed input is buffered as text, but only while focused — draft is null
  // whenever the field is blurred, so the displayed value is simply derived
  // from the `value` prop with no effect needed to keep them in sync. This
  // also means validation (and the insufficient-balance state) only evaluates
  // on blur — never on every keystroke, which would produce the classic
  // "1" -> "Not enough ZP" -> "12" form-jitter bug.
  const [draft, setDraft] = React.useState<string | null>(null)
  const displayValue = draft ?? String(value)

  const atMin = value === MIN_BET
  const atMax = value === MAX_BET || (balance < MAX_BET && value === balance)
  const insufficient = value > balance

  function handleBlur() {
    const parsed = Number.parseInt(draft ?? String(value), 10)
    setDraft(null) // hand display back to the `value` prop in every branch below
    if (!Number.isFinite(parsed)) return
    // Below the floor isn't a real state to show — snap up via the shared
    // clampBet (never re-derive the arithmetic here).
    if (parsed < MIN_BET) {
      onChange(clampBet(parsed, balance))
      return
    }
    // Over the hard MAX_BET ceiling with balance to spare snaps down the same
    // way — MAX_BET is a house rule, not a balance concern. Typing above the
    // balance itself is the one path left un-clamped: that's how the
    // insufficient-balance state below gets reached at all.
    if (parsed > MAX_BET && parsed <= balance) {
      onChange(clampBet(parsed, balance))
      return
    }
    onChange(parsed)
  }

  const helper = locked
    ? "Round in progress."
    : insufficient
      ? `Not enough ZP. You have ${balance}.`
      : atMin
        ? `Minimum bet is ${MIN_BET} ZP.`
        : atMax
          ? balance < MAX_BET
            ? "That's your whole balance."
            : `Max bet is ${MAX_BET} ZP.`
          : ""

  return (
    <div className={cn(locked && "pointer-events-none opacity-50", className)} aria-disabled={locked || undefined}>
      <div className="grid grid-cols-[44px_1fr_44px_56px] gap-2">
        <button
          type="button"
          disabled={atMin}
          aria-disabled={atMin}
          onClick={() => onChange(clampBet(Math.floor(value / 2), balance))}
          className={presetButton}
        >
          ½
        </button>

        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          aria-label="Bet amount in ZP"
          value={displayValue}
          onFocus={() => setDraft(String(value))}
          onBlur={handleBlur}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          // text-base (16px) is load-bearing, not a style choice: anything under
          // 16px triggers iOS auto-zoom on focus, which breaks MOBL-01's
          // no-pinch-zoom requirement. Do not "tidy" this to text-sm.
          className={cn(
            "h-11 text-center font-mono tabular-nums text-base",
            insufficient && "border-destructive",
          )}
        />

        <button
          type="button"
          disabled={atMax}
          aria-disabled={atMax}
          onClick={() => onChange(clampBet(value * 2, balance))}
          className={presetButton}
        >
          2×
        </button>

        <button
          type="button"
          disabled={atMax}
          aria-disabled={atMax}
          onClick={() => onChange(clampBet(MAX_BET, balance))}
          className={presetButton}
        >
          Max
        </button>
      </div>

      {/* Fixed h-5 helper line, always rendered (empty string when unused) — an
          appearing/disappearing message would shift the button sitting below it. */}
      <p className={cn("h-5 text-sm", insufficient ? "text-destructive" : "text-muted-foreground")}>{helper}</p>
    </div>
  )
}
