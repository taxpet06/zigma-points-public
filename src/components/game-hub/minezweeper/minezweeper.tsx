"use client"

// MineZweeper — the daily 16x16 / 40-mine Minesweeper board.
//
// Same contract as Wordle: one board a day for everyone, progress in localStorage keyed
// by the day (so a finished board reloads finished), and the server is the authority on
// whether you played and what you earned. board.ts is shared with the router, so the
// board you clear is the board it verifies.
//
// Two things here are not in Wordle:
//
//   1. The board is bigger than a phone. Rather than shrinking 256 tiles until they're
//      untappable, the board keeps ~34px tiles inside a fixed viewport and is PANNED and
//      PINCHED. All of that is one pointer-event handler on the viewport — no gesture
//      library, and the transform is written straight to the node (a ref, not state) so
//      a drag never re-renders 256 buttons.
//
//   2. There are two gestures on the same pixel: tap reveals, long-press flags. Every
//      pointer goes through the ONE handler set on the viewport, which owns the timer,
//      the slop threshold and the "a second finger arrived" cancel — a tile can't reveal
//      itself behind the pan's back. The tiles are still real <button>s for keyboard and
//      screen readers; their onClick only acts on detail === 0 (keyboard activation), so
//      the synthetic click after a touch can't double-fire or undo a long-press flag.
//
// Losing still burns the day. That's the design: one board, one outcome, no replays.
//
// Motion (globals.css, the mz-* block): the cascade radiates out from the tap, flags
// plant, a hit mine explodes and shocks the board, a clear plays a diagonal emerald
// sweep. None of it is tagged .game-motion, so it all collapses to instant under
// prefers-reduced-motion — see the delay override at the end of that block.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bomb, Flag, Maximize2, Move, Pointer, ZoomIn } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { GameCard } from "../game-card"
import { GameDialog } from "../game-dialog"
import { ZpRules } from "../zp-rules"
import { boardForDay, cascade, CELLS, COLS, MINE_COUNT } from "./board"
import { dayKey } from "@/lib/day-key"
import { MINEZWEEPER_ZP } from "@/lib/game-economy"
import { cn } from "@/lib/utils"

const STORE_KEY = "zigma-minezweeper"
const SAFE_CELLS = CELLS - MINE_COUNT

// Tiles never shrink to fit the screen — the viewport pans over them instead.
const TILE = 34
const GAP = 2
const BOARD_PX = COLS * TILE + (COLS - 1) * GAP
// 0.45, not 0.55: the opening view is meant to show all 16 columns, and at 360x640 the
// dialog gives the board a 310px viewport for 574px of board — a 0.54 fit. A 0.55 floor
// clamped that back up and clipped the last column, i.e. the one thing the fit exists to
// prevent. 0.45 keeps the whole board visible down to ~306px of viewport, below any real
// phone. Tiles are ~18px at that zoom; the board is a preview until you pinch in.
const K_MIN = 0.45
const K_MAX = 2.5

const TAP_SLOP = 8 // px of travel that turns a tap into a pan
const LONG_PRESS_MS = 450

// The classic number palette, lifted onto the 400 ramp: the originals (navy 4, maroon 5)
// are unreadable on a zinc-950 board. Index = the count, so index 0 is never used.
const NUM_COLOR = [
  "",
  "#60a5fa",
  "#34d399",
  "#f87171",
  "#818cf8",
  "#fb7185",
  "#2dd4bf",
  "#ffffff",
  "#a1a1aa",
]

type Status = "playing" | "won" | "lost"
type Saved = {
  day: string
  first: number | null
  revealed: number[]
  flags: number[]
  status: Status
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const nums = (v: unknown) =>
  Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n >= 0 && n < CELLS) : []

/** Today's saved board from localStorage, or a fresh one. Server-safe (no window → fresh),
 *  so it works as a useState initializer exactly like Wordle's. */
function loadSaved(day: string): {
  first: number | null
  revealed: Set<number>
  flags: Set<number>
  status: Status
} {
  const fresh = { first: null, revealed: new Set<number>(), flags: new Set<number>(), status: "playing" as Status }
  if (typeof window === "undefined") return fresh
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return fresh
    const s = JSON.parse(raw) as Saved
    if (s.day !== day) return fresh
    return {
      first: nums([s.first])[0] ?? null,
      revealed: new Set(nums(s.revealed)),
      flags: new Set(nums(s.flags)),
      status: s.status === "won" || s.status === "lost" ? s.status : "playing",
    }
  } catch {
    return fresh
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* storage full/blocked → board still playable this session */
  }
}

export function Minezweeper({ index = 0 }: { index?: number }) {
  const [open, setOpen] = useState(false)

  // false on the server and during hydration, true after — gates the card's stored
  // hint/ping so server and first client render agree (no hydration mismatch).
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const [day] = useState(dayKey)
  const [first, setFirst] = useState<number | null>(() => loadSaved(day).first)
  const [revealed, setRevealed] = useState<Set<number>>(() => loadSaved(day).revealed)
  const [flags, setFlags] = useState<Set<number>>(() => loadSaved(day).flags)
  const [status, setStatus] = useState<Status>(() => loadSaved(day).status)
  const [boom, setBoom] = useState<number | null>(null)
  // Cell → its position in the cascade that revealed it. Drives --d, the reveal stagger,
  // which is what makes the flood-fill radiate out of the tapped cell.
  const [order, setOrder] = useState<Map<number, number>>(() => new Map())
  const [message, setMessage] = useState("")
  // Flag mode: every tap plants a flag instead of revealing, and the long-press is off
  // (holding in flag mode does nothing — the tap already flags).
  const [flagMode, setFlagMode] = useState(false)
  const msgTimer = useRef<number | undefined>(undefined)

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const statusQ = useQuery(
    trpc.minezweeper.getStatus.queryOptions(undefined, {
      enabled: authStatus === "authenticated",
    }),
  )
  const serverPlayed = statusQ.data?.playedToday === true
  const serverResult = statusQ.data?.result ?? null

  const claim = useMutation(trpc.minezweeper.claim.mutationOptions())

  useEffect(() => () => window.clearTimeout(msgTimer.current), [])

  // The layout doesn't exist until the player commits to a first cell — that's what makes
  // the "first tap is always safe" relocation honest rather than a reroll.
  const board = useMemo(() => (first === null ? null : boardForDay(day, first)), [day, first])

  // Server truth beats local state: a result row means this account already finished
  // today's board somewhere. One guard at the single input funnel covers reveal AND flag.
  const lockedOut = serverPlayed && status === "playing"
  const over = status !== "playing"

  // ...and it runs the other way too. A FINISHED board in localStorage with no result row
  // means the server never recorded the day — the claim didn't land (offline), or the day
  // was handed back. The row is the record, so a stale local "lost" must not keep the
  // board locked until midnight; without this the only cure is clearing site data.
  // Restored state only: a loss from THIS session is still settling, and its getStatus is
  // stale until claim's invalidate lands — resetting on that would un-lose a live board.
  const playedThisSession = useRef(false)
  useEffect(() => {
    if (playedThisSession.current || !over || statusQ.data?.playedToday !== false) return
    setFirst(null)
    setRevealed(new Set())
    setFlags(new Set())
    setOrder(new Map())
    setBoom(null)
    setStatus("playing")
    save({ day, first: null, revealed: [], flags: [], status: "playing" })
  }, [over, statusQ.data, day])

  function flash(text: string, sticky = false) {
    window.clearTimeout(msgTimer.current)
    setMessage(text)
    if (!sticky) msgTimer.current = window.setTimeout(() => setMessage(""), 1400)
  }

  function submit(f: number, cells: number[]) {
    claim.mutate(
      { first: f, revealed: cells },
      {
        onSuccess: (d) => {
          if (d.won) flash(`Cleared it — +${d.zp} ZP`, true)
          void qc.invalidateQueries(trpc.user.getMe.queryFilter())
          void qc.invalidateQueries(trpc.minezweeper.getStatus.queryFilter())
        },
        // A CONFLICT just means the day was already recorded — the board on screen
        // already shows the outcome, there's simply no second payout.
      },
    )
  }

  function reveal(i: number) {
    if (over || lockedOut || flags.has(i) || revealed.has(i)) return
    playedThisSession.current = true // this board is live; the reset above is for restored state
    const f = first ?? i
    const b = board ?? boardForDay(day, i) // first tap: the memo hasn't seen `first` yet
    if (first === null) setFirst(i)

    if (b.mines.has(i)) {
      const mines = [...b.mines].sort((a, c) => a - c)
      const next = new Set(revealed)
      const ord = new Map(order)
      // Spread all 40 across the stagger's 0..14 range so the board unzips end to end
      // instead of the tail all landing on the same capped delay.
      mines.forEach((m, n) => {
        next.add(m)
        ord.set(m, Math.floor((n * 14) / mines.length))
      })
      setRevealed(next)
      setOrder(ord)
      setStatus("lost")
      setBoom(i)
      save({ day, first: f, revealed: [...next], flags: [...flags], status: "lost" })
      flash("Boom. That's today's board.", true)
      submit(f, [...revealed]) // the honest set, before the mines were exposed
      return
    }

    const added = cascade(b.counts, b.mines, i, revealed)
    const next = new Set(revealed)
    const ord = new Map(order)
    added.forEach((c, n) => {
      next.add(c)
      ord.set(c, n)
    })
    const won = next.size === SAFE_CELLS
    setRevealed(next)
    setOrder(ord)
    if (won) {
      setStatus("won")
      flash("Cleared it!", true)
      submit(f, [...next])
    }
    save({ day, first: f, revealed: [...next], flags: [...flags], status: won ? "won" : "playing" })
  }

  function toggleFlag(i: number) {
    if (over || lockedOut || revealed.has(i)) return
    const next = new Set(flags)
    if (!next.delete(i)) next.add(i)
    setFlags(next)
    save({ day, first, revealed: [...revealed], flags: [...next], status })
    navigator.vibrate?.(15)
  }

  // ---------------------------------------------------------------------------
  // Viewport: pan / pinch / tap / long-press, all from one pointer handler set.
  // The transform is written straight to the board node — panning 256 buttons through
  // React state would re-render the whole grid on every pointermove.
  // ---------------------------------------------------------------------------

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const view = useRef({ x: 0, y: 0, k: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef(0)
  // Keyboard activation never fires a pointer event, which is how the tiles' onClick tells
  // a real Enter/Space apart from the synthetic click a touch leaves behind. detail === 0
  // alone isn't enough: some browsers report 0 for touch-derived clicks too, and that
  // click landing after a long-press that UNflagged a cell would reveal it.
  const lastPointerAt = useRef(0)
  // A touch long-press fires `contextmenu` too (Chrome Android at ~500ms, Safari), i.e.
  // ~50ms AFTER our own 450ms timer has already planted the flag — and the second toggle
  // took it straight back off. That's the mobile bug: the counter moves, no flag lands.
  // Stamped only by the timer, so a desktop right-click still flags normally.
  const pressFlaggedAt = useRef(0)
  const gesture = useRef<{
    id: number
    cell: number | null
    sx: number
    sy: number
    moved: boolean
    consumed: boolean
    timer: number
  } | null>(null)

  const applyView = useCallback(() => {
    const { x, y, k } = view.current
    if (boardRef.current) {
      boardRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`
    }
  }, [])

  /** Clamp so at least a quarter of the board stays inside the viewport in each axis —
   *  you can push it around freely but never lose it off-screen entirely. */
  const clampView = useCallback((x: number, y: number, k: number) => {
    const vp = viewportRef.current
    if (!vp) return { x, y, k }
    const size = BOARD_PX * k
    return {
      k,
      x: clamp(x, -size * 0.75, vp.clientWidth - size * 0.25),
      y: clamp(y, -size * 0.75, vp.clientHeight - size * 0.25),
    }
  }, [])

  /** Whole board visible, centred. The player zooms IN to play rather than opening
   *  lost in a corner. */
  const fitView = useCallback(() => {
    const run = (tries: number) => {
      const vp = viewportRef.current
      if (!vp) return
      const w = vp.clientWidth
      const h = vp.clientHeight
      // The dialog can mount a frame before it has a size; retry a couple of frames
      // rather than baking in a wrong initial zoom.
      if ((w === 0 || h === 0) && tries < 5) {
        requestAnimationFrame(() => run(tries + 1))
        return
      }
      const k = clamp(Math.min(w / BOARD_PX, h / BOARD_PX), K_MIN, K_MAX)
      view.current = { k, x: (w - BOARD_PX * k) / 2, y: (h - BOARD_PX * k) / 2 }
      applyView()
    }
    run(0)
  }, [applyView])

  // Callback ref instead of an effect: the viewport only exists once the dialog opens,
  // and this fires exactly then (and again on any remount) with no `open` dependency.
  const mountViewport = useCallback(
    (el: HTMLDivElement | null) => {
      viewportRef.current = el
      if (el) fitView()
    },
    [fitView],
  )

  function cancelPending() {
    if (gesture.current) {
      window.clearTimeout(gesture.current.timer)
      gesture.current.moved = true
    }
  }

  function cellFrom(target: EventTarget | null): number | null {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-cell]")
    return el ? Number(el.dataset.cell) : null
  }

  function spread() {
    const [a, b] = [...pointers.current.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button === 2) return // right-click is the desktop flag, handled by onContextMenu
    viewportRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      // A second finger means a pinch, never a tap — kill whatever the first one started.
      cancelPending()
      pinchDist.current = spread().d
      return
    }
    if (pointers.current.size > 2) return

    const cell = cellFrom(e.target)
    const g = { id: e.pointerId, cell, sx: e.clientX, sy: e.clientY, moved: false, consumed: false, timer: 0 }
    gesture.current = g
    if (cell !== null && !flagMode) {
      g.timer = window.setTimeout(() => {
        if (g.moved) return
        g.consumed = true // so the pointerup doesn't also reveal the cell we just flagged
        pressFlaggedAt.current = performance.now()
        toggleFlag(cell)
      }, LONG_PRESS_MS)
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY

    if (pointers.current.size >= 2) {
      const { d, mx, my } = spread()
      const vp = viewportRef.current
      if (pinchDist.current > 0 && d > 0 && vp) {
        const r = vp.getBoundingClientRect()
        const px = mx - r.left
        const py = my - r.top
        const v = view.current
        const k = clamp(v.k * (d / pinchDist.current), K_MIN, K_MAX)
        const f = k / v.k // the point under the fingers must not move
        view.current = clampView(px - (px - v.x) * f, py - (py - v.y) * f, k)
        applyView()
      }
      pinchDist.current = d
      return
    }

    const g = gesture.current
    if (g && g.id === e.pointerId && !g.moved) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) <= TAP_SLOP) return // still a tap
      g.moved = true
      window.clearTimeout(g.timer)
    }
    const v = view.current
    view.current = clampView(v.x + dx, v.y + dy, v.k)
    applyView()
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>, tapped: boolean) {
    pointers.current.delete(e.pointerId)
    lastPointerAt.current = e.timeStamp
    if (pointers.current.size < 2) pinchDist.current = 0
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    window.clearTimeout(g.timer)
    gesture.current = null
    if (tapped && !g.consumed && !g.moved && g.cell !== null) {
      if (flagMode) toggleFlag(g.cell)
      else reveal(g.cell)
    }
  }

  const played = over || serverPlayed
  const hint = !isClient
    ? "Daily minesweeper"
    : status === "won"
      ? "Cleared it"
      : status === "lost"
        ? "Back tomorrow"
        : serverPlayed
          ? serverResult?.won
            ? "Cleared it"
            : "Back tomorrow"
          : revealed.size > 0
            ? "In progress"
            : "New board ready"

  return (
    <>
      <GameCard
        // Flag, not Bomb: Bomb AXA is the game that's literally about bombs, and two
        // identical icons in one grid read as one game rendered twice. The flag is also
        // the truer verb here — you win by flagging, you lose by finding a bomb.
        icon={Flag}
        name="MineZweeper"
        hint={hint}
        available={isClient && !played}
        index={index}
        onClick={() => setOpen(true)}
        ariaLabel="MineZweeper — the daily minesweeper board"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="MineZweeper"
        description="16×16, 40 mines. One board a day for everyone, new board at midnight America/New_York."
      >
        {lockedOut && (
          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-sm font-medium">You&rsquo;ve already played today&rsquo;s board.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {serverResult?.won ? `Cleared it — +${serverResult.zp} ZP.` : "It got you this time."}{" "}
              One board a day, for everyone.
            </p>
          </div>
        )}

        {/* The long-press flag is the one control nobody guesses. It lives here, above the
            board, on every visit — not tucked into the ZP panel. */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Pointer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {flagMode ? "Tap to flag" : "Tap to reveal"}
          </span>
          {!flagMode && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <Flag className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
              Hold to flag
            </span>
          )}
          <span className="flex items-center gap-1">
            <Move className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Drag to pan
          </span>
          <span className="flex items-center gap-1">
            <ZoomIn className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Pinch to zoom
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <Flag className="h-4 w-4 text-red-500" aria-hidden="true" />
            <span aria-label={`${MINE_COUNT - flags.size} mines left to flag`}>
              {MINE_COUNT - flags.size}
            </span>
            <span className="text-xs font-normal text-muted-foreground">left</span>
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={flagMode}
              onClick={() => setFlagMode((v) => !v)}
              className={cn(
                "gap-1.5 text-xs [&_svg]:size-3.5",
                flagMode && "border-red-500/50 bg-red-500/15 text-red-500 hover:bg-red-500/25 hover:text-red-500",
              )}
            >
              <Flag aria-hidden="true" />
              Flag mode
            </Button>
            <button
              type="button"
              /* Re-centres the view. There is no "new board" button, by design. */
              onClick={() => fitView()}
              className="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              Fit board
            </button>
          </div>
        </div>

        <div
          ref={mountViewport}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e, true)}
          onPointerCancel={(e) => endPointer(e, false)}
          onContextMenu={(e) => {
            e.preventDefault()
            // The long-press that just flagged is the same press this menu came from —
            // toggling again would undo it. (The other order is already safe: an early
            // contextmenu cancels the pending timer.)
            if (e.timeStamp - pressFlaggedAt.current < 600) return
            const cell = cellFrom(e.target)
            if (cell !== null) {
              cancelPending()
              toggleFlag(cell)
            }
          }}
          // touch-action none so the pan owns the gesture, overscroll contain so a drag
          // that runs off the board never turns into the dialog (or the page) scrolling.
          style={{ touchAction: "none", overscrollBehavior: "contain", WebkitTouchCallout: "none" }}
          // The shake and the ring/glow live here, not on the board node: the board's
          // transform belongs to the pan/pinch handler and an animation would fight it.
          className={cn(
            "relative h-[min(62vh,24rem)] touch-none select-none overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-border",
            status === "lost" && "mz-shock",
            status === "won" && "mz-win-glow",
          )}
        >
          <div
            ref={boardRef}
            className="absolute left-0 top-0 grid"
            style={{
              gridTemplateColumns: `repeat(${COLS}, ${TILE}px)`,
              gap: `${GAP}px`,
              width: BOARD_PX,
              transformOrigin: "0 0",
              willChange: "transform",
            }}
          >
            {Array.from({ length: CELLS }, (_, i) => {
              const r = Math.floor(i / COLS)
              const c = i % COLS
              const isMine = board?.mines.has(i) ?? false
              const shown = revealed.has(i)
              const flagged = flags.has(i)
              const count = board ? board.counts[i] : 0
              const label = `Row ${r + 1}, column ${c + 1}, ${
                shown
                  ? isMine
                    ? "mine"
                    : count === 0
                      ? "empty"
                      : `${count} ${count === 1 ? "mine" : "mines"} nearby`
                  : flagged
                    ? "flagged"
                    : "hidden"
              }`
              return (
                <button
                  key={i}
                  type="button"
                  data-cell={i}
                  aria-label={label}
                  // Pointer input is funnelled through the viewport above. This path is
                  // the keyboard's only way in — see lastPointerAt.
                  onClick={(e) => {
                    if (e.detail !== 0 || e.timeStamp - lastPointerAt.current <= 400) return
                    if (flagMode) toggleFlag(i)
                    else reveal(i)
                  }}
                  style={
                    {
                      "--d": order.get(i) ?? 0,
                      "--r": r,
                      "--c": c,
                      height: TILE,
                      ...(shown && !isMine && count > 0 ? { color: NUM_COLOR[count] } : {}),
                    } as React.CSSProperties
                  }
                  className={cn(
                    "flex items-center justify-center rounded-[3px] text-[15px] font-bold leading-none tabular-nums outline-none",
                    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
                    shown
                      ? isMine
                        ? i === boom
                          ? "mz-boom bg-red-600 text-white"
                          : "mz-cell-reveal bg-zinc-900 text-red-400 ring-1 ring-inset ring-red-500/25"
                        : cn(
                            "bg-zinc-900 ring-1 ring-inset ring-white/5",
                            status === "won" ? "mz-cell-win" : "mz-cell-reveal",
                          )
                      : cn(
                          "mz-tile bg-gradient-to-br from-zinc-600 to-zinc-700",
                          flagged && "mz-tile-flagged",
                          !over && !lockedOut && "hover:from-zinc-500 hover:to-zinc-600",
                        ),
                  )}
                >
                  {shown ? (
                    isMine ? (
                      <Bomb className="h-4 w-4" aria-hidden="true" />
                    ) : count > 0 ? (
                      count
                    ) : null
                  ) : flagged ? (
                    <Flag className="mz-flag-icon h-4 w-4 text-red-500" aria-hidden="true" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <p
          aria-live="polite"
          className={cn(
            "min-h-5 text-center text-sm font-medium",
            status === "won" ? "text-emerald-500" : status === "lost" ? "text-red-500" : "text-foreground",
          )}
        >
          {message}
        </p>

        <ZpRules
          rules={[
            { what: "Cleared the board", zp: `+${MINEZWEEPER_ZP} ZP` },
            { what: "Hit a mine", zp: "0 ZP" },
          ]}
          replayNote="One board a day, the same board for everyone — no replays, at any price. New board at midnight America/New_York."
        />
      </GameDialog>
    </>
  )
}
