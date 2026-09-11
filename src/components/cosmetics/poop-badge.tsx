import { cn } from "@/lib/utils"

// The Zigma Pooper mark — the mirror of CrownBadge, in the same slot, at the same
// size, with the same absolute positioning so an avatar's box never changes size or
// reflows a list when someone is disqualified.
//
// An emoji rather than an icon: lucide has no poop glyph, and 💩 is a single
// well-supported codepoint that needs no new dependency, no SVG, and no colour token.
// It carries its own colour, which is why this file has no palette constant next to
// CrownBadge's MAXXER_GOLD.
export function PoopBadge({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 -rotate-12",
        className,
      )}
      style={{ top: -size * 0.3, width: size * 0.5 }}
      title="Zigma Pooper — disqualified"
    >
      <span className="sr-only">Zigma Pooper — disqualified</span>
      <span
        aria-hidden="true"
        className="block text-center leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
        style={{ fontSize: size * 0.45 }}
      >
        💩
      </span>
    </span>
  )
}
