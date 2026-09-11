"use client"

// PlinkoBoard — the canvas host (11-UI-SPEC.md § Board Contract). Draws pegs and the bucket
// strip into a cached offscreen layer and animates balls along a SERVER-SUPPLIED bit path.
//
// This file never derives an outcome. It imports only the pure geometry/table exports of
// src/lib/casino/plinko.ts — never `derivePlinko`, never `floats`, never anything from
// fairness.ts. `launch({ path, bucket })` is handed the already-decided result; the ball's
// terminal x is `ballX(W, rows, rows, bucket)`, which the geometry sweep test in
// tests/unit/plinko-derive.test.ts proves equals `bucketCenterX(W, rows, bucket)` for every
// rows/bucket pair. That identity is what makes PLNK-02 a unit test instead of a UAT eyeball.

import * as React from "react"
import { ballX, bucketWidth, PLINKO_TABLES, type PlinkoRisk } from "@/lib/casino/plinko"

// There is NO reduced-motion path in this file. iOS Low Power Mode and Android battery saver
// both report `prefers-reduced-motion: reduce`, and a Plinko ball that does not fall is not a
// gentler game, it is a broken one. CasinoShell carries `.game-motion`, which exempts this
// subtree from the global CSS freeze; nothing here may re-introduce a gate.

const ROW_MS = 90 // AVERAGE per-row duration — total drop is rows * ROW_MS, spent unevenly (see below)
const GRAV_V0 = 0.4 // launch speed as a fraction of average; the rest is gravity. 0.4 -> 4x faster at the floor
const ARC_FACTOR = 0.18 // bounce height as a fraction of rowSpacing — one Math.sin, nothing more
const DEFLECT = 1.7 // sideways ease-out exponent: the peg kicks, then the ball coasts
const FLASH_MS = 400 // matches --duration-settle (globals.css)
const PEG_MS = 240 // peg strike pulse
const TRAIL_MS = 20 // spacing between the three ghost samples behind the ball

type Ball = {
  path: number[]
  /** prefix[i] = rights after i rows. Precomputed once so the frame loop allocates nothing. */
  prefix: number[]
  bucket: number
  start: number
  /** Last row whose departure peg has been flashed; -1 until the top peg is struck. */
  lastRow: number
  onLand: () => void
}

type Flash = { bucket: number; start: number }
type PegHit = { row: number; rights: number; start: number }

export type PlinkoBoardHandle = {
  launch: (ball: { path: number[]; bucket: number; onLand: () => void }) => void
  inFlight: () => number
}

type Props = {
  rows: number
  risk: PlinkoRisk
  ariaLabel: string
}

// Distance-from-centre alpha (11-UI-SPEC § Color) — faintest at the centre, strongest at the
// edges. Chip grid (11-05) uses the identical formula so a bucket and its chip read as the
// same colour at the same strength.
function bucketAlpha(k: number, rows: number): number {
  return 0.1 + 0.3 * (Math.abs(k - rows / 2) / (rows / 2))
}

function bucketColor(multiplier: number): string {
  return multiplier >= 1 ? "#059669" : "#B45309"
}

function bucketRect(w: number, rows: number, k: number) {
  const cellW = bucketWidth(w, rows)
  const rowSpacing = w / (rows + 2)
  const stripTop = rowSpacing * rows
  const stripH = rowSpacing * 1.5
  // 1px separator via a 0.5px inset on every edge — no stroke, no border, no rounding (a
  // rounded 19px cell loses more pixels to the corner than it can spare).
  return { x: k * cellW + 0.5, y: stripTop + 0.5, width: cellW - 1, height: stripH - 1 }
}

// One bucket cell — fill + (measured) label. Shared by the cached static layer and the landing
// pass, so a squashed bucket can never drift from its resting self. `squash` is a vertical
// scale about the cell's BOTTOM edge; `boost` adds to the resting alpha.
// Caller must have set ctx.font / textAlign / textBaseline.
function drawBucketCell(
  ctx: CanvasRenderingContext2D,
  w: number,
  rows: number,
  k: number,
  multiplier: number,
  ink: string,
  boost: number,
  squash: number,
) {
  const rect = bucketRect(w, rows, k)
  const h = rect.height * squash
  const y = rect.y + (rect.height - h)

  ctx.globalAlpha = bucketAlpha(k, rows) + boost
  ctx.fillStyle = bucketColor(multiplier)
  ctx.fillRect(rect.x, y, rect.width, h)
  ctx.globalAlpha = 1

  // The label gate — measured, not thresholded. There is NO `rows > N` row-count constant
  // here: the gate self-corrects across every viewport and font fallback. Its failure mode —
  // the label never renders and the payout chip grid (11-05) carries the number instead — is
  // the intended behaviour, not a bug. Shrinking the font below 11px to force 16-row labels
  // to fit is the wrong answer; don't.
  const label = `${multiplier}×`
  if (ctx.measureText(label).width + 6 <= rect.width + 1) {
    ctx.globalAlpha = 0.85
    ctx.fillStyle = ink
    ctx.fillText(label, rect.x + rect.width / 2, y + h / 2)
    ctx.globalAlpha = 1
  }
}

// The ball's position at `elapsed` ms into its drop. PURE and outcome-blind: it reads the
// server's bit path and nothing else, so the animation can never decide or leak the result.
// At elapsed === rows * ROW_MS this returns exactly ballX(w, rows, rows, bucket), which
// tests/unit/plinko-derive.test.ts proves equals bucketCenterX — that identity is the whole
// reason PLNK-02 is a unit test and not a UAT eyeball, and the gravity curve below is a
// reparameterisation of TIME only. It never touches the x endpoints.
function ballPoint(prefix: number[], path: number[], elapsed: number, w: number, rows: number) {
  const u = Math.min(1, Math.max(0, elapsed / (rows * ROW_MS)))
  // Constant launch speed + constant acceleration, integrated: rows * u * (v0 + (1-v0)u).
  // Hits exactly `rows` at u === 1, so no clamp is needed on the far end.
  const prog = rows * u * (GRAV_V0 + (1 - GRAV_V0) * u)
  const row = Math.min(rows - 1, Math.floor(prog))
  const f = prog - row
  const rowSpacing = w / (rows + 2)
  const x0 = ballX(w, rows, row, prefix[row])
  const x1 = ballX(w, rows, row + 1, prefix[row] + path[row])
  // Sideways ease-out: the peg imparts an impulse at the top of the row, then the ball coasts.
  // Linear here read as a slide down a wall; this reads as a deflection.
  const x = x0 + (x1 - x0) * (1 - Math.pow(1 - f, DEFLECT))
  const y = rowSpacing / 2 + (row + f) * rowSpacing - ARC_FACTOR * rowSpacing * Math.sin(Math.PI * f)
  return { x, y, row }
}

function pegRadius(rowSpacing: number): number {
  return Math.min(3, rowSpacing * 0.12)
}

export const PlinkoBoard = React.forwardRef<PlinkoBoardHandle, Props>(function PlinkoBoard(
  { rows, risk, ariaLabel },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const staticRef = React.useRef<HTMLCanvasElement | null>(null)
  const inkRef = React.useRef("black")
  const wRef = React.useRef(0) // measured CSS width, px
  const hRef = React.useRef(0) // measured CSS height, px
  const ballsRef = React.useRef<Ball[]>([])
  const flashesRef = React.useRef<Flash[]>([])
  const pegsRef = React.useRef<PegHit[]>([])
  const rafRef = React.useRef<number | null>(null)
  const rowsRef = React.useRef(rows)
  const riskRef = React.useRef(risk)
  rowsRef.current = rows
  riskRef.current = risk

  // Redraws only the pegs + bucket strip into the offscreen layer — never per animation frame.
  const redrawStatic = React.useCallback(() => {
    const stat = staticRef.current
    const w = wRef.current
    const h = hRef.current
    if (!stat || !w || !h) return
    const ctx = stat.getContext("2d")
    if (!ctx) return

    const currentRows = rowsRef.current
    const currentRisk = riskRef.current
    const ink = inkRef.current
    const rowSpacing = w / (currentRows + 2)

    ctx.clearRect(0, 0, w, h)

    // Pegs — filled circles, no stroke, no highlight, no shadow. Same ballX() the ball uses,
    // so a peg can never be somewhere the ball is not.
    const pegR = pegRadius(rowSpacing)
    ctx.globalAlpha = 0.3
    ctx.fillStyle = ink
    for (let i = 0; i < currentRows; i++) {
      const y = rowSpacing / 2 + i * rowSpacing
      for (let p = 0; p <= i; p++) {
        const x = ballX(w, currentRows, i, p)
        ctx.beginPath()
        ctx.arc(x, y, pegR, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    // Bucket strip — rows+1 square-edged cells, emerald/amber at the distance alpha.
    const table = PLINKO_TABLES[currentRisk][currentRows]
    ctx.font = '600 11px ui-monospace, "JetBrains Mono", monospace'
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    for (let k = 0; k <= currentRows; k++) {
      drawBucketCell(ctx, w, currentRows, k, table[k], ink, 0, 1)
    }
  }, [])

  // Draws one dynamic frame: the cached static layer, then flashes, then balls. Returns
  // whether anything still needs another frame (a ball in flight or a decaying flash).
  const renderFrame = React.useCallback((now: number) => {
    const canvasEl = canvasRef.current
    const stat = staticRef.current
    const w = wRef.current
    const h = hRef.current
    if (!canvasEl || !stat || !w || !h) return false
    const ctx = canvasEl.getContext("2d")
    if (!ctx) return false

    const currentRows = rowsRef.current
    const rowSpacing = w / (currentRows + 2)
    const ink = inkRef.current
    const table = PLINKO_TABLES[riskRef.current][currentRows]
    const cellW = bucketWidth(w, currentRows)

    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(stat, 0, 0, stat.width, stat.height, 0, 0, w, h)
    ctx.font = '600 11px ui-monospace, "JetBrains Mono", monospace'
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    // --- landed buckets: squash + settle -------------------------------------------------
    flashesRef.current = flashesRef.current.filter((f) => now - f.start < FLASH_MS)
    for (const f of flashesRef.current) {
      const multiplier = table[f.bucket]
      const rect = bucketRect(w, currentRows, f.bucket)
      const e = (now - f.start) / FLASH_MS
      const decay = Math.pow(1 - e, 3)
      // Impact depth scales with the size of the hit — a 0.2× graze barely dents the strip,
      // a 1000× hammers it. Log-compressed so the top of the HIGH table doesn't fold the
      // cell flat. This is a POST-LANDING reaction: the outcome is already on screen.
      const amp = 0.12 + 0.22 * Math.min(1, Math.log10(multiplier + 1) / 3)
      // Damped oscillation about the resting height, anchored at the bucket floor.
      const squash = 1 - amp * Math.exp(-5 * e) * Math.cos(14 * e)
      // The static layer already painted this cell at rest — clear it (separators included)
      // before repainting, or the squashed cell peeks out from under its own full-height self.
      ctx.clearRect(f.bucket * cellW, rect.y - 0.5, cellW, rect.height + 1)
      drawBucketCell(ctx, w, currentRows, f.bucket, multiplier, ink, 0.35 * decay, squash)
    }

    // --- struck pegs: a brief pulse -------------------------------------------------------
    const pegR = pegRadius(rowSpacing)
    pegsRef.current = pegsRef.current.filter((p) => now - p.start < PEG_MS)
    ctx.fillStyle = ink
    for (const p of pegsRef.current) {
      const decay = Math.pow(1 - (now - p.start) / PEG_MS, 2)
      ctx.globalAlpha = 0.55 * decay
      ctx.beginPath()
      ctx.arc(ballX(w, currentRows, p.row, p.rights), rowSpacing / 2 + p.row * rowSpacing, pegR * (1 + 0.9 * decay), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // --- balls ----------------------------------------------------------------------------
    // A ball is NEVER coloured, sized or styled by its own outcome — every ball uses the same
    // ink fill and the same radius formula regardless of which bucket it is heading for, and
    // the trail is the same three fixed samples for all of them. Styling by outcome would
    // leak the result mid-flight (T-11-16).
    const r = Math.min(7, rowSpacing * 0.22)
    const total = currentRows * ROW_MS
    const nextBalls: Ball[] = []
    for (const ball of ballsRef.current) {
      const elapsed = now - ball.start
      if (elapsed >= total) {
        // Terminal x equals bucketCenterX(W, rows, bucket) by construction: `rights` at
        // row === rows is sum(path), which IS the bucket. Proved as `geometry` in
        // tests/unit/plinko-derive.test.ts — this is a rendering of that identity, not a
        // second implementation of it.
        flashesRef.current.push({ bucket: ball.bucket, start: now })
        ball.onLand()
        continue
      }
      const { x, y, row } = ballPoint(ball.prefix, ball.path, elapsed, w, currentRows)

      // Entering a row means the ball just came off that row's peg — pulse it once.
      if (row > ball.lastRow) {
        ball.lastRow = row
        pegsRef.current.push({ row, rights: ball.prefix[row], start: now })
      }

      // Three ghosts sampled behind the ball on the same pure curve — no history buffer, and
      // the trail bends through the deflections exactly as the ball did.
      ctx.fillStyle = ink
      for (let g = 3; g >= 1; g--) {
        const ghost = ballPoint(ball.prefix, ball.path, elapsed - g * TRAIL_MS, w, currentRows)
        ctx.globalAlpha = 0.3 / g
        ctx.beginPath()
        ctx.arc(ghost.x, ghost.y, r * (1 - 0.15 * g), 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      nextBalls.push(ball)
    }
    ballsRef.current = nextBalls

    return nextBalls.length > 0 || flashesRef.current.length > 0 || pegsRef.current.length > 0
  }, [])

  const loopRef = React.useRef<(now: number) => void>(() => {})
  loopRef.current = (now: number) => {
    const active = renderFrame(now)
    if (active) {
      rafRef.current = requestAnimationFrame(loopRef.current)
    } else if (rafRef.current != null) {
      // The RAF loop sleeps the moment nothing is in flight — a permanently running loop
      // inside an open dialog is a battery bug (T-11-18).
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  React.useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const stat = document.createElement("canvas")
    staticRef.current = stat

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    function syncCanvasSize() {
      const w = canvasEl!.clientWidth
      const h = canvasEl!.clientHeight
      if (!w || !h) return
      wRef.current = w
      hRef.current = h
      canvasEl!.width = Math.round(w * dpr)
      canvasEl!.height = Math.round(h * dpr)
      stat.width = canvasEl!.width
      stat.height = canvasEl!.height
      const ctx = canvasEl!.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // the width write resets the transform
      const statCtx = stat.getContext("2d")
      if (statCtx) statCtx.scale(dpr, dpr) // width write already reset it to identity
      inkRef.current = getComputedStyle(canvasEl!).color // canvas carries text-foreground
      redrawStatic()
      renderFrame(performance.now())
    }
    syncCanvasSize()
    const resizeObserver = new ResizeObserver(syncCanvasSize)
    resizeObserver.observe(canvasEl)

    return () => {
      resizeObserver.disconnect()
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rows/risk change: redraw the static layer only — no reflow (pure aspect-ratio below),
  // and controls are locked while balls are in flight so this never races a launch.
  React.useEffect(() => {
    redrawStatic()
    renderFrame(performance.now())
  }, [rows, risk, redrawStatic, renderFrame])

  React.useImperativeHandle(
    ref,
    () => ({
      launch(ball) {
        // prefix[i] = rights after i rows, computed once here rather than re-reduced every
        // frame for every ball (and again for every trail ghost).
        const prefix: number[] = [0]
        for (const bit of ball.path) prefix.push(prefix[prefix.length - 1] + bit)
        ballsRef.current.push({
          path: ball.path,
          prefix,
          bucket: ball.bucket,
          onLand: ball.onLand,
          start: performance.now(),
          lastRow: -1,
        })
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(loopRef.current)
        }
      },
      inFlight() {
        return ballsRef.current.length
      },
    }),
    [],
  )

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      className="block w-full text-foreground"
      style={{ aspectRatio: `${rows + 2} / ${rows + 1.5}` }}
    />
  )
})
