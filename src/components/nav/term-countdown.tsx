"use client"

// Header countdown to the end of the current term.
//
// The clock runs entirely client-side: the server hands over endsAt once and every
// tick after that is local, so a cached page never shows a frozen number and the
// server does no per-second work.
//
// `now` starts at 0 so the server render and the first client render agree — the pill
// shows a dash until the store is subscribed, one commit later.

import { useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { navItemClass } from "@/components/nav/nav-item"
import { cn } from "@/lib/utils"

export function formatTermRemaining(endsAt: Date, now: number) {
  const ms = endsAt.getTime() - now
  if (ms <= 0) return "Term Ended"
  // Floor to whole minutes — the last minute reads "0m" rather than ticking seconds.
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`
}

// The clock itself, as an external store: the interval owns the value and React just
// reads it. Server snapshot is 0, which renders the dash — so SSR and hydration agree.
let tick = 0
function subscribe(onChange: () => void) {
  tick = Date.now()
  const id = setInterval(() => {
    tick = Date.now()
    onChange()
  }, 1000)
  return () => clearInterval(id)
}

export function TermCountdown({ enabled }: { enabled: boolean }) {
  const trpc = useTRPC()
  const { data: term } = useQuery(
    trpc.term.getCurrent.queryOptions(undefined, {
      enabled,
      // The window only changes when an admin edits it — no need to poll hard.
      staleTime: 5 * 60_000,
    }),
  )

  const now = useSyncExternalStore(subscribe, () => tick, () => 0)

  if (!term) return null

  return (
    <span
      title={`${term.name} — ends ${new Date(term.endsAt).toLocaleString()}`}
      className={cn(
        navItemClass,
        "shrink-0 px-2.5 font-mono text-xs font-medium tabular-nums text-foreground sm:text-sm",
      )}
    >
      {now === 0 ? "—" : formatTermRemaining(new Date(term.endsAt), now)}
    </span>
  )
}
