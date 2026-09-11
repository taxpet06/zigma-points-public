import type { CSSProperties } from "react"

/**
 * App-wide animated backdrop — a skewed grid that drifts diagonally (top-right →
 * bottom-left) with squares that light up and fade, locked to grid cells. All
 * motion is pure CSS (`.app-bg*` in globals.css); this only lays out the plane,
 * the drifting track, and two copies of the square field (the duplicate keeps
 * the drift loop seamless). Server-rendered, no deps.
 */

// Grid cell size in px — MUST match `--grid-cell` in globals.css so squares
// snap to cell boundaries.
const CELL = 40

// Lit squares as grid coordinates [col, row] (× CELL = px, so they sit exactly
// on cells) plus pulse duration and start delay. Fixed values → server and
// client render identically. Spread over a wide field so plenty stay on-screen.
// `dur` values are divisors of the 60s drift loop so every square is at the same
// pulse phase at the loop boundary — keeps the seamless loop flicker-free.
const CELLS: Array<{ col: number; row: number; dur: string; delay: string }> = [
  { col: 6, row: 9, dur: "10s", delay: "0s" },
  { col: 10, row: 4, dur: "15s", delay: "1.2s" },
  { col: 14, row: 15, dur: "6s", delay: "3s" },
  { col: 20, row: 6, dur: "20s", delay: "0.6s" },
  { col: 24, row: 12, dur: "12s", delay: "2.4s" },
  { col: 28, row: 3, dur: "5s", delay: "4.5s" },
  { col: 30, row: 17, dur: "15s", delay: "1.8s" },
  { col: 34, row: 8, dur: "6s", delay: "5.2s" },
  { col: 16, row: 21, dur: "12s", delay: "0.9s" },
  { col: 8, row: 13, dur: "10s", delay: "3.6s" },
  { col: 22, row: 19, dur: "20s", delay: "2s" },
  { col: 26, row: 7, dur: "6s", delay: "4s" },
  { col: 32, row: 14, dur: "15s", delay: "6s" },
  { col: 12, row: 2, dur: "12s", delay: "2.8s" },
  { col: 18, row: 10, dur: "10s", delay: "5.5s" },
  { col: 4, row: 17, dur: "20s", delay: "1.5s" },
]

function cells() {
  return CELLS.map((c, i) => (
    <span
      key={i}
      className="app-cell"
      style={
        {
          left: `${c.col * CELL}px`,
          top: `${c.row * CELL}px`,
          "--pop-dur": c.dur,
          "--pop-delay": c.delay,
        } as CSSProperties
      }
    />
  ))
}

export function AppBackdrop() {
  return (
    <div className="app-bg-plane">
      <div className="app-bg-track">
        <div className="app-bg-cells">{cells()}</div>
        <div className="app-bg-cells app-bg-cells--dup">{cells()}</div>
      </div>
    </div>
  )
}
