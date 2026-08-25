"use client"

// AviaSky — the 2D flight board (16-03-PLAN.md).
// Presentational only, mirroring plinko-board.tsx's and chicken-road.tsx's own header comments:
// this file derives every pixel from `steps` alone and is structurally incapable of rendering a
// mid-round answer, because the server never hands `steps` a value until the round is SETTLED
// (16-02's router settles before responding). This file imports NOTHING from fairness.ts and
// never imports playAviaRound/deriveAviamasters — `steps` is the only source it has, and it is
// handed the answer. AVIA_MODEL/AVIA_STEPS below are LAYOUT constants only (altitude ceiling,
// track length), never derivation.
//
// MOTION IS UNCONDITIONAL. There is no prefers-reduced-motion branch in this file and there must
// never be one again: iOS Low Power Mode and Android battery saver both report reduce, which made
// the games look broken on a merely low battery (a user decision, recorded in globals.css's
// reduced-motion block). CasinoShell's `.game-motion` class already exempts this subtree from the
// global CSS freeze, so nothing here needs to gate in JS either.
//
// Every DECORATION is keyed on the step index and nothing else — never `landed`, never
// `multiplier`, never the round's floats. An outcome-keyed decoration is a tell. The only motion
// allowed to read `landed` is the ENDING itself, which by definition plays after the answer is
// already on screen.

import * as React from "react"
import { Plane, TrendingDown } from "lucide-react"
import type { AviaEvent, AviaStep } from "@/lib/casino/aviamasters"
import { AVIA_MODEL, AVIA_STEPS } from "@/lib/casino/aviamasters"
import { cn } from "@/lib/utils"

// Geometry (16-RESEARCH.md § Pattern 4 — chicken-road.tsx's verified arithmetic: GameDialog
// content is 328px at a 360px viewport):
//   STEP_W = 56px -> ~5.9 of the 16 steps visible. The full track moves by ONE container
//   `translateX`, never document overflow (horizontal scroll is banned, 10-UI-SPEC.md).
const STEP_W = 56
// The plane is pinned at PLANE_X, CENTRED (not left-edge) — chicken-road.tsx documents that
// exact correction for its own sprite.
const PLANE_X = 100
const PLANE_ICON_PX = 24
const SKY_H = 170

// OFFICIAL (BGaming) — the Counter Balance starts at x1.00, the stake itself.
const START_COUNTER = 1

function formatCounter(c: number): string {
  return `${c.toFixed(2)}×`
}

// Native DOM text for every label — one of the decisive reasons this board is CSS/DOM (see the
// header comment): text scales and respects OS font settings for free (16-RESEARCH § Pattern 4).
function eventLabel(event: AviaEvent): React.ReactNode {
  switch (event.kind) {
    case "add":
      return `+${event.value}`
    case "mul":
      return `×${event.value}`
    case "rocket":
      return <TrendingDown className="mx-auto h-3.5 w-3.5" aria-hidden="true" />
    default:
      // drop/level render nothing but empty sky, per plan.
      return null
  }
}

// Decorative pickups the plane flies PAST and misses (16-RESEARCH § Pattern 3 — the single
// highest-value visual note in that document). The model collects only 0.57 pickups per round,
// which would look visually empty; this backfills the screen with a field the plane never
// touches. A PURE function of the step index alone — never the round's floats, never `landed`,
// never `multiplier`, never a runtime random source. An outcome-keyed decoration is a tell:
// chicken-road.tsx's carDurationMs comment says exactly this about its own cars, and the same
// reasoning applies here verbatim.
function decorPickups(stepIndex: number): { offset: number; y: number }[] {
  const count = (stepIndex * 5) % 3
  return Array.from({ length: count }, (_, i) => ({
    offset: 14 + ((stepIndex * 31 + i * 19) % 28),
    y: 15 + ((stepIndex * 17 + i * 41) % 55),
  }))
}

// Drifting background clouds. A fixed literal list, not a function of anything about the round —
// same rule as decorPickups: nothing on this board may be keyed on the outcome. They sit behind
// the camera track and never move with it, which is what sells depth on a 56px-per-step board.
// `depth` is the parallax rank: 0 = far/slow/faint, 1 = near/fast/solid.
const CLOUDS: { left: number; top: number; w: number; h: number; durationMs: number; depth: number }[] = [
  { left: 70, top: 12, w: 46, h: 12, durationMs: 34000, depth: 0.55 },
  { left: 95, top: 34, w: 34, h: 9, durationMs: 46000, depth: 0.35 },
  { left: 40, top: 22, w: 54, h: 14, durationMs: 22000, depth: 1 },
  { left: 120, top: 48, w: 28, h: 8, durationMs: 40000, depth: 0.45 },
]

// Deterministic per-decoration bob phase — the chicken-road.tsx carDurationMs/carDelayMs idiom,
// never a value pulled from the runtime's random source on every render (which would restart
// every bob on every state change).
function decorBobMs(stepIndex: number, i: number): number {
  return 1800 + ((stepIndex * 613 + i * 271) % 900)
}
function decorBobDelayMs(stepIndex: number, i: number, durationMs: number): number {
  return -((stepIndex * 887 + i * 131) % durationMs)
}

// Continuous fraction, never twelve discrete 14px altitude bands — the plane sits anywhere on
// the line (16-RESEARCH § Pattern 4).
function altitudeFraction(altitude: number): number {
  return Math.max(0, Math.min(1, altitude / AVIA_MODEL.altMax))
}

// Nose attitude in degrees. -12deg is the cruise rest angle (the lucide Plane glyph already
// points up-and-right, so "more negative" reads as "nose up"). Derived ONLY from the delta
// between the previous and the current REVEALED altitude, so it can never lead the reveal.
function bankDegrees(dAlt: number): number {
  return -12 - Math.max(-16, Math.min(16, dAlt * 7))
}

export function AviaSky({
  steps,
  shownStep,
  landed,
}: {
  /** The settled round's full trace, or null before the first round of the session. */
  steps: AviaStep[] | null
  /** How many entries of `steps` have been revealed so far — the container drives this on a
   *  timer at AVIA_SPEED_MS[speed] per tick. 0 means the flight has not started. */
  shownStep: number
  /** null until the flight ends; true = carrier, false = water. */
  landed: boolean | null
}) {
  // The last REVEALED step (or the pre-flight start state) is what the plane and the counter
  // header display — never a step ahead of `shownStep`, which would pre-reveal the round.
  const currentIndex = shownStep - 1
  const currentStep: AviaStep | null = steps !== null && currentIndex >= 0 ? steps[currentIndex] : null
  const prevStep: AviaStep | null = steps !== null && currentIndex >= 1 ? steps[currentIndex - 1] : null
  const altitude = currentStep?.altitude ?? AVIA_MODEL.altStart
  const prevAltitude = prevStep?.altitude ?? AVIA_MODEL.altStart
  const counter = currentStep?.counter ?? START_COUNTER
  const prevCounter = prevStep?.counter ?? START_COUNTER
  const cameraOffsetX = PLANE_X - STEP_W / 2 - shownStep * STEP_W
  const bottomPct = 10 + altitudeFraction(altitude) * 70
  const flying = landed === null
  const event = currentStep?.event.kind ?? null
  // The tick direction of the counter header. Both values are ALREADY on screen by the time this
  // is read — this is a reaction to the reveal, not a preview of it.
  const counterDelta = counter - prevCounter

  return (
    <div className="flex flex-col gap-2">
      {/* Counter Balance — the FOCAL element, not the plane (16-RESEARCH § Mobile / The
          spectator problem: a round with no decisions is passive, and the number is what the
          user actually cares about). Fixed-height header strip so digits changing never shifts
          the sky below. aria-live fires on the FINAL value only — announcing every tick would
          flood a screen reader, and it lives on the WRAPPER because the value span itself is
          remounted per step (keyed) to restart its tick animation. */}
      <div
        className="flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/50"
        aria-live={landed !== null ? "polite" : "off"}
      >
        {/* The tick. The TEXT never tweens — Gate C of the mobile UAT asserts that every sample
            of this readout is one of the discrete step values, and an odometer would break that
            (and would make the number harder to read at 260ms/step). What ticks is the frame
            around it: a scale pulse tinted emerald on a gain and amber on a rocket's halving. */}
        <span
          key={`${shownStep}:${counter}`}
          className={cn(
            "animate-[avia-tick_260ms_var(--ease-out-quint)] font-mono text-2xl font-semibold tabular-nums",
            counterDelta > 0 && "text-emerald-600 dark:text-emerald-400",
            counterDelta < 0 && "text-amber-600 dark:text-amber-500",
          )}
        >
          {formatCounter(counter)}
        </span>
      </div>

      <div
        data-testid="avia-sky"
        role="img"
        aria-label={
          landed === null
            ? `Flying. Balance ${formatCounter(counter)}.`
            : landed
              ? `Landed on the carrier at ${formatCounter(counter)}.`
              : "Went down in the water. Lost the stake."
        }
        className="relative w-full overflow-hidden rounded-md border bg-muted/20"
        style={{ height: SKY_H }}
      >
        {/* Sky wash — a value gradient, not a hue. This design system is crimson-and-neutral with
            no blue token, so sky and sea are separated by lightness rather than by inventing a
            colour. Purely decorative, behind everything. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-muted-foreground/10 to-transparent"
        />

        {/* One shared keyframe set for the whole board — durations/delays vary per element via
            inline style, so only one declaration of each is ever needed. Kept local to this file
            (a plain style element, zero new dependency), matching chicken-road.tsx's precedent
            rather than growing globals.css. Everything below animates transform/opacity only. */}
        <style>{`
          @keyframes avia-bob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
          }
          @keyframes avia-drift {
            from { transform: translateX(12%); }
            to { transform: translateX(-140%); }
          }
          /* The plane's idle. Two out-of-phase components (rise/fall and a slow roll) so the
             loop never reads as a metronome. */
          @keyframes avia-idle {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            30% { transform: translateY(-3px) rotate(1.2deg); }
            65% { transform: translateY(2px) rotate(-1deg); }
          }
          /* 2D propeller: a disc seen edge-on, so scaling X to nothing and back IS the spin. */
          @keyframes avia-prop {
            0%, 100% { transform: scaleX(1); opacity: 0.9; }
            50% { transform: scaleX(0.12); opacity: 0.45; }
          }
          @keyframes avia-trail {
            0%, 100% { transform: scaleX(0.6); opacity: 0.25; }
            50% { transform: scaleX(1); opacity: 0.5; }
          }
          @keyframes avia-wave {
            from { transform: translateX(0); }
            to { transform: translateX(-50%); }
          }
          @keyframes avia-tick {
            from { transform: scale(0.94); }
            to { transform: scale(1); }
          }
          /* A collected pickup pops toward the viewer and lifts away. */
          @keyframes avia-collect {
            0% { transform: scale(0.7) translateY(4px); opacity: 0; }
            45% { transform: scale(1.25) translateY(-2px); opacity: 1; }
            100% { transform: scale(1) translateY(-6px); opacity: 1; }
          }
          /* The rocket's beat: a hard shove down, no bounce back up. Losses do not celebrate. */
          @keyframes avia-rocket {
            0% { transform: scale(1.3) translateY(-6px); opacity: 0; }
            35% { transform: scale(1) translateY(2px); opacity: 1; }
            55% { transform: scale(1) translateX(-3px); }
            75% { transform: scale(1) translateX(3px); }
            100% { transform: scale(1) translateY(0); opacity: 1; }
          }
          /* The burst the plane leaves behind at the moment of contact. */
          @keyframes avia-burst {
            from { transform: scale(0.4); opacity: 0.55; }
            to { transform: scale(2.4); opacity: 0; }
          }
          /* Carrier arrival: level out, settle onto the deck, done. */
          @keyframes avia-arrive {
            0% { transform: translateY(-6px) scale(1.04); }
            60% { transform: translateY(2px) scale(1); }
            100% { transform: translateY(0) scale(1); }
          }
          /* Water: falls out of the sky and keeps going under. Slow, not violent. */
          @keyframes avia-ditch {
            from { transform: translateY(0); opacity: 1; }
            to { transform: translateY(26px); opacity: 0.35; }
          }
          @keyframes avia-splash {
            from { transform: scale(0.3); opacity: 0.5; }
            to { transform: scale(2.6); opacity: 0; }
          }
        `}</style>

        {/* Drifting clouds — index-keyed like every other decoration in this file, so they can
            never encode the outcome. `depth` gives real parallax: the far ones crawl and sit at
            a third of the opacity, the near one crosses the board in 22s. */}
        {CLOUDS.map((c, ci) => (
          <span
            key={ci}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full bg-muted-foreground/10 blur-[1px]"
            style={{
              left: `${c.left}%`,
              top: `${c.top}%`,
              width: c.w,
              height: c.h,
              opacity: 0.35 + c.depth * 0.65,
              animationName: "avia-drift",
              animationDuration: `${c.durationMs}ms`,
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationDelay: `${-c.durationMs / (ci + 2)}ms`,
            }}
          />
        ))}

        {/* Sea — the fixed altitude-0 horizon the plane dips into on a water crash. Two wave
            layers, each a 2x-wide SVG carrying two copies of the same 120-unit wave and sliding
            exactly half its width, so the loop is seamless. Different speeds and offsets give the
            edge a swell rather than a slosh. */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-8 bg-muted-foreground/15">
          {[
            { durationMs: 5200, className: "-top-2 text-muted-foreground/10", delayMs: 0 },
            { durationMs: 7600, className: "-top-1.5 text-muted-foreground/15", delayMs: -2600 },
          ].map((w, wi) => (
            <svg
              key={wi}
              className={cn("absolute left-0 h-2 w-[200%]", w.className)}
              viewBox="0 0 240 8"
              preserveAspectRatio="none"
              style={{
                animationName: "avia-wave",
                animationDuration: `${w.durationMs}ms`,
                animationTimingFunction: "linear",
                animationIterationCount: "infinite",
                animationDelay: `${w.delayMs}ms`,
              }}
            >
              <path
                d="M0 8 V4 Q10 0 20 4 T40 4 T60 4 T80 4 T100 4 T120 4 T140 4 T160 4 T180 4 T200 4 T220 4 T240 4 V8 Z"
                className="fill-current"
              />
            </svg>
          ))}
        </div>

        {/* The track slides; the plane (below) never moves. One transform-only camera, matching
            chicken-road.tsx — no scroll container, since CasinoShell's board region is never
            horizontally scrollable. The 200ms transition duration is intentionally fixed and
            independent of the container's per-step speed: this component only animates between
            two already-decided states, exactly as chicken-road.tsx's camera does regardless of
            its own step cadence — AviaSky is never handed a speed prop. */}
        <div
          className="absolute inset-y-0 left-0 flex transition-transform duration-200 ease-out"
          style={{ transform: `translateX(${cameraOffsetX}px)` }}
        >
          {Array.from({ length: AVIA_STEPS }, (_, i) => {
            const step: AviaStep | null = steps !== null && i < shownStep && i < steps.length ? steps[i] : null
            const decor = decorPickups(i)
            const isRocket = step?.event.kind === "rocket"
            const isPickup = step?.event.kind === "add" || step?.event.kind === "mul"
            return (
              <div key={i} className="relative h-full w-[56px] shrink-0">
                {step && (
                  <div
                    className={cn(
                      "absolute left-1/2 -translate-x-1/2 font-mono text-xs font-medium tabular-nums",
                      // Each label mounts exactly once, when its step is revealed, so a
                      // fill-forwards one-shot animation is the whole collect moment — no state,
                      // no timers, no cleanup.
                      isPickup &&
                        "animate-[avia-collect_380ms_var(--ease-out-quint)_both] text-emerald-600 dark:text-emerald-400",
                      isRocket && "animate-[avia-rocket_420ms_var(--ease-out-quint)_both] text-amber-600 dark:text-amber-500",
                    )}
                    style={{ bottom: `${10 + altitudeFraction(step.altitude) * 70}%` }}
                  >
                    {eventLabel(step.event)}
                  </div>
                )}
                {decor.map((d, di) => {
                  const durationMs = decorBobMs(i, di)
                  return (
                    <span
                      key={di}
                      aria-hidden="true"
                      className="absolute h-1.5 w-1.5 rounded-full bg-muted-foreground/30"
                      style={{
                        left: d.offset,
                        bottom: `${d.y}%`,
                        animationName: "avia-bob",
                        animationDuration: `${durationMs}ms`,
                        animationTimingFunction: "ease-in-out",
                        animationIterationCount: "infinite",
                        animationDelay: `${decorBobDelayMs(i, di, durationMs)}ms`,
                      }}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* The plane — pinned at PLANE_X, centred (not left edge). Three nested transforms that
            must never fight over one `transform` property:
              outer  = position + the altitude/ending translate
              idle   = the infinite bob (and the ending's arrive/ditch one-shot, which replaces it)
              bank   = the nose attitude, transitioned between two revealed altitudes */}
        <div
          className="absolute z-10 transition-[bottom] duration-200 ease-out"
          style={{ left: PLANE_X - PLANE_ICON_PX / 2, bottom: `${bottomPct}%` }}
        >
          <div
            className={cn(
              flying && "animate-[avia-idle_2600ms_ease-in-out_infinite]",
              landed === true && "animate-[avia-arrive_var(--duration-settle)_var(--ease-out-quint)_both]",
              landed === false && "animate-[avia-ditch_700ms_ease-in_both]",
            )}
          >
            {/* 78deg on a ditch, not 42: the lucide Plane glyph already points up-and-right at
                rest, so 42 only brings it back to level (verified on the Gate E screenshot). */}
            <div
              className="relative transition-transform duration-200 ease-out"
              style={{ transform: `rotate(${landed === false ? 78 : landed === true ? 0 : bankDegrees(altitude - prevAltitude)}deg)` }}
            >
              {/* Motion trail — a streak the plane drags, only while it is actually flying. */}
              {flying && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-full top-1/2 h-[2px] w-5 origin-right -translate-y-1/2 rounded-full bg-gradient-to-l from-foreground/40 to-transparent animate-[avia-trail_900ms_ease-in-out_infinite]"
                />
              )}
              <Plane className="h-6 w-6 text-foreground" aria-hidden="true" />
              {/* Propeller disc at the nose (the lucide glyph points up-right, so the nose is the
                  top-right corner). Edge-on scaleX IS the spin — 110ms reads as a blur. */}
              {flying && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-0.5 top-0 h-3 w-[3px] rounded-full bg-foreground/70 animate-[avia-prop_110ms_linear_infinite]"
                />
              )}
            </div>
          </div>

          {/* The contact burst. Mounted keyed on the step index, so a new one plays on every
              step that lands a pickup or a rocket — emerald for a gain, amber for the halving. */}
          {flying && (event === "add" || event === "mul" || event === "rocket") && (
            <span
              key={shownStep}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 animate-[avia-burst_460ms_var(--ease-out-quint)_both]",
                event === "rocket" ? "border-amber-500" : "border-emerald-500",
              )}
            />
          )}
        </div>

        {/* Water crash: rings spreading on the surface at the plane's column. The ending, not a
            decoration — it plays only once `landed` is already announced above. */}
        {landed === false && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-6 h-4 w-10 -translate-x-1/2 rounded-[50%] border-2 border-muted-foreground/40 animate-[avia-splash_700ms_var(--ease-out-quint)_400ms_both]"
            style={{ left: PLANE_X }}
          />
        )}

        {/* Carrier deck: slides up under the plane as it arrives, so a landing is somewhere the
            plane ARRIVES rather than a place where the animation simply stops. */}
        {landed === true && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-1 w-16 -translate-x-1/2 rounded-full bg-emerald-500/60 animate-[avia-tick_var(--duration-settle)_var(--ease-out-quint)_both]"
            style={{ left: PLANE_X, bottom: `calc(${bottomPct}% - 4px)` }}
          />
        )}
      </div>
    </div>
  )
}
