// ChestSvg — the shared lootbox chest, shared by LootboxCard (closed, idle)
// and the Phase-18 reveal modal (opens via ancestor data-phase). No animation
// is baked in here; motion comes entirely from cosmetics.css reacting to a
// `.lootbox-stage[data-phase]`/`.chest`/`.chest-lid` ancestor/class contract.
// ponytail: one shared SVG, no config beyond size.

import "@/components/cosmetics/cosmetics.css"

export function ChestSvg({
  size = 40,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={className}
    >
      <rect x="4" y="18" width="32" height="16" rx="3" fill="var(--primary)" />
      <rect x="4" y="18" width="32" height="4" fill="oklch(0.32 0.14 350)" />
      <circle cx="20" cy="24" r="2.5" fill="oklch(0.85 0.05 80)" />
      <g className="chest-lid">
        <path d="M4 18 Q4 8 20 8 Q36 8 36 18 Z" fill="var(--primary)" />
        <path
          d="M4 18 Q4 8 20 8 Q36 8 36 18"
          fill="none"
          stroke="oklch(0.32 0.14 350)"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  )
}
