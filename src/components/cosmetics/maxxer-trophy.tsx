import { Trophy } from "lucide-react"
import { MAXXER_GOLD } from "@/components/cosmetics/crown-badge"
import { cn } from "@/lib/utils"

// The Zigma Pooper brown. A mid brown on purpose: the chips sit on both themes and
// this holds ~4:1 against white AND the dark card, where amber-800 (#92400e) sank to
// 2.4:1 on dark. MAXXER_GOLD itself only manages 3.2:1 on white.
export const POOPER_BROWN = "#a86b3c"

// How many terms this user has been the Zigma Maxxer, as a badge in the top-right
// of a profile card. Renders nothing at zero — the whole affordance is absent for
// the many users who have never won, rather than showing a hollow "0".
//
// It positions itself so every profile surface puts it in the same corner; callers
// only need the card to be `relative`. `md` is the full profile header, `sm` the
// grid cards on People and the user picker.
export function MaxxerTrophy({ count, size = "md", className }: TallyProps) {
  return (
    <Tally
      count={count}
      size={size}
      className={cn(size === "sm" ? "right-2 top-2" : "right-4 top-4", className)}
      color={MAXXER_GOLD}
      label={`Zigma Maxxer ${count} time${count === 1 ? "" : "s"}`}
      icon={<Trophy className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} style={{ color: MAXXER_GOLD }} aria-hidden="true" />}
    />
  )
}

// The mirror: how many terms this user was a Zigma Pooper, in the OPPOSITE corner.
export function PooperTally({ count, size = "md", className }: TallyProps) {
  return (
    <Tally
      count={count}
      size={size}
      className={cn(size === "sm" ? "left-2 top-2" : "left-4 top-4", className)}
      color={POOPER_BROWN}
      label={`Zigma Pooper ${count} time${count === 1 ? "" : "s"}`}
      icon={
        <span aria-hidden="true" className={cn("leading-none", size === "sm" ? "text-[10px]" : "text-sm")}>
          💩
        </span>
      }
    />
  )
}

type TallyProps = { count: number; size?: "sm" | "md"; className?: string }

function Tally({
  count,
  size,
  className,
  color,
  label,
  icon,
}: Required<Omit<TallyProps, "className">> & {
  className: string
  color: string
  label: string
  icon: React.ReactNode
}) {
  if (count <= 0) return null
  const sm = size === "sm"

  return (
    <div
      className={cn(
        "absolute z-20 inline-flex items-center rounded-full border bg-background/70 backdrop-blur-sm",
        sm ? "gap-0.5 px-1.5 py-0.5" : "gap-1 px-2 py-1",
        className,
      )}
      style={{ borderColor: color }}
      title={label}
    >
      {icon}
      <span className={cn("font-semibold tabular-nums", sm ? "text-[10px]" : "text-sm")} style={{ color }}>
        {count}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  )
}
