import { Trophy } from "lucide-react"
import { MAXXER_GOLD } from "@/components/cosmetics/crown-badge"
import { cn } from "@/lib/utils"

// How many terms this user has been the Zigma Maxxer, as a badge in the top-right
// of a profile card. Renders nothing at zero — the whole affordance is absent for
// the many users who have never won, rather than showing a hollow "0".
//
// It positions itself so every profile surface puts it in the same corner; callers
// only need the card to be `relative`. `md` is the full profile header, `sm` the
// grid cards on People and the user picker.
export function MaxxerTrophy({
  count,
  size = "md",
  className,
}: {
  count: number
  size?: "sm" | "md"
  className?: string
}) {
  if (count <= 0) return null

  const label = `Zigma Maxxer ${count} time${count === 1 ? "" : "s"}`
  const sm = size === "sm"

  return (
    <div
      className={cn(
        "absolute z-20 inline-flex items-center rounded-full border bg-background/70 backdrop-blur-sm",
        sm ? "right-2 top-2 gap-0.5 px-1.5 py-0.5" : "right-4 top-4 gap-1 px-2 py-1",
        className,
      )}
      style={{ borderColor: MAXXER_GOLD }}
      title={label}
    >
      <Trophy
        className={sm ? "h-3 w-3" : "h-4 w-4"}
        style={{ color: MAXXER_GOLD }}
        aria-hidden="true"
      />
      <span
        className={cn("font-semibold tabular-nums", sm ? "text-[10px]" : "text-sm")}
        style={{ color: MAXXER_GOLD }}
      >
        {count}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  )
}
