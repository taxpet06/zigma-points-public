"use client"

// ImageCarousel — one-at-a-time image viewer for post/task attachments.
//
// Dependency-free (no embla/swiper): a translated flex track dragged 1:1 with the
// pointer. Navigation is ±1 with modulo wrap, so swiping past the last image loops
// back to the first (and vice-versa). Instagram-style chrome: "n/total" counter
// top-right, tappable dots bottom-center.
//
// Lives over the card's stretched title link (::after inset-0 overlay), so the
// caller wraps it in `relative z-10` — otherwise a drag would open the thread.
//
// ponytail: modulo wrap animates as a slide-back across the strip (fine for a
// handful of images). For a seamless infinite loop, clone first/last slides.

import { useRef, useState, useCallback, useEffect } from "react"
import { GameDialog } from "@/components/game-hub/game-dialog"

export function ImageCarousel({
  images,
  alt = "Attachment",
}: {
  images: string[]
  alt?: string
}) {
  const n = images.length
  const [index, setIndex] = useState(0)
  const [dragDX, setDragDX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [zoomed, setZoomed] = useState(false)

  const start = useRef<{ x: number; y: number; t: number; w: number; locked: boolean } | null>(null)
  // Was the last gesture a drag? Set on lock, reset on each pointerdown — so the
  // click that fires after a swipe doesn't also open the lightbox.
  const moved = useRef(false)

  const go = useCallback((next: number) => setIndex(((next % n) + n) % n), [n])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    moved.current = false
    if (n < 2) return
    start.current = {
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      // From the element being dragged, not a ref — the same handlers drive both the
      // inline carousel and the (wider) lightbox, and the 20% threshold is per-frame.
      w: e.currentTarget.clientWidth || 1,
      locked: false,
    }
  }, [n])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.locked) {
      // Only hijack the gesture once it's clearly horizontal — otherwise let the
      // page keep scrolling vertically (touch-action: pan-y handles the rest).
      if (Math.abs(dy) > Math.abs(dx)) { start.current = null; return }
      if (Math.abs(dx) < 6) return
      s.locked = true
      moved.current = true
      setDragging(true)
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    }
    setDragDX(dx)
  }, [])

  const finish = useCallback((commit: boolean, ts?: number) => {
    const s = start.current
    start.current = null
    setDragging(false)
    setDragDX(0)
    if (!s?.locked || !commit) return
    // Advance on distance (past 20% of the frame) OR a quick flick (velocity px/ms) —
    // a fast swipe shouldn't need to travel far. Direction comes from the sign of dx.
    const dx = dragDX
    const velocity = Math.abs(dx) / Math.max(1, (ts ?? s.t) - s.t)
    if (dx <= -s.w * 0.2 || (dx < -8 && velocity > 0.4)) go(index + 1)
    else if (dx >= s.w * 0.2 || (dx > 8 && velocity > 0.4)) go(index - 1)
  }, [dragDX, go, index])

  // Arrow keys in the lightbox — the desktop equivalent of the swipe. Window-level
  // because GameDialog owns focus, and only while zoomed so the feed is unaffected.
  useEffect(() => {
    if (!zoomed || n < 2) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1) }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [zoomed, n, index, go])

  const single = n < 2
  const drag = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent) => finish(true, e.timeStamp),
    onPointerCancel: () => finish(false),
  }

  return (
    <>
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={`${alt}${single ? "" : `, ${n} images`}`}
      className="relative aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted select-none"
      style={{ touchAction: "pan-y" }}
      {...drag}
      onClick={() => { if (!moved.current) setZoomed(true) }}
    >
      <Track images={images} alt={alt} index={index} dragDX={dragDX} dragging={dragging} fit="cover" />
      {!single && <Chrome n={n} index={index} go={go} />}
    </div>

    {/* Lightbox — the same modal games use (built-in X + maximize + Escape). Kept a
        SIBLING of the carousel, not a child: Radix portals it out of the DOM but React
        events still bubble through the component tree, so nesting it would let the close
        click re-hit the carousel's onClick and instantly reopen. */}
    <GameDialog open={zoomed} onOpenChange={setZoomed} title={alt} className="sm:max-w-3xl">
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={`${alt}${single ? "" : `, ${n} images`}`}
        className="relative h-[75dvh] overflow-hidden select-none"
        style={{ touchAction: "pan-y" }}
        {...drag}
      >
        <Track images={images} alt={alt} index={index} dragDX={dragDX} dragging={dragging} fit="contain" />
        {!single && <Chrome n={n} index={index} go={go} />}
      </div>
    </GameDialog>
    </>
  )
}

// The translated strip of images. Shared by the inline carousel and the lightbox so a
// swipe drags 1:1 and settles identically in both; only the object-fit differs (the
// feed crops to a 4:3 frame, the lightbox shows the whole photo).
function Track({
  images, alt, index, dragDX, dragging, fit,
}: {
  images: string[]
  alt: string
  index: number
  dragDX: number
  dragging: boolean
  fit: "cover" | "contain"
}) {
  const n = images.length
  return (
    <div
      className="flex h-full w-full ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{
        transform: `translateX(calc(${-index * 100}% + ${dragDX}px))`,
        transition: dragging ? "none" : "transform 340ms",
      }}
    >
      {images.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={n > 1 ? `${alt} ${i + 1} of ${n}` : alt}
          draggable={false}
          loading={i === 0 ? "eager" : "lazy"}
          decoding="async"
          className={
            "pointer-events-none h-full w-full shrink-0 " +
            (fit === "cover" ? "object-cover" : "object-contain")
          }
        />
      ))}
    </div>
  )
}

// Counter + dots. Shared by the inline carousel and the lightbox so both navigate
// the same way. Absolutely positioned — the parent must be `relative`.
function Chrome({ n, index, go }: { n: number; index: number; go: (i: number) => void }) {
  return (
    <>
      {/* Counter — legible over any photo, so a fixed dark chip (not theme tint). */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium tabular-nums text-white backdrop-blur-sm"
      >
        {index + 1}/{n}
      </div>

      {/* Dots — jump to any image; wider + brighter marks the current one. */}
      <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        {Array.from({ length: n }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to image ${i + 1}`}
            aria-current={i === index}
            onClick={(e) => { e.stopPropagation(); go(i) }}
            className={
              "h-1.5 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.6)] transition-[width,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none " +
              (i === index ? "w-4 opacity-100" : "w-1.5 opacity-60 hover:opacity-90")
            }
          />
        ))}
      </div>
    </>
  )
}
