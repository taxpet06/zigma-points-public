"use client"

// Mobile-native pull-to-refresh. When the window is scrolled to the very top and
// the user drags down, a spinner is revealed; releasing past the threshold runs
// onRefresh. Replaces the old manual refresh button.

import { useEffect, useRef, useState } from "react"
import { ZpLogo } from "@/components/nav/zp-logo"
import { cn } from "@/lib/utils"

const THRESHOLD = 64 // px of pull needed to trigger
const MAX_PULL = 96 // visual clamp

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>
  children: React.ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  // Refs mirror state so the touch listeners stay stable (bound once).
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    function onStart(e: TouchEvent) {
      if (refreshingRef.current) return
      if (window.scrollY <= 0 && e.touches.length === 1) {
        startY.current = e.touches[0]!.clientY
      }
    }
    function onMove(e: TouchEvent) {
      if (startY.current == null || refreshingRef.current) return
      const dy = e.touches[0]!.clientY - startY.current
      if (dy > 0 && window.scrollY <= 0) {
        // Resistance curve so the pull feels elastic, not 1:1
        const next = Math.min(dy * 0.5, MAX_PULL)
        pullRef.current = next
        setPull(next)
      } else if (dy <= 0) {
        startY.current = null
        pullRef.current = 0
        setPull(0)
      }
    }
    async function onEnd() {
      if (startY.current == null) return
      startY.current = null
      const reached = pullRef.current >= THRESHOLD
      if (reached) {
        refreshingRef.current = true
        setRefreshing(true)
        pullRef.current = THRESHOLD
        setPull(THRESHOLD)
        try {
          await onRefresh()
        } finally {
          refreshingRef.current = false
          setRefreshing(false)
          pullRef.current = 0
          setPull(0)
        }
      } else {
        pullRef.current = 0
        setPull(0)
      }
    }

    if (reduce) return // no gesture handling under reduced motion
    window.addEventListener("touchstart", onStart, { passive: true })
    window.addEventListener("touchmove", onMove, { passive: true })
    window.addEventListener("touchend", onEnd)
    window.addEventListener("touchcancel", onEnd)
    return () => {
      window.removeEventListener("touchstart", onStart)
      window.removeEventListener("touchmove", onMove)
      window.removeEventListener("touchend", onEnd)
      window.removeEventListener("touchcancel", onEnd)
    }
  }, [onRefresh])

  const active = pull > 0 || refreshing
  const progress = Math.min(pull / THRESHOLD, 1)

  return (
    <div className="relative">
      {/* Spinner indicator — sits above the content and is pushed down by the pull */}
      <div
        aria-hidden={!refreshing}
        className="pointer-events-none absolute inset-x-0 top-0 z-[var(--z-sticky)] flex justify-center"
        style={{
          transform: `translateY(${Math.max(pull - 36, -36)}px)`,
          opacity: active ? 1 : 0,
          transition: pull === 0 ? "transform 0.3s var(--ease-out-quint), opacity 0.2s" : "none",
        }}
      >
        <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full border bg-background shadow-md">
          <ZpLogo
            className={cn("h-4 w-auto", refreshing && "animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>

      {/* Content follows the finger slightly for tactile feedback */}
      <div
        style={{
          transform: active ? `translateY(${refreshing ? THRESHOLD * 0.5 : pull * 0.5}px)` : undefined,
          transition: pull === 0 ? "transform 0.3s var(--ease-out-quint)" : "none",
        }}
      >
        {children}
      </div>
    </div>
  )
}
