"use client"

// SequenceRecallGame — the board's presentational + local-choreography half. This
// component owns rendering and its own on-screen timing only (blink windows, the
// countdown readout, the go-cue flash) — every ZP decision, tap-correctness check
// and round-timing authority lives in the router, and this component never scores
// anything itself. `tier`/`round`/`zpEarned` are only ever written from a server
// response (plan 08 wires that call), never advanced optimistically.
//
// Modeled on minezweeper.tsx's real-<button>-per-cell rendering (aria-label
// composed from position + state, the inset-bevel box-shadow, the inherited focus
// ring) and zross-game.tsx's game-component prop-contract shape (callback props,
// no tRPC inside the component).

import { useEffect, useRef, useState } from "react"
import confetti from "canvas-confetti"
import { cn } from "@/lib/utils"
import {
  GRID_SIZE,
  TILE_COUNT,
  WINDOW_MS,
  GO_CUE_MS,
  BLINK_ON_MS,
  BLINK_GAP_MS,
  TIER_BANNER_MS,
} from "./constants"
import { targetForRound } from "./engine"
import { fireTierCelebration } from "./confetti"

type TileState = "idle" | "on" | "off" | "correct" | "wrong"
// "resolving" covers the gap between the last tap (or the countdown hitting zero)
// and the server's verdict landing — input is already disabled and the countdown
// display is frozen, but it isn't a fresh "playback" or "input" state either.
type Phase = "ready" | "playback" | "input" | "resolving"

export type SubmitRoundResult = {
  correct: boolean
  reason: "wrong" | "timeout" | "tooFast" | null
  tier: number
  round: number
  zpEarned: number
  tierCleared: boolean
  runEnded: boolean
}

export type SequenceRecallGameProps = {
  seed: number
  startTier: number
  startRound: number
  onBeginRound: (tier: number, round: number) => Promise<void>
  onSubmitRound: (tier: number, round: number, taps: number[]) => Promise<SubmitRoundResult>
  onEnd: (outcome: { reason: "wrong" | "timeout" | "tooFast" }) => void
}

// The three server-driven stat chips (§4) all share this class string —
// 21-UI-SPEC.md's locked chip shape, matching MineZweeper's mine-counter chip.
const CHIP_CLASS = "rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums"

export function SequenceRecallGame(props: SequenceRecallGameProps) {
  const [tileStates, setTileStates] = useState<TileState[]>(() =>
    Array.from({ length: TILE_COUNT }, (): TileState => "idle"),
  )
  const [boardShake, setBoardShake] = useState(false)

  // HUD stat chips — seeded from props, written only from a server response
  // from here on (this game's whole premise is server-authoritative
  // correctness; the HUD must never show a tier/round/ZP value the server
  // hasn't actually granted). setTier/setRound/setZpEarned are called from
  // exactly one place after mount: applyVerdict, straight off submitRound's
  // response — never incremented locally.
  const [tier, setTier] = useState(props.startTier)
  const [round, setRound] = useState(props.startRound)
  const [zpEarned, setZpEarned] = useState(0)

  // Phase-dependent status area + countdown.
  const [phase, setPhase] = useState<Phase>("ready")
  const [inputEnabled, setInputEnabled] = useState(false)
  const [remainingMs, setRemainingMs] = useState(WINDOW_MS)
  const [showGoCue, setShowGoCue] = useState(false)
  // Display-only stamp for the countdown readout. The server's own
  // `roundInputStartedAt` is the sole timing authority — this value is never
  // sent anywhere and must never be treated as the deadline, only an
  // approximation of it for the player.
  const armedAtRef = useRef(0)

  // The client's own derivation of the current round's target sequence — used
  // ONLY to drive the blink playback and to give instant, cosmetic tap
  // feedback. The server independently re-derives the identical array from the
  // run's own seed and is the only side whose verdict actually counts.
  const targetRef = useRef<number[]>([])
  // This round's taps so far, in order — the untrusted buffer batch-submitted
  // exactly once per round. Anything the player does with the DOM is
  // untrusted; this array is only ever an argument to onSubmitRound.
  const tapsRef = useRef<number[]>([])
  // Guards submitCurrentRound to fire at most once per round (tap-completion,
  // a mismatch and the countdown reaching zero can all race to trigger it).
  const submittedRef = useRef(false)

  // Tier-clear celebration: the board container owns both the scoped confetti
  // canvas and the "Tier N" banner overlay. `bannerTier` is non-null only for
  // the banner's JS-owned dwell window (TIER_BANNER_MS) — the pop-in/out is a
  // pure restatement, since the always-current HUD Tier chip above already
  // carries the authoritative value.
  const boardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const confettiRef = useRef<confetti.CreateTypes | null>(null)
  const [bannerTier, setBannerTier] = useState<number | null>(null)

  // The component owns the canvas instance (Phase 18-01 division of
  // responsibility) — created against its own scoped canvas element, reset on
  // cleanup, same lifecycle chest-reveal.tsx already uses.
  useEffect(() => {
    if (!canvasRef.current) return
    const instance = confetti.create(canvasRef.current, { resize: true, useWorker: true })
    confettiRef.current = instance
    return () => {
      instance.reset()
      confettiRef.current = null
    }
  }, [])

  // Every JS timer this component schedules (blink on/off steps, the
  // beginRound-call-on-playback-finish step, the beginRound retry backoff and
  // the go-cue hide) lives here so a fresh round or an unmount can sweep all of
  // them in one place — the countdown interval is deliberately NOT tracked
  // here; it already has its own effect-scoped cleanup keyed on `phase` below.
  const timersRef = useRef<number[]>([])
  function addTimer(id: number) {
    timersRef.current.push(id)
  }
  function clearAllTimers() {
    for (const id of timersRef.current) {
      window.clearTimeout(id)
    }
    timersRef.current = []
  }

  // JS-driven countdown tick (§4) — a plain interval, not a CSS animation, so
  // there is nothing for the OS's reduced-motion setting to collapse. Reaching zero
  // submits whatever taps exist so far, turning a no-answer round into a
  // server-classified timeout instead of a hang. Changing `phase` away from
  // "input" (which submitCurrentRound does) unmounts this effect, which is
  // what actually clears the interval.
  useEffect(() => {
    if (phase !== "input") return
    const id = window.setInterval(() => {
      const elapsed = Date.now() - armedAtRef.current
      const remaining = Math.max(0, WINDOW_MS - elapsed)
      setRemainingMs(remaining)
      if (remaining <= 0) {
        void submitCurrentRound()
      }
    }, 100)
    return () => window.clearInterval(id)
    // submitCurrentRound is a plain (unmemoized) function re-created each
    // render; the interval only needs the closure captured when this effect
    // starts (i.e. the moment the round armed), not a live reference to the
    // newest render's copy — the same reasoning plinko-board.tsx's timer
    // effect already documents for this rule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Arms the input window: stamps armedAtRef, flips phase, enables input and
  // fires the "go" cue flash on the grid container. Called by
  // beginRoundWithRetry once the server has acked beginRound — the client's
  // countdown must never start before the server's clock does.
  function armWindow() {
    armedAtRef.current = Date.now()
    setPhase("input")
    setInputEnabled(true)
    setRemainingMs(WINDOW_MS)
    setShowGoCue(true)
    addTimer(window.setTimeout(() => setShowGoCue(false), GO_CUE_MS))
  }

  // Calls the server's beginRound exactly when blink playback has finished.
  // Retries once after a 1s backoff on rejection; if the retry also fails,
  // hands off via onEnd rather than surfacing an error dialog — matching the
  // codebase's existing "retry once, then let the server sweep and the next
  // getStatus reconcile" convention (see zross.tsx's handleEnd).
  async function beginRoundWithRetry(t: number, r: number, isRetry: boolean): Promise<void> {
    try {
      await props.onBeginRound(t, r)
      armWindow()
    } catch (err) {
      if (!isRetry) {
        addTimer(
          window.setTimeout(() => {
            void beginRoundWithRetry(t, r, true)
          }, 1000),
        )
        return
      }
      console.warn("sequence-recall beginRound failed twice", err)
      props.onEnd({ reason: "timeout" })
    }
  }

  // Derives the round's target from the seed (client-side, for blink + cosmetic
  // feedback only), blinks it back tile by tile on JS-owned timers, then calls
  // onBeginRound once the last tile's OFF window closes and arms the window
  // only on that ack.
  function playRound(t: number, r: number) {
    clearAllTimers()
    const target = targetForRound(props.seed, t, r)
    targetRef.current = target
    tapsRef.current = []
    submittedRef.current = false

    setPhase("playback")
    setInputEnabled(false)
    setBoardShake(false)
    setTileStates(Array.from({ length: TILE_COUNT }, (): TileState => "idle"))

    let elapsed = 0
    target.forEach((tileIndex, i) => {
      addTimer(
        window.setTimeout(() => {
          setTileStates((prev) => {
            const next = [...prev]
            next[tileIndex] = "on"
            return next
          })
        }, elapsed),
      )
      elapsed += BLINK_ON_MS
      addTimer(
        window.setTimeout(() => {
          setTileStates((prev) => {
            const next = [...prev]
            next[tileIndex] = "off"
            return next
          })
        }, elapsed),
      )
      // Only wait the gap "before the next" tile — the last tile's OFF window
      // closing is itself the signal to call onBeginRound, with no trailing gap.
      if (i < target.length - 1) {
        elapsed += BLINK_GAP_MS
      }
    })

    addTimer(
      window.setTimeout(() => {
        void beginRoundWithRetry(t, r, false)
      }, elapsed),
    )
  }

  // Applies the server's verdict and nothing else — tier/round/zpEarned are
  // written here, from the response, and only here (after mount). The client
  // never scores a round, never advances the tier on its own and never
  // short-circuits on a local "success"; this is the single place a round's
  // outcome becomes real.
  function applyVerdict(res: SubmitRoundResult) {
    setTier(res.tier)
    setRound(res.round)
    setZpEarned(res.zpEarned)

    if (res.runEnded) {
      // Flash the failure: the offending tile (or every tile, when no tap was
      // made at all), then shake the board. Deferred ~600ms so the failure
      // frame lands before the parent swaps in the summary screen — the same
      // death-transition defer convention zross-game.tsx's frame() uses.
      setTileStates((prev) => {
        if (tapsRef.current.length === 0) {
          return prev.map((): TileState => "wrong")
        }
        const next = [...prev]
        next[tapsRef.current[tapsRef.current.length - 1]] = "wrong"
        return next
      })
      setBoardShake(true)
      addTimer(
        window.setTimeout(() => {
          props.onEnd({ reason: res.reason ?? "wrong" })
        }, 600),
      )
      return
    }

    if (res.tierCleared) {
      celebrateTierClear(res.tier, res.round)
      return
    }

    playRound(res.tier, res.round)
  }

  // Fires the scoped-canvas confetti burst + "Tier N" banner for clearing a
  // tier, then starts the NEXT round only after the banner's JS-owned dwell
  // time — so the next blink playback never begins underneath the
  // celebration. `nextTier`/`nextRound` are res.tier/res.round: the HUD chips
  // above already reflect them (written by applyVerdict before this runs),
  // so the banner is a pure restatement, not the sole source of that info.
  function celebrateTierClear(nextTier: number, nextRound: number) {
    const instance = confettiRef.current
    const boardEl = boardRef.current
    if (instance && boardEl) {
      const rect = boardEl.getBoundingClientRect()
      const origin = {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      }
      // The reduced-motion decision (disableForReducedMotion: true) lives
      // inside the confetti helper itself (21-UI-SPEC §7) — no second
      // reduced-motion check and no decorative-motion opt-out class here.
      fireTierCelebration(instance, nextTier, origin)
    }
    // Phase stays "resolving" (already set by submitCurrentRound) through the
    // banner's dwell — playRound below is what flips it to "playback" once
    // the next round's blink actually starts.
    setBannerTier(nextTier)
    addTimer(
      window.setTimeout(() => {
        setBannerTier(null)
        playRound(nextTier, nextRound)
      }, TIER_BANNER_MS),
    )
  }

  // Submits the round exactly once (submittedRef guards a tap-completion, a
  // mismatch and the countdown hitting zero from all racing to double-fire),
  // disables input and freezes the countdown display (changing `phase` away
  // from "input" is what actually clears the countdown interval above).
  async function submitCurrentRound(): Promise<void> {
    if (submittedRef.current) return
    submittedRef.current = true
    setInputEnabled(false)
    setPhase("resolving")
    await performSubmit(tier, round, tapsRef.current.slice(), false)
  }

  async function performSubmit(t: number, r: number, taps: number[], isRetry: boolean): Promise<void> {
    try {
      const res = await props.onSubmitRound(t, r, taps)
      applyVerdict(res)
    } catch (err) {
      const code = (err as { data?: { code?: string } } | null)?.data?.code
      if (code === "CONFLICT") {
        // The round already resolved server-side (a stale (tier, round) —
        // 21-RESEARCH.md Pitfall 2). Show no error text and end the run quietly.
        //
        // NOTE: this ENDS the run; it does not resume it. An earlier version of
        // this comment claimed the shell would "re-sync from getStatus", which was
        // never true and cannot be true as written — getStatus returns only day /
        // runs / balance fields and carries no run state (no seed, tier or round),
        // so there is nothing to resume from. Resuming a mid-flight run after a
        // dropped ack needs the server to expose the ACTIVE run's position, which
        // is a deliberate anti-cheat surface change and is tracked in
        // deferred-items.md rather than faked here.
        //
        // The cost of ending is bounded: `end` reads zpEarned from the DB, so every
        // round already banked is still paid and the score still counts on the
        // leaderboard. Only the in-progress run is lost.
        props.onEnd({ reason: "timeout" })
        return
      }
      if (!isRetry) {
        addTimer(
          window.setTimeout(() => {
            void performSubmit(t, r, taps, true)
          }, 1000),
        )
        return
      }
      // Network failure twice in a row — fail quiet, matching zross.tsx's
      // handleEnd retry convention: let the 5-minute server sweep and the
      // next getStatus refetch reconcile state rather than showing an error.
      console.warn("sequence-recall submitRound failed twice", err)
      props.onEnd({ reason: "timeout" })
    }
  }

  // Kicks off the very first round from props.startTier/props.startRound.
  // Deferred to a microtask so the state sync happens in a callback rather
  // than synchronously in the effect body (react-hooks/set-state-in-effect) —
  // the same idiom mines.tsx/chicken.tsx already use for resume adoption.
  useEffect(() => {
    queueMicrotask(() => {
      playRound(props.startTier, props.startRound)
    })
    // Mount-only: subsequent rounds are started directly by the round-result
    // handling below (plan 08 Task 2/3), not by re-running this effect — see
    // that code's own comment for why (the tier-clear celebration needs to
    // delay the next round's blink independently of when the HUD's tier/round
    // chips update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Full cleanup on unmount: every blink timer, the beginRound retry timer and
  // the go-cue timer (all tracked in timersRef); the countdown interval has its
  // own effect-scoped cleanup above.
  useEffect(() => {
    return () => clearAllTimers()
  }, [])

  // No early tap is ever recorded — an early tap during playback is silently
  // impossible since inputEnabled is false outside "input" (each tile is also
  // `disabled` below for the same reason). Local match/mismatch feedback is
  // cosmetic only: the server independently decides the round from the
  // batched submission below, and this handler never scores, never advances
  // the tier and never short-circuits the submission on a local "success".
  function handleTileClick(index: number) {
    if (!inputEnabled) return
    const nextTaps = [...tapsRef.current, index]
    tapsRef.current = nextTaps
    const expectedIndex = nextTaps.length - 1
    const isMatch = targetRef.current[expectedIndex] === index

    if (isMatch) {
      setTileStates((prev) => {
        const next = [...prev]
        next[index] = "correct"
        return next
      })
      addTimer(
        window.setTimeout(() => {
          setTileStates((prev) => {
            if (prev[index] !== "correct") return prev
            const next = [...prev]
            next[index] = "idle"
            return next
          })
        }, 150),
      )
    } else {
      setTileStates((prev) => {
        const next = [...prev]
        next[index] = "wrong"
        return next
      })
      setBoardShake(true)
    }

    // Submit on completion or on a mismatch; the countdown-zero case (a
    // timeout with whatever taps exist so far) is handled by the countdown
    // effect above. All three routes go through the same once-per-round
    // submitCurrentRound guard.
    if (!isMatch || nextTaps.length === targetRef.current.length) {
      void submitCurrentRound()
    }
  }

  // The countdown is only live once the server has armed the window; before that
  // (ready/playback) it is a frozen full-window placeholder that exists purely to
  // hold the row's height.
  const armed = phase === "input" || phase === "resolving"
  const shownMs = armed ? remainingMs : WINDOW_MS
  const urgent = armed && remainingMs <= 1500
  const statusLabel =
    phase === "ready"
      ? "Get ready\u2026"
      : phase === "playback"
        ? "Watch the pattern\u2026"
        : bannerTier !== null
          ? `Tier ${bannerTier} cleared`
          : "Your turn"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className={CHIP_CLASS}>{`Tier ${tier}`}</span>
        <span className={CHIP_CLASS}>{`Round ${round}`}</span>
        <span className={CHIP_CLASS}>{`${zpEarned} ZP`}</span>
      </div>

      {/* ONE fixed-height status block for every phase. This used to render a bare
          one-line <p> during playback and a three-row countdown stack during input, so
          the instant the pattern finished the block grew by ~56px, pushed the board
          down and — since the dialog re-centres itself — slid the grid out from under
          the player's thumb at exactly the moment they started tapping. Every row
          mounts in every phase now; only the text and the bar's fill change. Do not
          make a row here conditional again.

          aria-live is scoped to the label alone: the readout below re-renders 10x a
          second, and announcing it would make the region unusable. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p aria-live="polite" className="text-sm font-medium text-muted-foreground">
          {statusLabel}
        </p>
        <p
          aria-hidden="true"
          className={cn("text-3xl font-semibold tabular-nums", !armed && "opacity-40")}
        >
          {`${(shownMs / 1000).toFixed(1)}s`}
        </p>
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div
            className={cn(
              "h-1.5 rounded-full",
              !armed ? "bg-muted-foreground/30" : urgent ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${(shownMs / WINDOW_MS) * 100}%` }}
          />
        </div>
      </div>

      <div
        ref={boardRef}
        className={cn(
          "relative rounded-2xl bg-zinc-950 p-4 ring-1 ring-border",
          boardShake && "mz-shock",
        )}
      >
        <div
          className={cn("grid grid-cols-5 gap-2", showGoCue && "sr-go-cue")}
          style={{ width: "min(100%, 400px)", marginInline: "auto" }}
        >
          {Array.from({ length: TILE_COUNT }, (_, i) => {
            const row = Math.floor(i / GRID_SIZE) + 1
            const col = (i % GRID_SIZE) + 1
            const state = tileStates[i]
            const label = `Tile ${i + 1}, row ${row} column ${col}${
              state === "correct" ? ", correct" : state === "wrong" ? ", wrong" : ""
            }`
            return (
              <button
                key={i}
                type="button"
                aria-label={label}
                disabled={!inputEnabled}
                onClick={() => handleTileClick(i)}
                style={{ minHeight: "44px" }}
                className={cn(
                  // sr-tile-bevel MUST be a class, not an inline box-shadow style —
                  // an inline box-shadow always wins the cascade over the
                  // focus-visible:ring-2 utility's own box-shadow below, which
                  // silently made the keyboard focus ring invisible (21-10-PLAN.md
                  // Gate C UAT finding, fixed by moving the bevel to globals.css).
                  "sr-tile-bevel aspect-square rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900 outline-none",
                  "hover:from-zinc-700 hover:to-zinc-800",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
                  state === "on" && "sr-tile-on",
                  state === "off" && "sr-tile-off",
                  state === "correct" && "sr-tile-correct",
                  state === "wrong" && "sr-tile-wrong",
                )}
              />
            )
          })}
        </div>

        {/* Scoped canvas (Phase 18-01 pattern) — kept local to the board
            rather than the library's default full-viewport canvas, and
            pointer-events-none so it can never swallow a tap. */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        />

        {bannerTier !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="sr-tier-banner rounded-md bg-zinc-900/90 px-4 py-2 text-lg font-semibold text-white ring-1 ring-primary/50">
              {`Tier ${bannerTier}`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
