"use client"

// TetrisGame ("Petris") — the <canvas> host. Owns the RAF render loop
// AND the fixed-timestep sim accumulator; forwards onFirstInput/onEnd up so
// the parent (Plan 05) can wire tRPC. Refs everywhere: React state would
// re-render the whole tree at 60fps, which is exactly what we're avoiding by
// using canvas. Modeled on flappy-game.tsx (RAF loop, DPR sizing, ref
// discipline, abs-positioned controls outside the canvas listener).

import { useCallback, useEffect, useRef } from "react"
import { ArrowLeft, ArrowRight, RotateCw, ArrowDown, ChevronsDown, Archive } from "lucide-react"
import {
  createGame,
  ghostRow,
  tick,
  SHAPES,
  BOX_SIZE,
  type Action,
  type GameState,
} from "@/lib/tetris/engine"
import { BOARD_WIDTH, SPAWN_BUFFER_ROWS, TICK_MS } from "@/lib/tetris/constants"
import type { PieceId } from "@/lib/tetris/rng"

type InputLogEntry = { tick: number; action: Action }

type Props = {
  seed: number
  onEnd: (inputLog: InputLogEntry[]) => void
}

// ponytail: no sprite atlas — solid rounded-rect cells, fixed dark palette
// (not theme-aware, same call flappy's canvas made with bg-sky-400). Design
// polish (/impeccable, /emil-design-eng) happens at the phase design pass.
const PIECE_COLORS: Record<PieceId, string> = {
  I: "#22d3ee",
  O: "#facc15",
  T: "#a855f7",
  S: "#4ade80",
  Z: "#f87171",
  J: "#60a5fa",
  L: "#fb923c",
}
const BOARD_BG = "oklch(0.205 0.012 5)" // matches --card (dark)
const CELL_BG = "oklch(0.269 0.012 5)" // matches --muted (dark)
const CELL_GAP = 1
const CELL_RADIUS = 3

function fillCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const s = size - CELL_GAP * 2
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x + CELL_GAP, y + CELL_GAP, s, s, CELL_RADIUS)
  ctx.fill()
}

function strokeCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const s = size - CELL_GAP * 2
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x + CELL_GAP + 1, y + CELL_GAP + 1, s - 2, s - 2, CELL_RADIUS)
  ctx.stroke()
}

const PANEL_LABEL_H = 12

/** One boxed piece preview (NEXT / HOLD). `piece` null draws an empty box — the
 *  HOLD slot before the first hold of a run. */
function drawPiecePanel(
  ctx: CanvasRenderingContext2D,
  piece: PieceId | null,
  x: number,
  y: number,
  box: number,
  pieceCell: number,
  label: string,
  dimmed: boolean,
) {
  ctx.save()
  if (dimmed) ctx.globalAlpha = 0.4
  ctx.fillStyle = "rgba(0,0,0,0.35)"
  ctx.beginPath()
  ctx.roundRect(x, y, box, box + PANEL_LABEL_H, 8)
  ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,0.6)"
  ctx.font = "700 9px system-ui, -apple-system, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  ctx.fillText(label, x + box / 2, y + 3)
  if (piece) {
    const offset = (4 - BOX_SIZE[piece]) / 2
    for (const [dx, dy] of SHAPES[piece][0]) {
      fillCell(
        ctx,
        x + 6 + (dx + offset) * pieceCell,
        y + PANEL_LABEL_H + 6 + (dy + offset) * pieceCell,
        pieceCell,
        PIECE_COLORS[piece],
      )
    }
  }
  ctx.restore()
}

function draw(ctx: CanvasRenderingContext2D, state: GameState, cell: number, cssWidth: number, cssHeight: number) {
  ctx.fillStyle = BOARD_BG
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  // Board grid — only the visible rows (spawn buffer rows above are hidden).
  for (let row = SPAWN_BUFFER_ROWS; row < state.board.length; row++) {
    const visibleRow = row - SPAWN_BUFFER_ROWS
    for (let col = 0; col < BOARD_WIDTH; col++) {
      const value = state.board[row][col]
      const x = col * cell
      const y = visibleRow * cell
      if (value !== 0) fillCell(ctx, x, y, cell, PIECE_COLORS[value])
      else fillCell(ctx, x, y, cell, CELL_BG)
    }
  }

  // Ghost piece — outline at the resting row.
  const ghostY = ghostRow(state)
  const shape = SHAPES[state.current.piece][state.current.rotation]
  for (const [dx, dy] of shape) {
    const x = (state.current.x + dx) * cell
    const y = (ghostY + dy - SPAWN_BUFFER_ROWS) * cell
    if (y >= -cell) strokeCell(ctx, x, y, cell, PIECE_COLORS[state.current.piece])
  }

  // Current falling piece.
  for (const [dx, dy] of shape) {
    const x = (state.current.x + dx) * cell
    const y = (state.current.y + dy - SPAWN_BUFFER_ROWS) * cell
    if (y >= -cell) fillCell(ctx, x, y, cell, PIECE_COLORS[state.current.piece])
  }

  // Right rail — NEXT above HOLD, identical boxes so the two read as one column
  // of the same thing rather than two unrelated widgets.
  const previewCell = cell * 0.55
  const previewBox = previewCell * 4 + 12
  const railX = cssWidth - previewBox - 8
  drawPiecePanel(ctx, state.next, railX, 8, previewBox, previewCell, "NEXT", false)
  drawPiecePanel(
    ctx,
    state.hold,
    railX,
    8 + previewBox + PANEL_LABEL_H + 6,
    previewBox,
    previewCell,
    "HOLD",
    // Dimmed once this piece's hold is spent — the panel IS the cooldown readout,
    // so the player never has to guess whether a second hold will do anything.
    state.holdUsed,
  )
}

export function TetrisGame({ seed, onEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scoreElRef = useRef<HTMLSpanElement | null>(null)
  const linesElRef = useRef<HTMLSpanElement | null>(null)
  const levelElRef = useRef<HTMLSpanElement | null>(null)
  const holdBtnRef = useRef<HTMLButtonElement | null>(null)

  const gameRef = useRef<GameState | null>(null)
  const tickCounterRef = useRef(0) // next tick index to be simulated (matches replay.ts's loop var t)
  const pendingActionsRef = useRef<Action[]>([]) // queued for the next tick() call
  const inputLogRef = useRef<InputLogEntry[]>([])
  const endedRef = useRef(false)
  const hudLastRef = useRef({ score: -1, lines: -1, level: -1, holdUsed: null as boolean | null })

  // Single entry point for every input source (buttons, gestures, keyboard).
  // Writes the SAME action to the tick buffer AND the input log at the same
  // tick, so the recorded log exactly reproduces what the sim saw — this is
  // the anti-cheat contract the server replay (Plan 02/03) depends on. The run
  // is claimed by the parent's explicit Start button, so this no longer gates
  // the server start — the game only mounts once a real seed exists.
  const enqueue = useCallback((action: Action) => {
    const state = gameRef.current
    if (!state || state.status !== "playing") return
    pendingActionsRef.current.push(action)
    inputLogRef.current.push({ tick: tickCounterRef.current, action })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return

    const game = createGame(seed)
    gameRef.current = game
    tickCounterRef.current = 0
    pendingActionsRef.current = []
    inputLogRef.current = []
    endedRef.current = false

    // Responsive sizing. CSS owns the LAYOUT box (the board's aspect-ratio +
    // `max-height` in dvh cap it to the visible viewport so the whole game —
    // board, HUD, and control pad — fits without scrolling on a phone). JS only
    // syncs the canvas BACKING STORE to the measured client box (× dpr) and the
    // logical cell size. Because the client box is CSS-driven, setting the
    // backing store can't feed back into layout — no resize loop, and the board
    // re-fits on fullscreen toggle / rotation / keyboard show via ResizeObserver.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null
    if (!ctx) return
    const safeCtx: CanvasRenderingContext2D = ctx

    const canvasEl = canvas // non-null captures (TS drops guard narrowing inside the closure below)
    const rootEl = root
    let cell = 0
    let cssWidth = 0
    let cssHeight = 0
    function syncCanvasSize() {
      const w = canvasEl.clientWidth
      const h = canvasEl.clientHeight
      if (!w || !h) return
      cssWidth = w
      cssHeight = h
      cell = w / BOARD_WIDTH
      canvasEl.width = Math.round(w * dpr)
      canvasEl.height = Math.round(h * dpr)
      // Re-establish the dpr transform (setting canvas.width above resets it).
      safeCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Publish the resolved board width so the control pad can match it exactly.
      rootEl.style.setProperty("--board-w", `${w}px`)
    }
    syncCanvasSize()
    const resizeObserver = new ResizeObserver(syncCanvasSize)
    resizeObserver.observe(canvas)

    // ---- Line-clear juice: flash + screen-shake + particle burst + banner ----
    // Driven off state.linesCleared deltas so it never touches the pure engine
    // or the anti-cheat contract. All effect state is per-mount local. A 4-line
    // clear ("QUAD" — trademark-safe name, per 09-CONTEXT) gets the blowout:
    // cyan flash, bigger burst, harder shake. prefers-reduced-motion drops all
    // motion (shake + particles) and keeps only a gentle flash + static banner.
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const CLEAR_LABELS = ["", "SINGLE", "DOUBLE", "TRIPLE", "QUAD!"]
    const easeOutBack = (x: number) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
    }
    type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
    // color/y let a banner override the default clear styling — used by the
    // level-up banner (emerald, higher up so it never overlaps a clear banner
    // that fires on the same lock).
    type Banner = { text: string; start: number; dur: number; big: boolean; color?: string; y?: number }
    let particles: Particle[] = []
    let banners: Banner[] = []
    let flashStart = 0
    let flashDur = 0
    let flashBig = false
    let shakeStart = 0
    let shakeAmp = 0
    let shakeDur = 0
    let prevLines = 0
    let prevLevel = 0
    const paletteAll = Object.values(PIECE_COLORS)

    function spawnClearEffect(n: number, now: number) {
      const big = n >= 4
      banners.push({ text: CLEAR_LABELS[Math.min(n, 4)], start: now, dur: big ? 1100 : 750, big })
      flashStart = now
      flashDur = big ? 650 : 360
      flashBig = big
      if (prefersReducedMotion) return
      shakeStart = now
      shakeAmp = big ? 9 : 2 + n
      shakeDur = big ? 380 : 240
      const count = big ? 64 : 12 * n
      const palette = big ? ["#22d3ee", "#a5f3fc", "#67e8f9", "#ffffff"] : paletteAll
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2
        const spd = (big ? 0.36 : 0.22) * (0.4 + Math.random())
        const maxLife = (big ? 900 : 600) * (0.6 + Math.random() * 0.6)
        particles.push({
          x: Math.random() * cssWidth,
          y: cssHeight * (0.32 + Math.random() * 0.4),
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 0.15,
          life: maxLife,
          maxLife,
          color: palette[i % palette.length],
          size: big ? 4 : 3,
        })
      }
    }

    function drawEffects(now: number, dt: number) {
      if (particles.length) {
        for (const p of particles) {
          p.life -= dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.vy += 0.0009 * dt // gravity
        }
        particles = particles.filter((p) => p.life > 0)
        for (const p of particles) {
          safeCtx.globalAlpha = Math.max(0, p.life / p.maxLife)
          safeCtx.fillStyle = p.color
          safeCtx.beginPath()
          safeCtx.roundRect(p.x, p.y, p.size, p.size, 1.5)
          safeCtx.fill()
        }
        safeCtx.globalAlpha = 1
      }
      if (flashDur > 0) {
        const t = (now - flashStart) / flashDur
        if (t >= 1) {
          flashDur = 0
        } else {
          const peak = flashBig ? 0.5 : 0.32
          const a = t < 0.18 ? (t / 0.18) * peak : (1 - (t - 0.18) / 0.82) * peak
          safeCtx.fillStyle = flashBig ? `rgba(34,211,238,${a})` : `rgba(255,255,255,${a})`
          safeCtx.fillRect(0, 0, cssWidth, cssHeight)
        }
      }
      if (banners.length) {
        banners = banners.filter((b) => now - b.start < b.dur)
        for (const b of banners) {
          const t = (now - b.start) / b.dur
          let scale = 1
          let alpha = 1
          let rise = 0
          if (prefersReducedMotion) {
            alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
          } else {
            scale = t < 0.28 ? easeOutBack(t / 0.28) : 1
            alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
            rise = t < 0.7 ? 0 : -((t - 0.7) / 0.3) * 22
          }
          safeCtx.save()
          safeCtx.globalAlpha = Math.max(0, alpha)
          safeCtx.translate(cssWidth / 2, cssHeight * (b.y ?? 0.38) + rise)
          safeCtx.scale(scale, scale)
          safeCtx.textAlign = "center"
          safeCtx.textBaseline = "middle"
          safeCtx.font = `800 ${b.big ? 42 : 26}px system-ui, -apple-system, sans-serif`
          if (b.color) {
            safeCtx.shadowColor = b.color
            safeCtx.shadowBlur = 16
            safeCtx.fillStyle = b.color
          } else if (b.big) {
            safeCtx.shadowColor = "#22d3ee"
            safeCtx.shadowBlur = 24
            safeCtx.fillStyle = "#cffafe"
          } else {
            safeCtx.fillStyle = "#ffffff"
          }
          safeCtx.fillText(b.text, 0, 0)
          safeCtx.restore()
        }
      }
    }

    let raf = 0
    let lastNow = performance.now()
    let accumulator = 0

    function frame(now: number) {
      const dt = Math.min(now - lastNow, 250) // clamp big gaps (tab hidden)
      lastNow = now
      accumulator += dt

      const state = gameRef.current
      if (state) {
        while (accumulator >= TICK_MS) {
          const actions = pendingActionsRef.current
          pendingActionsRef.current = []
          tick(state, actions)
          tickCounterRef.current += 1
          accumulator -= TICK_MS
        }

        if (state.linesCleared > prevLines) {
          spawnClearEffect(state.linesCleared - prevLines, now)
          prevLines = state.linesCleared
        }
        // Level-up: the gravity ramp just got faster — announce it (emerald,
        // upper third) so the rising difficulty is felt, not just silently applied.
        if (state.level > prevLevel) {
          prevLevel = state.level
          banners.push({ text: `LEVEL ${state.level}`, start: now, dur: 950, big: false, color: "#6ee7b7", y: 0.2 })
        }

        // Shake offset is applied to the board draw only (not the effect layer).
        let ox = 0
        let oy = 0
        if (!prefersReducedMotion && shakeDur > 0) {
          const st = (now - shakeStart) / shakeDur
          if (st >= 1) {
            shakeDur = 0
          } else {
            const decay = 1 - st
            ox = Math.sin(now / 17) * shakeAmp * decay
            oy = Math.cos(now / 13) * shakeAmp * decay
          }
        }
        safeCtx.save()
        safeCtx.translate(ox, oy)
        draw(safeCtx, state, cell, cssWidth, cssHeight)
        safeCtx.restore()

        drawEffects(now, dt)

        if (hudLastRef.current.score !== state.score && scoreElRef.current) {
          scoreElRef.current.textContent = String(state.score)
          hudLastRef.current.score = state.score
        }
        if (hudLastRef.current.lines !== state.linesCleared && linesElRef.current) {
          linesElRef.current.textContent = String(state.linesCleared)
          hudLastRef.current.lines = state.linesCleared
        }
        if (hudLastRef.current.level !== state.level && levelElRef.current) {
          levelElRef.current.textContent = String(state.level)
          hudLastRef.current.level = state.level
        }
        // Hold availability is a data-attribute flip, not React state: it changes
        // only on a hold or a lock, but it's read from the sim, and the sim only
        // exists inside this loop. Same imperative discipline as the HUD numbers.
        if (hudLastRef.current.holdUsed !== state.holdUsed && holdBtnRef.current) {
          holdBtnRef.current.dataset.spent = String(state.holdUsed)
          holdBtnRef.current.setAttribute("aria-disabled", String(state.holdUsed))
          hudLastRef.current.holdUsed = state.holdUsed
        }

        if (state.status === "over" && !endedRef.current) {
          endedRef.current = true
          onEnd(inputLogRef.current)
        }
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // Touch gestures on the canvas — horizontal swipe (per-cell step) moves,
    // a short low-movement tap rotates, a downward swipe hard-drops.
    // ponytail: simple thresholds, no momentum/DAS finesse (locked scope).
    //
    // The gesture's axis is LOCKED the first time the finger travels past the tap threshold,
    // and never re-evaluated for the rest of that touch. Without the lock, a down-flick with
    // any diagonal drift (which is most of them — thumbs arc) fed its horizontal component
    // straight into per-cell moves, so the piece slid a column or two BEFORE the hard drop
    // fired at touchend, and landed somewhere the player never aimed at. Committing to one
    // axis is the whole fix: a drop is a drop, a slide is a slide, never both.
    const TAP_MAX_MOVEMENT = 10
    const TAP_MAX_DURATION_MS = 250
    const VERTICAL_SWIPE_MIN_CELLS = 3
    let touchStartX = 0
    let touchStartY = 0
    let touchStartTime = 0
    let touchLastMoveX = 0
    let axis: "x" | "y" | null = null
    // One vertical action per touch, either direction: down hard-drops, up holds.
    let verticalUsedThisTouch = false

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      touchStartX = t.clientX
      touchStartY = t.clientY
      touchLastMoveX = t.clientX
      touchStartTime = performance.now()
      axis = null
      verticalUsedThisTouch = false
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const t = e.touches[0]
      const totalDx = t.clientX - touchStartX
      const totalDy = t.clientY - touchStartY
      if (axis === null) {
        // Same threshold as the tap test, so a tap can never lock an axis on its way to
        // being a tap — the two classifications stay mutually exclusive by construction.
        if (Math.abs(totalDx) < TAP_MAX_MOVEMENT && Math.abs(totalDy) < TAP_MAX_MOVEMENT) return
        axis = Math.abs(totalDx) > Math.abs(totalDy) ? "x" : "y"
        touchLastMoveX = t.clientX // don't spend the lock-in travel as a move step
      }
      if (axis === "x") {
        const dx = t.clientX - touchLastMoveX
        if (Math.abs(dx) >= cell) {
          enqueue(dx > 0 ? "right" : "left")
          touchLastMoveX = t.clientX
        }
      } else if (!verticalUsedThisTouch && Math.abs(totalDy) > cell * VERTICAL_SWIPE_MIN_CELLS) {
        // Fire on the way, not at touchend: the action should feel like it happens when
        // the flick registers, not when the finger finally lifts. Up is hold — the
        // mirror of the drop, and the only vertical direction the board wasn't using.
        enqueue(totalDy > 0 ? "hard" : "hold")
        verticalUsedThisTouch = true
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const dx = t.clientX - touchStartX
      const dy = t.clientY - touchStartY
      const duration = performance.now() - touchStartTime
      if (Math.abs(dx) < TAP_MAX_MOVEMENT && Math.abs(dy) < TAP_MAX_MOVEMENT && duration < TAP_MAX_DURATION_MS) {
        enqueue("rotate")
      } else if (axis === "y" && !verticalUsedThisTouch && Math.abs(dy) > cell * VERTICAL_SWIPE_MIN_CELLS) {
        // Fallback only: a flick fast enough to clear the threshold between two touchmove
        // events still fires. Guarded on verticalUsedThisTouch so it can never double-fire.
        enqueue(dy > 0 ? "hard" : "hold")
      }
    }
    canvas.addEventListener("touchstart", onTouchStart, { passive: true })
    canvas.addEventListener("touchmove", onTouchMove, { passive: false })
    canvas.addEventListener("touchend", onTouchEnd)

    // Keyboard (desktop) — window keydown with a modifier-key guard.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      let action: Action | null = null
      switch (e.key) {
        case "ArrowLeft": action = "left"; break
        case "ArrowRight": action = "right"; break
        case "ArrowUp": case "x": case "X": action = "rotate"; break
        case "ArrowDown": action = "soft"; break
        case " ": action = "hard"; break
        case "c": case "C": case "Shift": action = "hold"; break
        default: return
      }
      e.preventDefault()
      enqueue(action)
    }
    window.addEventListener("keydown", onKeyDown)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      canvas.removeEventListener("touchstart", onTouchStart)
      canvas.removeEventListener("touchmove", onTouchMove)
      canvas.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("keydown", onKeyDown)
      // The run is live from mount, so a genuine mid-run unmount (user closed the
      // dialog / navigated away) must flush the input log to end it server-side.
      // Guard on actual sim progress: React StrictMode's synchronous mount→cleanup
      // →remount (dev) fires this cleanup before any RAF tick runs — ending the run
      // there would instantly top-out with an empty log. tickCounter > 0 means the
      // sim really advanced; a sub-first-frame close is reconciled by the 5-min
      // server sweep instead.
      if (tickCounterRef.current > 0 && !endedRef.current) {
        endedRef.current = true
        onEnd(inputLogRef.current)
      }
    }
  }, [seed, onEnd, enqueue])

  // Control-pad button — shared classes. h-12 keeps a ≥44px touch target height.
  // The background lives on the two variants below, not here: appending an override
  // like `bg-transparent` after `bg-muted` in a class string does NOT win — both are
  // the same property at the same specificity, so the compiled stylesheet's order
  // decides, not the attribute's. Composing from a bg-less base makes it decidable.
  const padBtnBase =
    "flex h-12 items-center justify-center rounded-xl text-foreground ring-1 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  const padBtn = `${padBtnBase} bg-muted ring-border hover:bg-muted/70`
  // Hold is a different KIND of key from the four that move the piece — outlined
  // rather than filled — and the only one that can be unavailable.
  const holdBtn = `${padBtnBase} bg-muted/30 ring-border/70 hover:bg-muted/50 data-[spent=true]:opacity-40`

  return (
    <div ref={rootRef} className="mx-auto flex flex-col items-center gap-3">
      {/* Board box: CSS sizes it to the largest 10:20 board that fits both the
          available width and the viewport height (minus dialog chrome + the pad
          below), so the whole game fits with no scroll on mobile. Width is the
          single explicit dimension; aspect-ratio derives the height → square
          cells. The canvas fills it and the JS backing store follows via
          ResizeObserver. */}
      <div
        className="relative"
        style={{
          width: "max(140px, min(calc((100dvh - 16rem) / 2), 360px, 88vw))",
          aspectRatio: "10 / 20",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ touchAction: "none" }}
          className="block h-full w-full rounded-2xl ring-1 ring-border select-none"
          aria-label="Petris game canvas"
        />
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-0.5 rounded-md bg-black/40 px-2 py-1 text-[11px] font-semibold leading-tight text-white tabular-nums">
          <span>
            Score <span ref={scoreElRef}>0</span>
          </span>
          <span>
            Lines <span ref={linesElRef}>0</span>
          </span>
          <span>
            Level <span ref={levelElRef}>0</span>
          </span>
        </div>
      </div>
      {/* On-screen control pad — below the canvas (never overlapping its touch
          listener). Width matches the resolved board width (--board-w) so the pad
          lines up under the board. */}
      <div className="grid grid-cols-6 gap-1.5" style={{ width: "var(--board-w, 100%)" }}>
        {/* Hold leads the row and is styled apart from the four movement keys: it is
            the only button that doesn't move the piece, and the only one that can be
            unavailable. data-spent (written from the sim loop above, never from React)
            dims it while this piece's hold is already spent. */}
        <button
          ref={holdBtnRef}
          type="button"
          onClick={() => enqueue("hold")}
          aria-label="Hold piece"
          data-spent="false"
          className={holdBtn}
        >
          <Archive className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => enqueue("left")} aria-label="Move left" className={padBtn}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => enqueue("right")} aria-label="Move right" className={padBtn}>
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => enqueue("rotate")} aria-label="Rotate" className={padBtn}>
          <RotateCw className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => enqueue("soft")} aria-label="Soft drop" className={padBtn}>
          <ArrowDown className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => enqueue("hard")} aria-label="Hard drop" className={padBtn}>
          <ChevronsDown className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
