"use client"
// IosInstallNudge — dismissible "Add to Home Screen" banner for iOS Safari
// visitors who haven't installed the app yet (PUSH-04). Push notifications on
// iOS require the app to be installed first (Web Push platform constraint), so
// this nudge explains why before the user reaches for "Enable notifications".
//
// UI-SPEC:
//   Only rendered client-side (isIOS/isStandalone need navigator/matchMedia,
//   both unavailable during SSR) — mounts closed and animates in on the next
//   frame, animates out on dismiss, persists the dismissal in localStorage.

import { useEffect, useState } from "react"
import { X, Smartphone } from "lucide-react"
import { isIOS, isStandalone } from "@/lib/pwa"

const DISMISS_KEY = "zigma:ios-install-nudge-dismissed"

export function IosInstallNudge() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let rafId: number | undefined
    // Deferred to a microtask so the setMounted update happens in a callback
    // rather than synchronously in the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!isIOS() || isStandalone()) return
      if (localStorage.getItem(DISMISS_KEY) === "1") return
      setMounted(true)
      // Mount closed, then flip open on the next frame so the enter transition plays.
      rafId = requestAnimationFrame(() => setOpen(true))
    })
    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId)
    }
  }, [])

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "1")
    setOpen(false)
  }

  if (!mounted) return null

  return (
    <div
      role="status"
      data-state={open ? "open" : "closed"}
      onAnimationEnd={() => {
        if (!open) setMounted(false)
      }}
      className="fixed inset-x-0 bottom-0 z-40 p-4 duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2"
    >
      <div className="flex items-start gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-lg">
        <Smartphone className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="flex-1 text-sm">
          Install Zigma Points to your Home Screen to get notifications — tap{" "}
          <strong className="font-semibold">Share</strong>, then{" "}
          <strong className="font-semibold">Add to Home Screen</strong>.
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
