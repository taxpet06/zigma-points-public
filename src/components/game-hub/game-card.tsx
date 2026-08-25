"use client"

// GameCard — one tile in the game hub. Mirrors the People grid card
// (components/feed/home-tabs.tsx PeopleList): same shell, motion, and footprint,
// with a game icon where the avatar sits. Every game renders one so the hub reads
// as a single grid. `available` shows the same ping the slot uses in the header.

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function GameCard({
  icon: Icon,
  name,
  hint,
  available = false,
  onClick,
  index = 0,
  ariaLabel,
  disabled = false,
}: {
  icon: LucideIcon
  name: string
  hint: string
  available?: boolean
  onClick: () => void
  index?: number
  ariaLabel?: string
  /** Visibly inert — for a game that has no dialog to open yet. Never pairs with `available`. */
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? name}
      aria-disabled={disabled}
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center",
        "animate-card-rise transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        disabled && "opacity-50 pointer-events-none",
      )}
      style={{ "--i": index % 8 } as React.CSSProperties}
    >
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
        {available && (
          <>
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
          </>
        )}
      </span>
      <div className="w-full min-w-0">
        <p className="truncate text-sm font-medium leading-tight">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
    </button>
  )
}
