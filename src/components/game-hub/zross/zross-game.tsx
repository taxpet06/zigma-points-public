"use client"

// ZrossGame — the <canvas> host. Owns DPR/ResizeObserver sizing and the drawing
// primitives (board backdrop, four lane types, frog, ZP pickup). Modeled on
// znake-game.tsx's ref discipline (React state would re-render the whole tree at
// 60fps, which canvas + refs deliberately avoids) but the board geometry is
// portrait, not square — Znake's board sets WIDTH via CSS and derives height from a
// 1-to-1 square ratio; Zross sets HEIGHT via CSS (UI-SPEC §6) and derives width from
// a 7-to-9 ratio, so syncCanvasSize's math needs two axes, not one square `size`.
//
// Plan 05 built the drawing half — the component shell, sizing, and the draw
// functions for the backdrop/lanes/frog/pickup. This plan (06) adds the RAF loop
// that drives those primitives every frame, the particle/banner/flash/shake
// effects vocabulary, all four death sequences, and swipe/tap/keyboard/pad input.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react"
import { createWorld, hop, step, tierFor, type World, type Lane, type Mover, type Slab, type Dir } from "./engine"
import {
  LANE_COLS,
  VISIBLE_ROWS,
  HOP_MS,
  TELEGRAPH_MS,
  FIRE_MS,
  TRAM_COOLDOWN_MS,
  TRAM_IDLE_PULSE_MS,
} from "./constants"

type Props = {
  seed: number
  onCollect: (pickupIndex: number) => void
  onEnd: () => void
}

// Canvas palette (UI-SPEC §5). "INHERITED" = byte-identical to znake-game.tsx (keeps
// the canvas games one visual family per CONTEXT); "NEW" = a deliberate synthwave
// cyber-city addition, justified per UI-SPEC §5's table.
const BOARD_BG = "oklch(0.16 0.03 290)" // NEW — deep indigo-violet night sky
const PLAZA_BG = "oklch(0.242 0.012 5)" // INHERITED — byte-identical to Znake's CELL_BG
// Blockers are IMPASSABLE — startHop() refuses to move the frog into one, from any
// direction. They used to draw as an inset tile one step lighter than the plaza floor
// (oklch 0.30 vs 0.242 — about 6% lightness), which read as decorative paving, so being
// silently refused a hop felt like the game dropping the input. A wall has to look like a
// wall: these three values build a lit top face over a solid body with a dark base line, an
// extruded block that fills its whole cell edge to edge rather than floating inside it.
const BLOCKER_FACE = "oklch(0.40 0.02 290)" // NEW — solid barrier body
const BLOCKER_TOP = "oklch(0.56 0.03 290)" // NEW — lit top face, sells the extrusion
const BLOCKER_BASE = "oklch(0.14 0.02 290)" // NEW — contact shadow at the foot of the block
const ROAD_BG = "oklch(0.18 0.01 280)" // NEW — near-neutral dark slate asphalt
const ROAD_DASH = "#F43F5E" // INHERITED — same hex as Znake's SNAKE_MID
const CAR_BODY = "#22D3EE" // NEW — cyan-400 hovercar chassis
const CAR_GLOW = "#F472B6" // NEW — pink-400 cockpit/headlight cone
const RAIL_BED = "oklch(0.14 0.02 290)" // NEW — laser-tram rail bed
const TRAM_IDLE = "#FBBF24" // NEW — amber-400 idle breathing glow
const TRAM_FIRE = "#FFFFFF" // NEW — hard white lethal beam
const RIVER_BG = "oklch(0.22 0.08 220)" // NEW — data-stream base surface
const RIVER_FLOW = "#22D3EE" // NEW — animated flow lines, shares hovercar cyan
const SLAB_TOP = "oklch(0.55 0.02 290)" // NEW — safe-footing top face
const SLAB_RIM = "#F43F5E" // INHERITED — same hex as Znake's SNAKE_MID
const FROG_HEAD = "#FDA4AF" // INHERITED — byte-identical to Znake's SNAKE_HEAD
const FROG_MID = "#F43F5E" // INHERITED — byte-identical to Znake's SNAKE_MID
const FROG_TAIL = "#9F1239" // INHERITED — byte-identical to Znake's SNAKE_TAIL
const FROG_EYE = "#FFFFFF" // INHERITED — byte-identical to Znake's eye sclera
const FROG_PUPIL = "#4C0519" // INHERITED — rose-950, byte-identical to Znake's pupil
const PICKUP_GLOW = "#F43F5E" // INHERITED — same hex as Znake's APPLE_GLOW
const PARTICLE_PALETTE = ["#FDA4AF", "#F43F5E", "#FB7185", "#FFFFFF"] // INHERITED — Znake's particle palette (Plan 06)
const DROWN_PALETTE = ["#22D3EE", "#67E8F9", "#FFFFFF"] // NEW — drown-death glitch burst (Plan 06)
const BANNER_GAIN = "#6EE7B7" // INHERITED — emerald-300, locked by 19-CONTEXT.md (Plan 06)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Splits a column span that may drift past the last column back onto the first
 *  (movers/slabs mod-wrap within LANE_COLS every lane) into 1-2 column-space
 *  segments, so a wrapping car/slab draws as two rects instead of clipping off
 *  the board edge and disappearing. */
function wrapSegments(col: number, len: number): { start: number; len: number }[] {
  const start = mod(col, LANE_COLS)
  if (start + len <= LANE_COLS) return [{ start, len }]
  const firstLen = LANE_COLS - start
  return [
    { start, len: firstLen },
    { start: 0, len: len - firstLen },
  ]
}

export function ZrossGame({ seed, onCollect, onEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<World | null>(null)
  const endedRef = useRef(false)
  // The sim is frozen until the first hop input (requestHop below flips this), so
  // the player reads the board before the clock starts — same discipline as
  // Znake's hasStartedRef/started pair.
  const hasStartedRef = useRef(false)
  const [started, setStarted] = useState(false)
  const zpElRef = useRef<HTMLSpanElement | null>(null)
  const distanceElRef = useRef<HTMLSpanElement | null>(null)
  const tierElRef = useRef<HTMLSpanElement | null>(null)

  // Shared by the canvas swipe/tap listeners (inside the effect), the keyboard
  // listener, and the on-screen pad (outside it, in this component's own JSX) — a
  // single funnel that starts the run on first call and mutates the world's hop
  // buffer directly. hop() itself already enforces the one-deep queue, so there is
  // no separate pendingHopsRef the way Znake buffers turns.
  const requestHop = useCallback((dir: Dir) => {
    hasStartedRef.current = true
    setStarted(true)
    const world = worldRef.current
    if (world) hop(world, dir)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return

    const world = createWorld(seed)
    worldRef.current = world
    endedRef.current = false

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null
    if (!ctx) return
    const c: CanvasRenderingContext2D = ctx
    const canvasEl = canvas

    // CSS owns the layout box (UI-SPEC §6: height set by CSS, width auto-derived via
    // aspect-ratio: 7/9); JS only syncs the backing store to the measured client box
    // × dpr. Two axes, unlike Znake's single square `size`/GRID_SIZE — cellW derives
    // from the measured width, board height derives from VISIBLE_ROWS rows of that
    // same (square) cell size.
    let boardWidth = 0
    let boardHeight = 0
    let cell = 0
    function syncCanvasSize() {
      const w = canvasEl.clientWidth
      if (!w) return
      boardWidth = w
      cell = w / LANE_COLS
      boardHeight = cell * VISIBLE_ROWS
      canvasEl.width = Math.round(boardWidth * dpr)
      canvasEl.height = Math.round(boardHeight * dpr)
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint()
    }

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // Test-only observability hook (19-08-PLAN.md Task 2): mirrors the exact value
    // every draw/effect function above branches on, so the mobile-UAT spec can assert
    // the client's real reduced-motion state without guessing a second, independent
    // media query of its own.
    canvasEl.dataset.reducedMotion = String(prefersReducedMotion)

    // ---- Effects: particles, banners, flash, shake, vignette. Cloned wholesale
    // from znake-game.tsx's vocabulary (19-PATTERNS.md: "clone the machinery, plug
    // in Zross's constants") — every function below already guards itself on
    // prefersReducedMotion, so call sites never branch on it directly. ----
    type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
    type Banner = { text: string; start: number; dur: number; color: string; x: number; y: number }
    let particles: Particle[] = []
    let banners: Banner[] = []
    let flashStart = 0
    let flashDur = 0
    let flashColor = "255,255,255"
    let shakeStart = 0
    let shakeAmp = 0
    let shakeDur = 0
    let vignetteStart = 0
    let vignetteDur = 0
    // Set only for the "drown" death — drawFrogWithDeathState reads it to scale/fade
    // the frog in place. No other death cause changes how the frog itself is drawn.
    let drownDeathStart: number | null = null
    const easeOutBack = (x: number) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
    }

    function burst(atX: number, atY: number, now: number, count: number, palette: string[], speed: number) {
      if (prefersReducedMotion) return
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2
        const spd = speed * (0.4 + Math.random())
        const maxLife = 620 * (0.6 + Math.random() * 0.6)
        particles.push({
          x: atX,
          y: atY,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 0.05,
          life: maxLife,
          maxLife,
          color: palette[i % palette.length],
          size: 2 + Math.random() * 2.5,
        })
      }
    }

    function drawEffects(now: number, dt: number) {
      if (particles.length) {
        for (const p of particles) {
          p.life -= dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.vy += 0.0008 * dt // gravity
        }
        particles = particles.filter((p) => p.life > 0)
        for (const p of particles) {
          c.globalAlpha = Math.max(0, p.life / p.maxLife)
          c.fillStyle = p.color
          c.beginPath()
          c.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          c.fill()
        }
        c.globalAlpha = 1
      }
      if (flashDur > 0) {
        const t = (now - flashStart) / flashDur
        if (t >= 1) {
          flashDur = 0
        } else {
          const a = (t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82) * 0.35
          c.fillStyle = `rgba(${flashColor},${a})`
          c.fillRect(0, 0, boardWidth, boardHeight)
        }
      }
      if (banners.length) {
        banners = banners.filter((b) => now - b.start < b.dur)
        for (const b of banners) {
          const t = (now - b.start) / b.dur
          const scale = prefersReducedMotion || t >= 0.28 ? 1 : easeOutBack(t / 0.28)
          const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
          const rise = prefersReducedMotion ? 0 : -t * cell * 1.6
          c.save()
          c.globalAlpha = Math.max(0, alpha)
          c.translate(b.x, b.y + rise)
          c.scale(scale, scale)
          c.textAlign = "center"
          c.textBaseline = "middle"
          c.font = `800 ${Math.round(cell * 0.95)}px system-ui, -apple-system, sans-serif`
          c.shadowColor = b.color
          c.shadowBlur = 14
          c.fillStyle = b.color
          c.fillText(b.text, 0, 0)
          c.restore()
        }
      }
      // Camera death: a screen-edge crimson vignette pulse, distinct from the
      // full-rect flash above (UI-SPEC §7).
      if (vignetteDur > 0) {
        const t = (now - vignetteStart) / vignetteDur
        if (t >= 1) {
          vignetteDur = 0
        } else {
          // Reduced motion: static vignette (fixed alpha), not an animated pulse.
          const peak = prefersReducedMotion ? 0.4 : (t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5) * 0.5
          const grad = c.createRadialGradient(
            boardWidth / 2,
            boardHeight / 2,
            Math.min(boardWidth, boardHeight) * 0.35,
            boardWidth / 2,
            boardHeight / 2,
            Math.max(boardWidth, boardHeight) * 0.8,
          )
          grad.addColorStop(0, "rgba(244,63,94,0)")
          grad.addColorStop(1, `rgba(244,63,94,${peak})`)
          c.fillStyle = grad
          c.fillRect(0, 0, boardWidth, boardHeight)
        }
      }
    }

    /** The drown death's only per-frog visual change: scale 1->0.4 + fade 1->0 over
     *  500ms on ease-in (sinking, no shake) — wraps the UNCHANGED drawFrog() in a
     *  transform/alpha pair instead of duplicating its body. Reduced motion: instant
     *  disappear (no tween) rather than an interpolated scale/fade. */
    function drawFrogWithDeathState(w: World, now: number) {
      if (drownDeathStart === null) {
        drawFrog(w, now)
        return
      }
      if (prefersReducedMotion) return
      const t = Math.min(1, (now - drownDeathStart) / 500)
      const scale = lerp(1, 0.4, t * t) // ease-in
      const alpha = lerp(1, 0, t)
      const { x, y } = cellCenter(w, w.frog.lane, w.frog.col)
      c.save()
      c.globalAlpha = alpha
      c.translate(x, y)
      c.scale(scale, scale)
      c.translate(-x, -y)
      drawFrog(w, now)
      c.restore()
    }

    // ---- Lane drawing. shadowBlur budget (RESEARCH Pitfall 4): every base fill
    // below is shadow-free; only the tram's glow states and the nearest river
    // lane's two slab rims carry a shadowBlur pass (Task 3 adds the frog/pickup
    // hero passes on top of this layer). ----

    function drawPlazaLane(lane: Lane, y: number) {
      c.shadowBlur = 0
      c.fillStyle = PLAZA_BG
      c.fillRect(0, y, boardWidth, cell)
      // Full-bleed, not inset: a block that touches its cell edges reads as part of a wall
      // the frog cannot pass, where an inset rounded tile read as floor decoration.
      const r = Math.max(1, cell * 0.06)
      for (const col of lane.blockers) {
        const x = col * cell
        c.fillStyle = BLOCKER_BASE
        c.fillRect(x, y, cell, cell)
        c.fillStyle = BLOCKER_FACE
        c.beginPath()
        c.roundRect(x, y, cell, cell - cell * 0.1, r)
        c.fill()
        c.fillStyle = BLOCKER_TOP
        c.beginPath()
        c.roundRect(x, y, cell, cell * 0.26, r)
        c.fill()
      }
    }

    function drawHovercar(lane: Lane, m: Mover, y: number) {
      const dir = lane.dirSign
      c.shadowBlur = 0
      c.fillStyle = CAR_BODY
      const r = cell * 0.22
      for (const seg of wrapSegments(m.col, m.len)) {
        const x = seg.start * cell
        const w = seg.len * cell
        c.beginPath()
        c.roundRect(x + cell * 0.06, y + cell * 0.18, Math.max(0, w - cell * 0.12), cell * 0.64, r)
        c.fill()
      }
      // Cockpit glow + headlight cone — only when the car doesn't wrap this frame
      // (a rare seam, decoration-only skip; the chassis above still renders correctly).
      if (mod(m.col, LANE_COLS) + m.len <= LANE_COLS) {
        const x0 = mod(m.col, LANE_COLS) * cell
        const w = m.len * cell
        c.fillStyle = CAR_GLOW
        const cockpitW = Math.min(w * 0.55, cell * 0.55)
        const cockpitX = dir > 0 ? x0 + w - cockpitW - cell * 0.1 : x0 + cell * 0.1
        c.beginPath()
        c.roundRect(cockpitX, y + cell * 0.28, cockpitW, cell * 0.44, cell * 0.14)
        c.fill()
        const coneLen = cell * 0.55
        const coneX = dir > 0 ? x0 + w : x0
        const grad = c.createLinearGradient(coneX, y + cell * 0.5, coneX + dir * coneLen, y + cell * 0.5)
        grad.addColorStop(0, "rgba(244,114,182,0.35)")
        grad.addColorStop(1, "rgba(244,114,182,0)")
        c.fillStyle = grad
        c.beginPath()
        c.moveTo(coneX, y + cell * 0.3)
        c.lineTo(coneX + dir * coneLen, y + cell * 0.5)
        c.lineTo(coneX, y + cell * 0.7)
        c.closePath()
        c.fill()
      }
    }

    function drawRoadLane(lane: Lane, y: number) {
      c.shadowBlur = 0
      c.fillStyle = ROAD_BG
      c.fillRect(0, y, boardWidth, cell)
      c.save()
      c.shadowBlur = 0
      c.strokeStyle = ROAD_DASH
      c.globalAlpha = 0.6
      c.setLineDash([cell * 0.18, cell * 0.14])
      c.lineWidth = Math.max(1, cell * 0.04)
      c.beginPath()
      c.moveTo(0, y + cell / 2)
      c.lineTo(boardWidth, y + cell / 2)
      c.stroke()
      c.restore()
      for (const m of lane.movers) drawHovercar(lane, m, y)
    }

    // Re-invoked a second time at the end of drawWorld (on top of the frog) so the
    // lethal white beam always outranks every other element on screen, UI-SPEC §5's
    // focal hierarchy: white > rose (frog/pickup) > cyan > amber.
    function drawTramFireBeam(y: number) {
      c.save()
      c.shadowColor = SLAB_RIM
      c.shadowBlur = 24
      c.fillStyle = TRAM_FIRE
      c.fillRect(0, y + cell * 0.32, boardWidth, cell * 0.36)
      c.restore()
    }

    function drawTramLane(lane: Lane, y: number, now: number) {
      c.shadowBlur = 0
      c.fillStyle = RAIL_BED
      c.fillRect(0, y, boardWidth, cell)

      const barY = y + cell * 0.38
      const barH = cell * 0.24
      if (lane.tramState === "idle") {
        const pulse = prefersReducedMotion
          ? 0.55
          : 0.4 + 0.3 * (0.5 + 0.5 * Math.sin((now / TRAM_IDLE_PULSE_MS) * Math.PI * 2))
        c.save()
        c.shadowColor = TRAM_IDLE
        c.shadowBlur = 6
        c.globalAlpha = pulse
        c.fillStyle = TRAM_IDLE
        c.fillRect(cell * 0.1, barY, boardWidth - cell * 0.2, barH)
        c.restore()
      } else if (lane.tramState === "telegraph") {
        const t = Math.min(1, (lane.tramPhaseMs - TRAM_IDLE_PULSE_MS) / TELEGRAPH_MS)
        c.save()
        c.shadowColor = TRAM_IDLE
        c.shadowBlur = 10
        if (prefersReducedMotion) {
          // 3-step colour escalation over the SAME 700ms window, no flicker.
          c.fillStyle = t < 1 / 3 ? "#FBBF24" : t < 2 / 3 ? "#FB923C" : "#F87171"
          c.fillRect(cell * 0.06, barY, boardWidth - cell * 0.12, barH)
        } else {
          // Flash frequency ramps from ~4Hz to solid across TELEGRAPH_MS, ease-in.
          const freqHz = 4 + 16 * t * t
          const solidNear = t > 0.85
          const flickerOn = solidNear || Math.sin((now / 1000) * freqHz * Math.PI * 2) > 0
          c.fillStyle = t < 0.5 ? TRAM_IDLE : TRAM_FIRE
          if (flickerOn) c.fillRect(cell * 0.06, barY, boardWidth - cell * 0.12, barH)
        }
        c.restore()
      } else if (lane.tramState === "fire") {
        drawTramFireBeam(y)
      } else {
        // cooldown — fade back to idle amber over TRAM_COOLDOWN_MS.
        const cdStart = TRAM_IDLE_PULSE_MS + TELEGRAPH_MS + FIRE_MS
        const t = Math.min(1, (lane.tramPhaseMs - cdStart) / TRAM_COOLDOWN_MS)
        const alpha = prefersReducedMotion ? 0.55 : 0.85 * (1 - t) + 0.4 * t
        c.save()
        c.shadowColor = TRAM_IDLE
        c.shadowBlur = 6
        c.globalAlpha = alpha
        c.fillStyle = TRAM_IDLE
        c.fillRect(cell * 0.1, barY, boardWidth - cell * 0.2, barH)
        c.restore()
      }
    }

    function drawSlab(slab: Slab, y: number, glow: boolean) {
      for (const seg of wrapSegments(slab.col, slab.len)) {
        const x = seg.start * cell
        const w = seg.len * cell
        c.shadowBlur = 0
        c.fillStyle = SLAB_TOP
        c.beginPath()
        c.roundRect(x + cell * 0.04, y + cell * 0.14, Math.max(0, w - cell * 0.08), cell * 0.72, cell * 0.16)
        c.fill()
        c.save()
        c.shadowColor = SLAB_RIM
        c.shadowBlur = glow ? 10 : 0
        c.strokeStyle = SLAB_RIM
        c.lineWidth = Math.max(1, cell * 0.05)
        c.beginPath()
        c.roundRect(x + cell * 0.04, y + cell * 0.14, Math.max(0, w - cell * 0.08), cell * 0.72, cell * 0.16)
        c.stroke()
        c.restore()
      }
    }

    function drawRiverLane(lane: Lane, y: number, now: number, glowSlabs: boolean) {
      c.shadowBlur = 0
      c.fillStyle = RIVER_BG
      c.fillRect(0, y, boardWidth, cell)
      c.save()
      c.shadowBlur = 0
      c.strokeStyle = RIVER_FLOW
      c.globalAlpha = 0.35
      c.lineWidth = Math.max(1, cell * 0.05)
      const flowOffset = prefersReducedMotion ? 0 : (now / 12) % (cell * 0.6)
      for (let i = -1; i < LANE_COLS + 1; i++) {
        const x = i * cell * 0.6 + flowOffset
        c.beginPath()
        c.moveTo(x, y + cell * 0.1)
        c.lineTo(x - cell * 0.3, y + cell * 0.9)
        c.stroke()
      }
      c.restore()
      for (const slab of lane.slabs) drawSlab(slab, y, glowSlabs)
    }

    function drawLane(lane: Lane, y: number, now: number, nearestRiver: boolean) {
      if (lane.type === "plaza") drawPlazaLane(lane, y)
      else if (lane.type === "road") drawRoadLane(lane, y)
      else if (lane.type === "tram") drawTramLane(lane, y, now)
      else drawRiverLane(lane, y, now, nearestRiver)
    }

    /** Screen-space row for a world lane index — continuous in w.cameraRow, so the
     *  whole stack scrolls smoothly (fractional part of cameraRow) with no separate
     *  offset variable. Row 0 = top (farthest ahead), row VISIBLE_ROWS-1 = bottom. */
    function screenRowOf(w: World, laneIndex: number): number {
      return w.cameraRow + (VISIBLE_ROWS - 1) - laneIndex
    }

    function cellCenter(w: World, laneIndex: number, col: number): { x: number; y: number } {
      return { x: (col + 0.5) * cell, y: (screenRowOf(w, laneIndex) + 0.5) * cell }
    }

    // ---- ZP pickup: the app logo, breathing on a pulsing crimson halo (clones
    // Znake's drawApple() shape verbatim, repointed at the SAME existing asset —
    // MUST-DIVERGE §6, no new image file). ----
    const logo = new Image()
    let logoReady = false
    logo.onload = () => {
      logoReady = true
    }
    logo.src = "/game-hub/zross/logo.svg"

    function drawPickup(w: World, lane: Lane, now: number) {
      if (lane.pickupCol === null) return
      const screenRow = screenRowOf(w, lane.index)
      if (screenRow < -1 || screenRow > VISIBLE_ROWS) return
      const { x, y } = cellCenter(w, lane.index, lane.pickupCol)
      const pulse = prefersReducedMotion ? 0 : Math.sin(now / 260)
      const halo = cell * (0.52 + pulse * 0.06)
      const bob = prefersReducedMotion ? 0 : pulse * cell * 0.06

      c.save()
      c.translate(x, y + bob)
      c.shadowBlur = 0
      const grad = c.createRadialGradient(0, 0, cell * 0.1, 0, 0, halo)
      grad.addColorStop(0, "rgba(244,63,94,0.45)")
      grad.addColorStop(1, "rgba(244,63,94,0)")
      c.fillStyle = grad
      c.beginPath()
      c.arc(0, 0, halo, 0, Math.PI * 2)
      c.fill()

      const s = cell * (0.6 + (prefersReducedMotion ? 0 : pulse * 0.04))
      c.shadowColor = PICKUP_GLOW
      c.shadowBlur = 16
      if (logoReady) {
        c.drawImage(logo, -s / 2, -s / 2, s, s)
      } else {
        c.fillStyle = PICKUP_GLOW
        c.beginPath()
        c.roundRect(-s / 2, -s / 2, s, s, s * 0.28)
        c.fill()
      }
      c.restore()
    }

    // ---- Frog: canvas primitives only, no sprite sheet (19-CONTEXT.md). Wide rounded
    // body, two domed eyes ON TOP of the head, tucked legs. INHERITED gradient +
    // glow-pass values from Znake's snake. ----
    //
    // This was a fox until the character read as devilish: two sharp triangles rising
    // off the head, in crimson, under a crimson glow, are horns. The palette is not the
    // problem and must not be "fixed" by recolouring — rose is the board's semantic
    // "you / safe" channel against cyan hazards, white lethals and amber trams (UI-SPEC
    // §5 glow priority white > rose > cyan > amber). A cool-toned character would read
    // as a hazard. The fix is the SILHOUETTE: a frog has no ears at all, so the horn
    // read is gone by construction rather than by tuning. Do not re-add pointed ears.
    //
    // `now` isn't read by the base draw itself — the drown death's scale/fade
    // wrapper (drawFrogWithDeathState above) is the per-frame animation that
    // consumes it, via a canvas transform around an unmodified call to this
    // function, not an idle-bob pass.
    function drawFrog(w: World, now: number) {
      const frog = w.frog
      const t = frog.hopping ? Math.min(1, frog.hopElapsedMs / HOP_MS) : 1
      const from = cellCenter(w, frog.fromLane, frog.fromCol)
      const to = cellCenter(w, frog.lane, frog.col)
      const arc = prefersReducedMotion ? 0 : Math.sin(t * Math.PI) * cell * 0.35
      const x = lerp(from.x, to.x, t)
      const y = lerp(from.y, to.y, t) - arc

      const bodyR = cell * 0.34
      const eyeDomeR = cell * 0.105

      // Squash-and-stretch: the body flattens on take-off and landing and stretches at
      // the apex, which is what sells a hop as a hop. sin(t*PI) peaks mid-arc alongside
      // the existing arc lift, so the two stay in phase for free. Neutralised under
      // reduced motion (ZCTL-03) — the frog still moves, it just doesn't deform.
      const squash = prefersReducedMotion || !frog.hopping ? 0 : Math.sin(t * Math.PI)
      const rx = bodyR * (1 - squash * 0.14) // narrows as it stretches upward
      const ry = bodyR * (0.78 + squash * 0.2) // frogs are WIDER than tall at rest

      // Back legs — tucked, drawn under the body so only the haunches show.
      c.save()
      c.shadowColor = FROG_MID
      c.shadowBlur = 18
      c.fillStyle = FROG_TAIL
      for (const side of [-1, 1]) {
        c.beginPath()
        c.ellipse(x + side * rx * 0.82, y + ry * 0.42, rx * 0.3, ry * 0.34, 0, 0, Math.PI * 2)
        c.fill()
      }

      // Body — a wide dome, not a circle. Highlight sits high so the form reads convex.
      const body = c.createRadialGradient(x, y - ry * 0.35, 0, x, y, Math.max(rx, ry))
      body.addColorStop(0, FROG_HEAD)
      body.addColorStop(0.55, FROG_MID)
      body.addColorStop(1, FROG_TAIL)
      c.fillStyle = body
      c.beginPath()
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      c.fill()
      c.restore()

      // Mouth — a shallow upward arc. One stroke, and it's most of what separates
      // "friendly" from "blank".
      c.save()
      c.strokeStyle = FROG_TAIL
      c.globalAlpha = 0.55
      c.lineWidth = Math.max(1, cell * 0.022)
      c.lineCap = "round"
      c.beginPath()
      c.arc(x, y + ry * 0.02, rx * 0.42, Math.PI * 0.18, Math.PI * 0.82)
      c.stroke()
      c.restore()

      // Eyes — two domes ON TOP of the head, breaking the silhouette upward. This is the
      // frog's signature and the structural replacement for the ears: rounded, so the
      // outline never comes to a point.
      const eyeY = y - ry * 0.78
      for (const side of [-1, 1]) {
        const ex = x + side * rx * 0.44
        c.save()
        c.shadowColor = FROG_MID
        c.shadowBlur = 22
        c.fillStyle = FROG_HEAD
        c.beginPath()
        c.arc(ex, eyeY, eyeDomeR, 0, Math.PI * 2)
        c.fill()
        c.restore()

        c.fillStyle = FROG_EYE
        c.beginPath()
        c.arc(ex, eyeY, eyeDomeR * 0.62, 0, Math.PI * 2)
        c.fill()

        // Pupil sits slightly forward (down-screen = the direction of travel) so the
        // frog reads as looking where it is going.
        c.fillStyle = FROG_PUPIL
        c.beginPath()
        c.arc(ex, eyeY + eyeDomeR * 0.16, eyeDomeR * 0.34, 0, Math.PI * 2)
        c.fill()

        // Catchlight — the single cheapest "alive" cue on the whole board.
        c.fillStyle = "#FFFFFF"
        c.globalAlpha = 0.9
        c.beginPath()
        c.arc(ex - eyeDomeR * 0.22, eyeY - eyeDomeR * 0.24, eyeDomeR * 0.16, 0, Math.PI * 2)
        c.fill()
        c.globalAlpha = 1
      }
    }

    function drawWorld(w: World, now: number) {
      if (!boardWidth || !boardHeight) return
      c.shadowBlur = 0
      c.fillStyle = BOARD_BG
      c.fillRect(0, 0, boardWidth, boardHeight)

      // Budget the two-nearest-slab shadowBlur allowance (Pitfall 4) to the single
      // river lane closest to the frog — a river lane always carries exactly two
      // slabs, so "the two nearest slabs' rims" maps cleanly onto "the nearest
      // river lane glows, every farther one draws a cheap solid stroke".
      let nearestRiverIndex: number | null = null
      let nearestRiverDist = Infinity
      for (const lane of w.lanes) {
        if (lane.type !== "river") continue
        const dist = Math.abs(lane.index - w.frog.lane)
        if (dist < nearestRiverDist) {
          nearestRiverDist = dist
          nearestRiverIndex = lane.index
        }
      }

      // Bottom-to-top: world.lanes is ascending by index, and ascending index maps
      // to a DEcreasing screen row (closer to the top), so iterating in stored
      // order already draws the nearest (bottom) lane first.
      for (const lane of w.lanes) {
        const screenRow = screenRowOf(w, lane.index)
        if (screenRow < -1 || screenRow > VISIBLE_ROWS) continue
        const y = screenRow * cell
        drawLane(lane, y, now, lane.index === nearestRiverIndex)
      }

      // z-order (UI-SPEC §5 focal hierarchy): lanes (incl. slabs/movers) below,
      // then pickups, then the frog (which is already drawn "on" any slab it's
      // riding — Pattern 3, ridingSlabId never changes frog.col's shape), then the
      // tram's lethal white beam re-drawn on top of everything so it always wins.
      for (const lane of w.lanes) drawPickup(w, lane, now)
      drawFrogWithDeathState(w, now)
      for (const lane of w.lanes) {
        if (lane.type !== "tram" || lane.tramState !== "fire") continue
        const screenRow = screenRowOf(w, lane.index)
        if (screenRow < -1 || screenRow > VISIBLE_ROWS) continue
        drawTramFireBeam(screenRow * cell)
      }
    }

    // Static initial paint so the board isn't blank before Plan 06 wires the RAF
    // loop — a single draw call, not an animation loop.
    function paint() {
      const w = worldRef.current
      if (!w) return
      drawWorld(w, performance.now())
    }

    syncCanvasSize()
    const resizeObserver = new ResizeObserver(syncCanvasSize)
    resizeObserver.observe(canvas)

    let raf = 0
    let frames = 0 // RAF ticks actually rendered — the StrictMode guard, see cleanup
    let lastNow = performance.now()
    let lastZp = -1
    let lastDistance = -1
    let lastTier = -1
    let zpCount = 0
    // Per-lane "was it firing last frame" so the tram-fire flash triggers exactly
    // once per fire cycle, not on every one of FIRE_MS's rendered frames. Rebuilt
    // fresh from the currently-generated lane window every frame — bounded by the
    // lookahead, so it never grows even though lane indices climb forever.
    let tramWasFiring = new Map<number, boolean>()

    function frame(now: number) {
      const dt = Math.min(now - lastNow, 250) // clamp big gaps (tab hidden)
      lastNow = now
      frames += 1
      const w = worldRef.current
      if (!w) return

      // The sim (camera/movers/tram cycle) is frozen until the first hop input
      // (requestHop, Task 3's input layer) — the player reads the board before the
      // clock starts, same discipline as Znake's hasStartedRef gate.
      let collected: number[] = []
      let died = false
      let tierUp = false
      if (hasStartedRef.current) {
        const result = step(w, dt)
        collected = result.collected
        died = result.died
        tierUp = result.tierUp
      }

      // Tram-fire flash — an ambient "the rail just went off" cue for ANY tram
      // entering its fire window, independent of whether the frog was hit (distinct
      // white flash from the crimson death flash below).
      const nextTramWasFiring = new Map<number, boolean>()
      for (const lane of w.lanes) {
        if (lane.type !== "tram") continue
        const firing = lane.tramState === "fire"
        nextTramWasFiring.set(lane.index, firing)
        if (firing && !tramWasFiring.get(lane.index)) {
          flashStart = now
          flashDur = FIRE_MS
          flashColor = "255,255,255"
        }
      }
      tramWasFiring = nextTramWasFiring

      // Every collected index is forwarded exactly once, in order, from here alone.
      if (collected.length > 0) {
        const { x: px, y: py } = cellCenter(w, w.frog.lane, w.frog.col)
        for (const idx of collected) onCollect(idx)
        burst(px, py, now, 22, PARTICLE_PALETTE, 0.24)
        banners.push({ text: "+1 ZP", start: now, dur: 800, color: BANNER_GAIN, x: px, y: py })
        flashStart = now
        flashDur = 260
        flashColor = "244,63,94"
        zpCount += collected.length
      }

      if (tierUp) {
        banners.push({
          text: `TIER ${tierFor(w.distance)}`,
          start: now,
          dur: 950,
          color: BANNER_GAIN,
          x: boardWidth / 2,
          y: boardHeight * 0.3,
        })
      }

      // Shake offset — applied to the game layer, not the effect layer.
      let ox = 0
      let oy = 0
      if (!prefersReducedMotion && shakeDur > 0) {
        const st = (now - shakeStart) / shakeDur
        if (st >= 1) shakeDur = 0
        else {
          const decay = 1 - st
          ox = Math.sin(now / 17) * shakeAmp * decay
          oy = Math.cos(now / 13) * shakeAmp * decay
        }
      }

      c.save()
      c.translate(ox, oy)
      drawWorld(w, now)
      c.restore()
      drawEffects(now, dt)

      const distance = Math.floor(w.distance)
      const tier = tierFor(w.distance)
      if (lastZp !== zpCount && zpElRef.current) {
        lastZp = zpCount
        zpElRef.current.textContent = String(zpCount)
      }
      if (lastDistance !== distance && distanceElRef.current) {
        lastDistance = distance
        distanceElRef.current.textContent = String(distance)
      }
      if (lastTier !== tier && tierElRef.current) {
        lastTier = tier
        tierElRef.current.textContent = String(tier)
      }

      if (died && !endedRef.current) {
        endedRef.current = true
        const { x: dx, y: dy } = cellCenter(w, w.frog.lane, w.frog.col)
        if (w.deathCause === "mover") {
          flashStart = now
          flashDur = 420
          flashColor = "244,63,94"
          if (!prefersReducedMotion) {
            shakeStart = now
            shakeAmp = 9
            shakeDur = 380
          }
          burst(dx, dy, now, 40, PARTICLE_PALETTE, 0.32)
        } else if (w.deathCause === "drown") {
          drownDeathStart = now
          burst(dx, dy, now, 24, DROWN_PALETTE, 0.22)
        } else if (w.deathCause === "carried") {
          // The slab/frog drift that carried the frog off-board already happened as
          // real simulation (never gated on reduced motion); only this flash is
          // decoration.
          flashStart = now
          flashDur = 300
          flashColor = "255,255,255"
        } else if (w.deathCause === "camera") {
          vignetteStart = now
          vignetteDur = 300
          if (!prefersReducedMotion) {
            shakeStart = now
            shakeAmp = 5
            shakeDur = 300
          }
        }
        // Let the death frame land before the parent swaps in the summary screen.
        // Unconditional 600ms — sequencing, not decoration, never gated on
        // prefersReducedMotion.
        window.setTimeout(onEnd, 600)
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // ---- Input: swipe + tap (bound to the canvas), keyboard, and the on-screen pad
    // (requestHop, called directly from this component's own JSX below). Swipe/tap
    // discrimination resolves at touchend by distance travelled — never guessed at
    // touchstart (UI-SPEC §8 / 19-CONTEXT.md's Controls section). ----
    const SWIPE_MIN_PX = 12
    let sx = 0
    let sy = 0
    let didSwipeThisTouch = false
    const onTouchStart = (e: TouchEvent) => {
      const p = e.touches[0]
      sx = p.clientX
      sy = p.clientY
      didSwipeThisTouch = false
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault() // canvas has touch-action:none; this stops pull-to-refresh
      // One touch = one hop. touchmove fires every few px, so without this latch a
      // single 30px flick crosses the threshold twice and hop() queues the second —
      // two blocks per swipe. Lift off to hop again.
      if (didSwipeThisTouch) return
      const p = e.touches[0]
      const dx = p.clientX - sx
      const dy = p.clientY - sy
      if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return
      requestHop(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up")
      didSwipeThisTouch = true
    }
    const onTouchEnd = () => {
      // The touch never crossed the swipe threshold during its whole lifetime — an
      // unambiguous tap, resolved here at release, never guessed at touchstart. A
      // tap hops forward.
      if (!didSwipeThisTouch) requestHop("up")
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      let dir: Dir | null = null
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          dir = "up"
          break
        case "ArrowDown":
        case "s":
        case "S":
          dir = "down"
          break
        case "ArrowLeft":
        case "a":
        case "A":
          dir = "left"
          break
        case "ArrowRight":
        case "d":
        case "D":
          dir = "right"
          break
        default:
          return
      }
      e.preventDefault()
      requestHop(dir)
    }
    canvas.addEventListener("touchstart", onTouchStart, { passive: true })
    canvas.addEventListener("touchmove", onTouchMove, { passive: false })
    canvas.addEventListener("touchend", onTouchEnd, { passive: true })
    window.addEventListener("keydown", onKeyDown)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      canvas.removeEventListener("touchstart", onTouchStart)
      canvas.removeEventListener("touchmove", onTouchMove)
      canvas.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("keydown", onKeyDown)
      // The run is claimed by the parent's Start button, so a mid-run unmount (dialog
      // closed, tab switched) still has to end it — otherwise the row sits ACTIVE
      // until the 5-minute server sweep.
      //
      // Guard on frames: React StrictMode's synchronous mount->cleanup->remount (dev)
      // fires this cleanup BEFORE the first RAF tick, and ending there would close
      // the run at score 0 the instant it opened — the game "killed you and shut"
      // without a single frame being simulated. frames > 0 means the loop really
      // ran; a sub-first-frame close is reconciled by the 5-minute server sweep
      // instead. Same guard Znake and Petris both carry.
      if (frames > 0 && !endedRef.current) {
        endedRef.current = true
        onEnd()
      }
    }
  }, [seed, onCollect, onEnd, requestHop])

  const padBtn =
    "flex h-12 touch-none select-none items-center justify-center rounded-xl bg-muted text-foreground ring-1 ring-border hover:bg-muted/70 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

  /** Pointerdown for instant mobile response; click kept for keyboard Enter/Space
   *  (same reasoning as Znake's padProps) — but gated on detail === 0, which only a
   *  keyboard-synthesised click carries. A real press fires BOTH pointerdown and
   *  click, and hop() queues the second one, so ungated that was two blocks per tap.
   *  Znake got away with it because turn() is idempotent; hop() is not.
   *
   *  Down = hop backward (toward the camera) — legal in Zross, unlike Znake's turn(),
   *  which rejects a 180-degree reversal. */
  const padProps = (dir: Dir) => ({
    type: "button" as const,
    className: padBtn,
    onPointerDown: () => requestHop(dir),
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) requestHop(dir)
    },
  })

  return (
    <div ref={rootRef} className="mx-auto flex flex-col items-center gap-3">
      {/* Portrait board (UI-SPEC §6): height is the binding CSS constraint, width
          auto-derives via aspect-ratio 7/9 — the inverse of Znake's width-bound
          square board. */}
      <div
        className="relative"
        style={{ height: "max(260px, min(calc(100dvh - 22rem), 360px))", aspectRatio: "7 / 9" }}
      >
        <canvas
          ref={canvasRef}
          style={{ touchAction: "none" }}
          className="block h-full w-full rounded-2xl ring-1 ring-border select-none"
          aria-label="Zross game canvas"
        />
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-0.5 rounded-md bg-black/40 px-2 py-1 text-[11px] font-semibold leading-tight text-white tabular-nums">
          <span>
            ZP <span ref={zpElRef}>0</span>
          </span>
          <span>
            Distance <span ref={distanceElRef}>0</span>m
          </span>
          <span>
            Tier <span ref={tierElRef}>1</span>
          </span>
        </div>
        {!started && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-black/45 text-center">
            <p className="animate-pulse px-6 text-sm font-semibold text-white text-pretty">
              Swipe or tap to hop
              <span className="mt-1 block text-xs font-medium text-white/70">
                Arrow keys, WASD, or the pad below
              </span>
            </p>
          </div>
        )}
      </div>

      {/* On-screen pad — below the canvas, never overlapping its swipe listener. */}
      <div className="grid w-[168px] grid-cols-3 gap-2">
        <span />
        <button {...padProps("up")} aria-label="Hop forward">
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
        <span />
        <button {...padProps("left")} aria-label="Hop left">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button {...padProps("down")} aria-label="Hop back">
          <ArrowDown className="h-5 w-5" aria-hidden="true" />
        </button>
        <button {...padProps("right")} aria-label="Hop right">
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
