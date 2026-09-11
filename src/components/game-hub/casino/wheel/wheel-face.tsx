"use client"

// WheelFace — the conic-gradient ring, the fixed 12-o'clock pointer, and the hub readout
// (14-RESEARCH.md § Pattern 4). Presentational only: owns no bet state, makes no tRPC call.
//
// The ring carries NO segment labels at any segment count — at 50 segments a rim arc is
// ~17.6px against a ~24px label. One rendering path for all five counts (14-RESEARCH § Mobile
// Sizing Arithmetic). The distinct-multiplier legend in WheelControls is what satisfies WHEL-01.
//
// The hub is an opaque bg-background disc that doubles as the gradient's centre mask — no
// mask-image is needed. It does not rotate, so the readout inside it stays upright.
//
// MOTION IS NEVER GATED HERE. There is no `motion-reduce:` utility and no matchMedia read in
// this subtree, by design: CasinoShell carries `.game-motion`, which opts the casino out of the
// global prefers-reduced-motion rule (globals.css) because iOS Low Power Mode and Android
// battery saver both report `reduce` — a wheel that snaps to its answer on a phone that is
// merely low on battery has nothing left to show. Do not re-add either.
//
// The spin animates TO a result that is already known: wheel.tsx has the server's segment index
// before any motion starts and converts it to an absolute angle via landingRotation(). Nothing
// in this file can change where the wheel stops.

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { WHEEL_TABLES, type WheelRisk } from "@/lib/casino/wheel"
import { cn } from "@/lib/utils"

const RISK_LABELS: Record<WheelRisk, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" }

/** The spin phases. `windup` is the short counter-rotation that gives the wheel mass — a heavy
 *  thing is pulled back before it is let go. It moves the ring BACKWARDS from its resting angle
 *  and is not part of the landing arithmetic: the release below still targets the exact absolute
 *  angle landingRotation() returned, so the ring's final resting value is untouched by it. */
export type WheelPhase = "idle" | "windup" | "spin"

export const WHEEL_WINDUP_MS = 220
export const WHEEL_SPIN_MS = 3400
export const WHEEL_WINDUP_DEG = 14

// Near-linear off the release, then a very long tail — the wheel leaves fast and dies slowly,
// which is what reads as mass. --ease-out-quint (used for the settle beats below) front-loads far
// too hard for a 3.4s arc: it spends its last two seconds barely moving.
const SPIN_EASE = "cubic-bezier(0.1, 0.62, 0.06, 1)"

const PHASE_TRANSITION: Record<WheelPhase, { ms: number; ease: string }> = {
  idle: { ms: 0, ease: "linear" },
  windup: { ms: WHEEL_WINDUP_MS, ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
  spin: { ms: WHEEL_SPIN_MS, ease: SPIN_EASE },
}

// The rank-based alpha ramp (14-RESEARCH § Pattern 5). Duplicated in wheel-controls.tsx (not
// exported/shared) — a segment and its legend chip must read as the same colour, and the two
// files are otherwise independent, mirroring plinko-board.tsx/plinko-controls.tsx's precedent.
const PAY_HEX = "#059669" // emerald-600 — this segment pays you back at least your stake
const LOSE_HEX = "#B45309" // destructive amber — this segment costs you your stake
const ZERO_ALPHA = 0.25

function hexToRgba(hex: string, alpha: number): string {
  const int = Number.parseInt(hex.slice(1), 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** rank over the SORTED ASCENDING DISTINCT NON-ZERO multipliers of the current table — the ramp
 *  must span whatever range the current config happens to have. */
function payAlpha(rank: number, distinct: number): number {
  return distinct === 1 ? 0.6 : 0.2 + 0.4 * (rank / (distinct - 1))
}

export function WheelFace({
  segments,
  risk,
  rotation,
  phase,
  landedMultiplier,
}: {
  segments: number
  risk: WheelRisk
  rotation: number
  phase: WheelPhase
  landedMultiplier: number | null
}) {
  const table = WHEEL_TABLES[risk][segments]
  const theta = 360 / segments

  const stops = React.useMemo(() => {
    const distinct = [...new Set(table.filter((m) => m > 0))].sort((a, b) => a - b)
    const colorFor = (m: number) =>
      m === 0
        ? hexToRgba(LOSE_HEX, ZERO_ALPHA)
        : hexToRgba(PAY_HEX, payAlpha(distinct.indexOf(m), distinct.length))
    const th = 360 / segments
    return table.map((m, i) => `${colorFor(m)} ${i * th}deg ${(i + 1) * th}deg`).join(", ")
  }, [table, segments])

  // --- The pointer tick. One rAF loop while the wheel is in motion: it samples the ring's REAL
  // composited angle, notices when a new segment has crossed under the 12-o'clock pointer, and
  // kicks the pointer back a few degrees, decaying every frame. The tick therefore spaces itself
  // out on its own as the wheel decelerates — no tick-rate schedule to keep in sync with the
  // easing curve, and nothing here reads or affects the outcome. One element, transform only. ---
  const ringRef = React.useRef<HTMLDivElement>(null)
  const pointerRef = React.useRef<SVGSVGElement>(null)

  React.useEffect(() => {
    if (phase === "idle") return
    const th = 360 / segments
    let deflect = 0
    let lastIndex = -1
    const pointerAtStart = pointerRef.current
    let raf = requestAnimationFrame(function tick() {
      const ring = ringRef.current
      const pointer = pointerRef.current
      if (!ring || !pointer) return
      const t = getComputedStyle(ring).transform
      if (t && t !== "none") {
        const m = new DOMMatrixReadOnly(t)
        const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI
        const index = Math.floor(((((-angle % 360) + 360) % 360) / th) % segments)
        if (lastIndex !== -1 && index !== lastIndex) deflect = -16
        lastIndex = index
      }
      deflect *= 0.82
      pointer.style.transform = `translateX(-50%) rotate(${deflect.toFixed(2)}deg)`
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (pointerAtStart) pointerAtStart.style.transform = "translateX(-50%)"
    }
  }, [phase, segments])

  const { ms, ease } = PHASE_TRANSITION[phase]

  const ariaLabel =
    `${segments}-segment wheel, ${RISK_LABELS[risk]} risk` +
    (landedMultiplier !== null ? `, landed ${landedMultiplier}×` : "")

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative mx-auto aspect-square w-full max-w-[280px]"
    >
      <style>{`
        @keyframes wheel-segment-flash {
          0%   { opacity: 0; }
          18%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes wheel-hub-pop {
          0%   { transform: scale(0.82); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* the ring — the ONLY element that rotates */}
      <div
        ref={ringRef}
        className="absolute inset-0 rounded-full will-change-transform"
        style={{
          background: `conic-gradient(from 0deg, ${stops})`,
          transform: `rotate(${rotation}deg)`,
          transitionProperty: "transform",
          transitionDuration: `${ms}ms`,
          transitionTimingFunction: ease,
        }}
      />

      {/* The landing flash — a single wedge exactly theta wide, centred on 12 o'clock, i.e. the
          segment now sitting under the pointer. It does not rotate with the ring because it does
          not have to: by the time it mounts, the winning segment IS the one at the top. */}
      {landedMultiplier !== null && (
        <div
          aria-hidden="true"
          // opacity-0 is the RESTING state, not a starting one: the animation carries no
          // fill-mode, so the wedge reverts to this the moment the flash is over. Without it the
          // winning wedge stays lit until the next spin.
          className="pointer-events-none absolute inset-0 rounded-full opacity-0 [animation:wheel-segment-flash_700ms_var(--ease-out-quint)]"
          style={{
            background: `conic-gradient(from ${-theta / 2}deg, color-mix(in srgb, var(--foreground) 60%, transparent) 0deg ${theta}deg, transparent ${theta}deg 360deg)`,
          }}
        />
      )}

      {/* hub — opaque disc, doubles as the gradient's centre mask. Does not rotate, so the
          readout stays upright. */}
      <div className="absolute inset-[21%] flex flex-col items-center justify-center rounded-full bg-background">
        {landedMultiplier !== null ? (
          <span
            className={cn(
              "font-mono text-[20px] font-semibold tabular-nums",
              "[animation:wheel-hub-pop_320ms_var(--ease-out-quint)]",
              landedMultiplier > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {landedMultiplier}×
          </span>
        ) : (
          <>
            <span className="font-mono text-sm tabular-nums text-foreground">{segments}</span>
            <span className="text-xs text-muted-foreground">{RISK_LABELS[risk]}</span>
          </>
        )}
      </div>

      {/* pointer — fixed at 12 o'clock, hinged at its top so it deflects like a needle each time
          a segment crosses under it (driven by the rAF loop above, transform only) */}
      <ChevronDown
        ref={pointerRef}
        className="absolute left-1/2 top-0 h-5 w-5 origin-top text-foreground"
        style={{ transform: "translateX(-50%)" }}
        aria-hidden="true"
      />
    </div>
  )
}
