"use client"

// DiceControls — the whole Dice surface below the dialog header (13-UI-SPEC.md § The Triad
// Control). Presentational only: owns no bet state, makes no tRPC call. All triad math
// (fromChanceH / chanceHFor / diceMultiplier) lives in @/lib/casino/dice and is imported, never
// re-derived here.
//
// Deliberately has NO `locked` prop and no dimmed state during settle. The round trip is
// ~200ms; the owner (dice.tsx) clears the roll on bet-submit, target change and mode flip, which
// removes the entire mid-flight race — there is nothing left here to lock while a request is in
// flight (13-UI-SPEC § When the roll clears). ponytail: no locked prop, ever.
//
// MOTION IS NEVER GATED HERE. No `motion-reduce:` utility, no matchMedia read: CasinoShell
// carries `.game-motion`, which opts the casino out of the global prefers-reduced-motion rule
// (globals.css) because iOS Low Power Mode and Android battery saver both report `reduce` — that
// is exactly what made the games look frozen on a phone that was merely low on battery. The
// reveal below is presentation only: `roll` is the settled server number from the first frame
// this component sees it, and nothing here can change what it settles on.

import * as React from "react"
import { Lock } from "lucide-react"
import { Input } from "@/components/ui/input"
import { presetButton } from "@/components/game-hub/casino/bet-input"
import {
  CHANCE_H_MAX,
  CHANCE_H_MIN,
  chanceHFor,
  DICE_EDGE,
  diceMultiplier,
  fromChanceH,
  type DiceMode,
} from "@/lib/casino/dice"
import { MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"
import { cn } from "@/lib/utils"

const MODES: readonly DiceMode[] = ["UNDER", "OVER"]

// The reveal beat. The roll is already decided (server-side, before this component ever sees it);
// this is only how long the digits scramble before showing it, and how long the needle takes to
// travel there. Short on purpose — Dice is one number, so the beat has to land, not linger.
const REVEAL_MS = 460

// Chips are labelled by multiplier and set the chance — the only five round multipliers that
// are exactly representable in integer hundredths, so none of them ever produces a visible snap
// in either mode (13-UI-SPEC § The preset chips).
const CHIPS: ReadonlyArray<{ label: string; chanceH: number }> = [
  { label: "2×", chanceH: 4950 },
  { label: "3×", chanceH: 3300 },
  { label: "5×", chanceH: 1980 },
  { label: "10×", chanceH: 990 },
  { label: "50×", chanceH: 198 },
]

export function DiceControls({
  targetH,
  mode,
  bet,
  roll,
  win,
  onTargetH,
  onModeChange,
}: {
  targetH: number
  mode: DiceMode
  bet: number
  roll: number | null
  win: boolean | null
  onTargetH: (targetH: number) => void
  onModeChange: (mode: DiceMode) => void
}) {
  const uid = React.useId()
  const chanceH = chanceHFor(targetH, mode)
  const multiplier = diceMultiplier(chanceH)
  // targetH's legal range flips with mode — UNDER holds the chance bound directly, OVER holds
  // its mirror (10000 - chance). Derived from the shared constants, not restated as literals.
  const min = mode === "UNDER" ? CHANCE_H_MIN : 10000 - CHANCE_H_MAX
  const max = mode === "UNDER" ? CHANCE_H_MAX : 10000 - CHANCE_H_MIN
  const frac = (targetH - min) / (max - min)

  const rollH = roll !== null ? Math.min(max, Math.max(min, Math.round(roll * 100))) : null
  const rollFrac = rollH !== null ? (rollH - min) / (max - min) : 0

  // --- The reveal. `roll` is the settled server number from the very first frame — the scramble
  // below only decides which digits are PAINTED for REVEAL_MS, never what they settle on. The
  // digits are written straight to the DOM node (not through state) so a 60fps scramble doesn't
  // re-render the slider: the triad readouts must never lag the thumb. ---
  const [revealed, setRevealed] = React.useState(true)
  const rollTextRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (roll === null) {
      setRevealed(true)
      return
    }
    setRevealed(false)
    if (rollTextRef.current) rollTextRef.current.textContent = (Math.random() * 100).toFixed(2)
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      if (now - start >= REVEAL_MS) {
        // The settled value is painted by React on the `revealed` re-render below — this branch
        // deliberately writes nothing, so the scramble can never be the last word.
        setRevealed(true)
        return
      }
      if (rollTextRef.current) rollTextRef.current.textContent = (Math.random() * 100).toFixed(2)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [roll])

  const settled = roll !== null && revealed

  const rollColor =
    !settled
      ? "text-muted-foreground"
      : win === true
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive"

  // The needle is ALWAYS mounted so it can travel from wherever the last roll left it instead of
  // teleporting into place; it only fades out when there is no roll on screen.
  const lastNeedleFrac = React.useRef(0.5)
  if (rollH !== null) lastNeedleFrac.current = rollFrac

  // --- Mode toggle: roving-tabIndex radiogroup, verbatim plinko-controls.tsx pattern ---
  const modeRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  function moveModeFocus(delta: number) {
    const i = MODES.indexOf(mode)
    const next = MODES[(i + delta + MODES.length) % MODES.length]
    onModeChange(next)
    modeRefs.current[MODES.indexOf(next)]?.focus()
  }

  function handleModeKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      moveModeFocus(1)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      moveModeFocus(-1)
    }
  }

  // --- The three fields: commit on BLUR ONLY (bet-input.tsx's draft pattern, verbatim) ---
  const [multiplierDraft, setMultiplierDraft] = React.useState<string | null>(null)
  const [targetDraft, setTargetDraft] = React.useState<string | null>(null)
  const [chanceDraft, setChanceDraft] = React.useState<string | null>(null)

  const multiplierDisplay = multiplierDraft ?? multiplier.toFixed(4)
  const targetDisplay = targetDraft ?? (targetH / 100).toFixed(2)
  const chanceDisplay = chanceDraft ?? (chanceH / 100).toFixed(2)

  // A non-finite parse leaves the value untouched; an in-range-but-illegal one clamps silently
  // via fromChanceH — no error state, no red border, no helper copy (13-UI-SPEC § Clamp, don't
  // shout). The field re-rendering at the nearest legal value IS the message.
  function commitMultiplier() {
    const raw = multiplierDraft
    setMultiplierDraft(null)
    if (raw === null) return
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    // (100 - DICE_EDGE) / multiplier, in hundredths — the inverse of diceMultiplier, reusing the
    // shared edge constant instead of restating "99" as a magic number.
    onTargetH(fromChanceH(Math.round(((100 - DICE_EDGE) / parsed) * 100), mode).targetH)
  }

  function commitTarget() {
    const raw = targetDraft
    setTargetDraft(null)
    if (raw === null) return
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return
    onTargetH(fromChanceH(chanceHFor(Math.round(parsed * 100), mode), mode).targetH)
  }

  function commitChance() {
    const raw = chanceDraft
    setChanceDraft(null)
    if (raw === null) return
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return
    onTargetH(fromChanceH(Math.round(parsed * 100), mode).targetH)
  }

  // --- The one disclosure slot — cap and net-0 are mutually exclusive by construction (the cap
  // bites at large multipliers, the floor only at ~1.0102×), so there is never a stacking case. ---
  const capped = Math.floor(bet * multiplier) > MAX_PAYOUT
  const netZero = payoutFor(bet, multiplier) === bet

  return (
    <div>
      <style>{`
        @keyframes dice-settle {
          0%   { transform: scale(1.22); }
          100% { transform: scale(1); }
        }
        @keyframes dice-region-flash {
          0%   { opacity: 0; }
          22%  { opacity: 0.85; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Readout row — always mounted, directly above the slider, nothing between them. */}
      <div
        className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-4"
        aria-live="polite"
      >
        <span>
          <span className="text-sm text-muted-foreground">Roll </span>
          <span
            ref={rollTextRef}
            className={cn(
              "inline-block origin-left font-mono text-[20px] font-semibold tabular-nums transition-colors duration-150",
              rollColor,
              settled && "[animation:dice-settle_260ms_var(--ease-out-quint)]",
            )}
          >
            {revealed ? (roll !== null ? roll.toFixed(2) : "—") : "—"}
          </span>
          {settled && (
            <span className="sr-only">
              {`Rolled ${roll.toFixed(2)}. Target ${(targetH / 100).toFixed(2)}, roll ${mode === "UNDER" ? "under" : "over"}. ${win ? "Win." : "Loss."}`}
            </span>
          )}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Target </span>
          <span className="font-mono tabular-nums text-foreground">{(targetH / 100).toFixed(2)}</span>
          <span className="text-muted-foreground"> · {mode === "UNDER" ? "under" : "over"}</span>
        </span>
      </div>

      {/* The slider — native <input type="range">, no primitive, no pointer-event handler. */}
      <div className="relative mt-3">
        <input
          type="range"
          min={min}
          max={max}
          step={1} // INTEGER HUNDREDTHS — a float step yields 12.020000000000001 from valueAsNumber
          value={targetH}
          key={mode} // forces a remount so React can never apply the new value before the new min/max
          onChange={(e) => onTargetH(e.currentTarget.valueAsNumber)}
          aria-label="Target"
          aria-valuetext={`${(targetH / 100).toFixed(2)}, ${mode === "UNDER" ? "roll under" : "roll over"}, win chance ${(chanceH / 100).toFixed(2)} percent`}
          style={
            {
              // The 14px thumb-inset correction: browsers inset the thumb centre by half the
              // 28px thumb at each end, so a naive percentage puts the colour boundary up to
              // 14px away from the thumb at the extremes. The needle below uses this identical
              // expression so the needle, the thumb and the band edge can never disagree.
              "--pct": `calc(${frac} * (100% - 28px) + 14px)`,
              "--fill":
                mode === "UNDER"
                  ? "linear-gradient(to right, var(--win) 0 var(--pct), var(--lose) var(--pct) 100%)"
                  : "linear-gradient(to right, var(--lose) 0 var(--pct), var(--win) var(--pct) 100%)",
            } as React.CSSProperties
          }
          className={cn(
            "h-11 w-full cursor-pointer touch-pan-y appearance-none rounded-md bg-transparent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "[--win:var(--color-emerald-600)] dark:[--win:var(--color-emerald-400)] [--lose:var(--muted)]",
            // The track paint is the input's own pseudo-element, not a sibling div — there is
            // no second element to keep in sync, so the fill can never disagree with `value`.
            "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[image:var(--fill)]",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:rounded-full",
            // The thumb is bg-foreground with a 2px border-background ring, so it reads on
            // both the emerald and the muted side without a second colour.
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow",
            // -mt-2.5 is REQUIRED: WebKit positions the thumb against the track box while
            // Gecko centres it automatically; omitting this drops the thumb 10px below the
            // track in Safari and Chrome only.
            "[&::-webkit-slider-thumb]:-mt-2.5",
            "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[image:var(--fill)]",
            "[&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground",
            // No transition on the track background anywhere in this recipe — a transitioned
            // fill lags the finger during a drag, which reads as the control fighting the touch.
          )}
          // touch-pan-y (touch-action: pan-y): without it, a native range input claims EVERY
          // touch that starts on it, including a vertical swipe — which blocks the one gesture
          // 13-UI-SPEC's UAT Gate 2 requires (dragging vertically over the slider must scroll
          // the dialog, not move the target). This tells the compositor to let a vertical touch
          // pass through as a page scroll while horizontal touches still drag the thumb. Found
          // by the 13-05 mobile UAT gate itself — the exact defect it was written to catch.
        />

        {/* The region the roll landed in, flashed once at settle — the band under the thumb and
            the number above it say the same thing in the same frame. Emerald on a win, crimson on
            a loss; opacity only, so it costs nothing. */}
        {settled && (
          <div
            aria-hidden="true"
            className={cn(
              // opacity-0 is the RESTING state — the animation carries no fill-mode, so the band
              // reverts to invisible the moment the flash is over.
              "pointer-events-none absolute top-0 flex h-11 items-center opacity-0",
              "[animation:dice-region-flash_600ms_var(--ease-out-quint)]",
            )}
            style={
              (mode === "UNDER") === (win === true)
                ? { left: 0, right: `calc(100% - (${frac} * (100% - 28px) + 14px))` }
                : { left: `calc(${frac} * (100% - 28px) + 14px)`, right: 0 }
            }
          >
            <div
              className={cn(
                "h-2 w-full rounded-full",
                win ? "bg-emerald-600 dark:bg-emerald-400" : "bg-destructive",
              )}
            />
          </div>
        )}

        {/* The needle — achromatic, pure transform, always mounted so it TRAVELS to the roll from
            wherever the last one left it instead of teleporting into place. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-11 w-full items-center">
          <div
            className="w-full transition-transform ease-[var(--ease-out-quint)]"
            style={
              {
                transitionDuration: `${REVEAL_MS}ms`,
                transform: `translateX(calc(${lastNeedleFrac.current} * (100% - 28px) + 14px))`,
              } as React.CSSProperties
            }
          >
            <div
              className={cn(
                "h-5 w-0.5 -translate-x-1/2 rounded-full bg-foreground transition-opacity duration-200",
                rollH === null && "opacity-0",
              )}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      {/* Mode toggle — below the slider, so flipping it swaps the fill in the element directly
          above the thumb that just moved. Achromatic selection, never crimson. */}
      <div
        role="radiogroup"
        aria-label="Roll direction"
        onKeyDown={handleModeKeyDown}
        className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
      >
        {MODES.map((m, i) => {
          const selected = m === mode
          return (
            <button
              key={m}
              ref={(el) => {
                modeRefs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onModeChange(m)}
              className={cn(
                "min-h-11 rounded-sm text-sm font-medium transition-[color,background-color,transform] duration-150 ease-[var(--ease-out-quint)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected ? "bg-background text-foreground font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {m === "UNDER" ? "Roll under" : "Roll over"}
            </button>
          )
        })}
      </div>

      {/* The three peer-styled fields — all three are edit paths (DICE-03). Bare numbers, no
          unit suffixes; the 1.2fr first column is load-bearing so 9900.0000 never clips. */}
      <div className="mt-3 grid grid-cols-[1.2fr_1fr_1fr] gap-2">
        <div>
          <label htmlFor={`${uid}-multiplier`} className="text-sm text-muted-foreground">
            Multiplier
          </label>
          <Input
            id={`${uid}-multiplier`}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Multiplier"
            value={multiplierDisplay}
            onFocus={() => setMultiplierDraft(multiplier.toFixed(4))}
            onChange={(e) => setMultiplierDraft(e.target.value)}
            onBlur={commitMultiplier}
            className="h-11 px-2 text-center font-mono tabular-nums text-base"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-target`} className="text-sm text-muted-foreground">
            Target
          </label>
          <Input
            id={`${uid}-target`}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Target"
            value={targetDisplay}
            onFocus={() => setTargetDraft((targetH / 100).toFixed(2))}
            onChange={(e) => setTargetDraft(e.target.value)}
            onBlur={commitTarget}
            className="h-11 px-2 text-center font-mono tabular-nums text-base"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-chance`} className="text-sm text-muted-foreground">
            Win chance
          </label>
          <Input
            id={`${uid}-chance`}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Win chance, percent"
            value={chanceDisplay}
            onFocus={() => setChanceDraft((chanceH / 100).toFixed(2))}
            onChange={(e) => setChanceDraft(e.target.value)}
            onBlur={commitChance}
            className="h-11 px-2 text-center font-mono tabular-nums text-base"
          />
        </div>
      </div>

      {/* Preset chips — labelled by multiplier, set the chance, mode-independent. Never
          fake-select the nearest: aria-pressed is exact-match only. */}
      <div className="mt-3 grid grid-cols-5 gap-2">
        {CHIPS.map((chip) => {
          const selected = chip.chanceH === chanceH
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={selected}
              aria-label={`${chip.label} multiplier`}
              onClick={() => onTargetH(fromChanceH(chip.chanceH, mode).targetH)}
              className={cn(presetButton, selected && "bg-muted font-semibold")}
            >
              {chip.label}
            </button>
          )
        })}
      </div>

      {/* One always-mounted disclosure slot — min-h-5 + items-start, never h-5 + items-center
          (the 11-08 UAT wrap bug). A cap and a floor are information, not outcomes: no colour. */}
      <p className="mt-3 flex min-h-5 items-start gap-1 text-sm text-muted-foreground">
        {capped ? (
          <>
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              At <span className="font-mono tabular-nums">{bet}</span> ZP, multipliers above{" "}
              <span className="font-mono tabular-nums">{Math.floor(MAX_PAYOUT / bet)}×</span> pay the{" "}
              {MAX_PAYOUT.toLocaleString()} ZP cap.
            </span>
          </>
        ) : netZero ? (
          // No Lock icon here, deliberately — Lock is the cap's mark across three shipped
          // surfaces, and a rounding floor is not a ceiling.
          <span>
            At <span className="font-mono tabular-nums">{bet}</span> ZP, a win at{" "}
            <span className="font-mono tabular-nums">{multiplier.toFixed(4)}×</span> pays back your stake and
            nothing more.
          </span>
        ) : null}
      </p>
    </div>
  )
}

// ponytail: deliberately cut and never added — a `locked`/dimmed prop (see header comment); copy
// for a clamped field, a pinned thumb or an exact hit (the control's own behaviour is already the
// message); a board-level "You won"/"You lost" banner; ±0.01 steppers (arrow keys already give
// this, chips cover the common asks); a sixth "1.01×" chip; a "recent rolls" strip; any
// globals.css change; any new dependency, token, type size or primitive.
