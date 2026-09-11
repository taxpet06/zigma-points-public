"use client"

// BetButton — the single primary thumb-zone action every casino game shares
// (10-UI-SPEC.md § 3). Fixed w-14/h-14 footprint so width and height can never
// shift, plus an always-mounted sub-label slot so "Cash out" growing to
// "Cash out / +247 ZP · 2.47x" never grows the button under the user's thumb.

import * as React from "react"
import { cn } from "@/lib/utils"

export type BetButtonPhase = "ready" | "invalid" | "settling" | "cashable" | "cashing-out" | "resumed"

export function BetButton({
  phase,
  betLabel,
  subLabel,
  onClick,
  className,
}: {
  phase: BetButtonPhase
  /** e.g. "Bet 25 ZP" — used verbatim for the ready/invalid phases. */
  betLabel: string
  /** e.g. "+247 ZP · 2.47×" — cashable/resumed only. Omit or "" otherwise. */
  subLabel?: string
  onClick: () => void
  className?: string
}) {
  const disabled = phase === "invalid" || phase === "settling" || phase === "cashing-out"

  const label =
    phase === "settling"
      ? "Settling…"
      : phase === "cashing-out"
        ? "Cashing out…"
        : phase === "cashable" || phase === "resumed"
          ? "Cash out"
          : betLabel

  const resolvedSubLabel = phase === "settling" || phase === "ready" || phase === "invalid" ? "" : (subLabel ?? "")

  // Debounce: the caller's phase prop is expected to flip to "settling" /
  // "cashing-out" once the mutation starts, which disables this button. This
  // guard covers the render gap between the click and that prop update, since
  // RESEARCH §Idempotency records a double `play` legitimately creates two
  // bets server-side — debouncing is a UI responsibility that can't be skipped.
  const firing = React.useRef(false)
  function handleClick() {
    if (disabled || firing.current) return
    firing.current = true
    onClick()
    queueMicrotask(() => {
      firing.current = false
    })
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={handleClick}
      className={cn(
        "h-14 w-full rounded-md bg-primary font-semibold text-primary-foreground",
        phase === "invalid" && "opacity-50",
        (phase === "settling" || phase === "cashing-out") && "opacity-60",
        // Tap feedback must be immediate — no transition on the active state,
        // or the button feels laggy on Android. The existing repo convention.
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none",
        className,
      )}
    >
      <span className="flex flex-col items-center justify-center">
        <span className="transition-opacity duration-150">{label}</span>
        {/* Always-mounted h-5 sub-label slot, empty string when unused — the
            single most important anti-shift detail in this file. */}
        <span className="h-5 text-sm opacity-80 transition-opacity duration-150">{resolvedSubLabel}</span>
      </span>
    </button>
  )
}
