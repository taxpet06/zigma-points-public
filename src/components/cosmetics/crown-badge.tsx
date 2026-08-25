import { Crown } from "lucide-react"
import { cn } from "@/lib/utils"

// The Zigma Maxxer crown — one holder in the whole app at a time (see term router).
//
// Absolutely positioned, so an avatar's box is the same size crowned or not and no
// list ever reflows when the crown moves. Gold is RARITY_META.RARE's #d97706, the
// gold this design system already committed to — not a new palette step.
// The Zigma Maxxer gold. Same #d97706 as RARITY_META.RARE — the gold this design
// system already committed to, reused rather than a new palette step.
export const MAXXER_GOLD = "#d97706"

export function CrownBadge({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 -rotate-12",
        className,
      )}
      style={{ top: -size * 0.3, width: size * 0.5 }}
      title="Zigma Maxxer"
    >
      <span className="sr-only">Zigma Maxxer</span>
      <Crown
        className="h-auto w-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
        style={{ color: MAXXER_GOLD }}
        fill="#f5b301"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </span>
  )
}
