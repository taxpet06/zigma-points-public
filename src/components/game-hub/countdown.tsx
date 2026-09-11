"use client"

// Shared live countdown to the next RESET_TZ midnight — shown when a daily game is
// used up (daily spin claimed, flappy ZP capped). One component so every game's
// "come back tomorrow" timer looks and ticks identically.

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { msUntilReset } from "@/lib/day-key"

export function Countdown({
  label = "Next reset in",
  onExpire,
}: {
  label?: string
  onExpire: () => void
}) {
  const [ms, setMs] = useState(msUntilReset)

  useEffect(() => {
    const id = setInterval(() => {
      const next = msUntilReset()
      setMs(next)
      if (next <= 0) onExpire() // reset passed — refetch status so the game unlocks
    }, 1000)
    return () => clearInterval(id)
  }, [onExpire])

  const total = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, "0")
  const hms = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-zinc-950 p-8 ring-1 ring-border">
      <Clock className="h-8 w-8 text-zinc-500" aria-hidden="true" />
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="font-mono text-4xl font-bold tabular-nums text-zinc-100" aria-live="polite">
        {hms}
      </p>
    </div>
  )
}
