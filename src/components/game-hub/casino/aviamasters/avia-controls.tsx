"use client"

// AviaControls — speed segmented control, autoplay select, and the two required disclosures
// (16-03-PLAN.md). Presentational only: owns no bet state beyond the speed radiogroup's roving
// focus, and makes no tRPC call.
//
// Both settings are CLIENT-ONLY and are NEVER sent to the server: aviamasters.play's input
// schema is `{ wager }` `.strict()` (16-02's router), so a client that sends `speed` is
// REJECTED, not silently stripped. That structural inexpressibility is what actually satisfies
// AVIA-04; the disclosure sentence below only tells the user about it.

import * as React from "react"
import { Lock } from "lucide-react"
import { presetButton } from "@/components/game-hub/casino/bet-input"
import { AVIA_MAX_MULT } from "@/lib/casino/aviamasters"
import { MAX_PAYOUT } from "@/lib/casino/limits"
import { cn } from "@/lib/utils"

export type AviaSpeed = "TURTLE" | "CRUISE" | "HARE" | "LIGHTNING"

export const AVIA_SPEEDS: readonly AviaSpeed[] = ["TURTLE", "CRUISE", "HARE", "LIGHTNING"]

// Step duration only — speed never touches the odds (16-RESEARCH § Cosmetic Settings). Cruise
// (260ms/step, ~3.6s for a mean 13.7-step round) is the default, comparable to Wheel's known-good
// 3s spin.
export const AVIA_SPEED_MS: Record<AviaSpeed, number> = {
  TURTLE: 420,
  CRUISE: 260,
  HARE: 150,
  LIGHTNING: 70,
}

const SPEED_LABELS: Record<AviaSpeed, string> = {
  TURTLE: "Turtle",
  CRUISE: "Cruise",
  HARE: "Hare",
  LIGHTNING: "Lightning",
}

// 10 / 25 / 50, never BGaming's 1,000/infinite — a user decision (16-CONTEXT.md § Decisions):
// each round is a server request, so an unattended 1,000-round autoplay is a self-inflicted load
// problem with no upside in a friends' app.
export const AVIA_AUTOPLAY_COUNTS = [10, 25, 50] as const

export function AviaControls({
  speed,
  autoplay,
  remaining,
  bet,
  locked,
  onSpeedChange,
  onAutoplayChange,
  onStopAutoplay,
}: {
  speed: AviaSpeed
  /** The armed autoplay count, 0 = off. */
  autoplay: number
  /** Rounds left in the current autoplay run, or null while not running. */
  remaining: number | null
  bet: number
  /** A mutation or a flight is in progress — mirrors PlinkoControls/WheelControls' `locked`. */
  locked: boolean
  onSpeedChange: (speed: AviaSpeed) => void
  onAutoplayChange: (count: number) => void
  onStopAutoplay: () => void
}) {
  const speedRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  function moveSpeedFocus(delta: number) {
    const i = AVIA_SPEEDS.indexOf(speed)
    const next = AVIA_SPEEDS[(i + delta + AVIA_SPEEDS.length) % AVIA_SPEEDS.length]
    onSpeedChange(next)
    speedRefs.current[AVIA_SPEEDS.indexOf(next)]?.focus()
  }

  function handleSpeedKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      moveSpeedFocus(1)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      moveSpeedFocus(-1)
    }
  }

  // Interpolated from MAX_PAYOUT/AVIA_MAX_MULT, not hardcoded — only the fixed "×250" phrasing
  // below is the literal contracted copy. 250 x MAX_BET(1,000) = 250,000 > MAX_PAYOUT(100,000):
  // the x250 is fully payable only at stakes at or below 400 ZP (16-RESEARCH § The x250 Clamp). Reuse
  // the Plinko conditional-disclosure precedent verbatim in structure — do not remove the
  // multiplier and do not raise the cap (11-CONTEXT.md's binding ruling on exactly this shape).
  const showCap = Math.floor(bet * AVIA_MAX_MULT) > MAX_PAYOUT

  return (
    <div>
      <div className={cn("space-y-3", locked && "pointer-events-none opacity-50")} aria-disabled={locked || undefined}>
        {/* Label ABOVE the radiogroup, not beside it. Inline, the 56px label plus gaps left
            ~54px per column at a 360px viewport, and "Lightning" needs ~67px at 11px — the
            last option was visibly clipped. Stacking gives the four buttons the full width. */}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Speed</span>
          <div
            role="radiogroup"
            aria-label="Speed"
            onKeyDown={handleSpeedKeyDown}
            className="grid w-full grid-cols-4 gap-1"
          >
            {AVIA_SPEEDS.map((s, i) => {
              const selected = s === speed
              return (
                <button
                  key={s}
                  ref={(el) => {
                    speedRefs.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  disabled={locked}
                  aria-disabled={locked}
                  onClick={() => onSpeedChange(s)}
                  className={cn(
                    presetButton,
                    "px-1 text-[11px] leading-tight",
                    selected
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {SPEED_LABELS[s]}
                </button>
              )
            })}
          </div>
        </div>

        {remaining === null && (
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm font-medium">Autoplay</span>
            {/* Native <select> — verifier.tsx's precedent for a short option list on mobile. */}
            <select
              aria-label="Autoplay rounds"
              value={autoplay}
              disabled={locked}
              onChange={(e) => onAutoplayChange(Number(e.target.value))}
              className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value={0}>Off</option>
              {AVIA_AUTOPLAY_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} rounds
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Stop deliberately lives OUTSIDE the locked-gated wrapper above. A prior version nested
          it inside that div, so `locked && "pointer-events-none"` applied to the Stop button
          too — and `locked` is true for the ENTIRE autoplay run (remaining !== null the whole
          time), which meant Stop could never actually be clicked while autoplay was running,
          the one moment it has to work. Found by 16-05-PLAN.md's Gate G (a real click hung
          until the test's own timeout). The only in-round control this game has, so it gets the
          whole thumb zone — takes effect on the next boundary in aviamasters.tsx's loop (a ref
          the handler sets, never stale state). */}
      {remaining !== null && (
        <button
          type="button"
          onClick={onStopAutoplay}
          className="mt-3 min-h-11 w-full rounded-md border border-destructive/40 bg-destructive/10 text-sm font-semibold text-destructive transition-[transform,background-color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Stop autoplay · {remaining} left
        </button>
      )}

      {/* Fixed h-5 helper, always rendered (empty string when unlocked) — the same anti-shift
          discipline BetInput/WheelControls/PlinkoControls apply. */}
      <p className="h-5 text-sm text-muted-foreground">{locked ? "Locked while the plane is flying." : ""}</p>

      {/* Disclosure 1 (AVIA-04 — a requirement, not decoration). Always visible, never behind a
          tooltip. Deliberately does not repeat BGaming's marketed volatility label: this model's
          CV is 2.27, above Plinko MEDIUM's 1.48, so that label would contradict this repo's own
          yardstick (16-CONTEXT § Honesty note). */}
      <p className="text-sm text-muted-foreground">
        Speed and autoplay only change how fast rounds play. They do not change the odds — every
        round is 97% RTP.
      </p>

      {/* Disclosure 2 (the cap line) — always-mounted min-h-5, empty when the cap does not bite.
          min-h-5 + items-start (not h-5 + items-center): at 360px this can wrap to two lines,
          and a fixed h-5 with items-center would spill the overflow both upward and downward
          (plinko-controls.tsx's confirmed 360x640 UAT finding). Phrased as a fact about the
          current stake, not a warning and not an apology. */}
      <p className="flex min-h-5 items-start gap-1 text-sm text-muted-foreground">
        {showCap && (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              At <span className="font-mono tabular-nums">{bet}</span> ZP, the ×{AVIA_MAX_MULT} max
              pays the <span className="font-mono tabular-nums">{Math.floor(MAX_PAYOUT / bet)}×</span>{" "}
              cap instead.
            </span>
          </>
        )}
      </p>
    </div>
  )
}
