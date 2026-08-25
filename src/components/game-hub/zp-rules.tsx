"use client"

// ZpRules — the "how ZP works here" panel. Every game modal renders one, so the
// scoring is spelled out in the same place, in the same shape, in every game.
//
// Two pieces, both reused across games:
//   <ZpRules>          — the per-game scoring table + what a replay costs
//   <LeaderboardPrizes> — the podium/crown payouts (also used by both leaderboards)
//
// The numbers all come from lib/game-economy.ts, the same module the routers enforce,
// so the panel can't drift from what the server actually pays.

import type { ReactNode } from "react"
import { Coins, Crown, Medal, RotateCcw, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import { DAILY_PRIZES, ALL_TIME_CROWN_ZP } from "@/lib/game-economy"

/** Gold / silver / bronze accent for a podium badge (both themes). */
export const PLACE_COLOR = ["text-amber-500", "text-zinc-400", "text-amber-700 dark:text-amber-600"]
export const PLACE_LABEL = ["1st", "2nd", "3rd"]

/** One line of the scoring table: what you did → what it pays. */
export type ZpRule = { what: string; zp: string }

export function ZpRules({
  rules,
  replayCost,
  replayNote,
  className,
}: {
  rules: ZpRule[]
  /** ZP charged for another go today. Omit when the game can't be replayed. */
  replayCost?: number
  /** Overrides the default replay line — e.g. "no replays, one word a day". */
  replayNote?: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label="How ZP works in this game"
      className={cn("rounded-lg border bg-muted/30 px-3 py-2.5", className)}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Coins className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        How ZP works here
      </p>

      <dl className="mt-2 flex flex-col gap-1">
        {rules.map((r, i) => (
          <div
            key={r.what}
            className="flex animate-card-rise items-baseline gap-2 text-sm"
            style={{ "--i": i } as React.CSSProperties}
          >
            <dt className="shrink-0 text-muted-foreground">{r.what}</dt>
            {/* Dotted leader keeps long labels tied to their number on one line. */}
            <span
              aria-hidden="true"
              className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-border"
            />
            {/* min-w-0, not shrink-0: most rows are short numbers that never need to shrink,
                but Avia Masters' house-edge line ("1% (2% Chicken Cross, 3% Avia Masters)") is
                long prose, not a number — shrink-0 forced it onto one unshrinkable line, pushing
                the whole row (and, via the ancestor chain's overflow:visible, the document
                itself) 448px wide in a 360px viewport. Default flex-shrink (1) plus min-w-0 lets
                it actually shrink and wrap; flex-grow stays 0 so short values still hug the
                dotted leader exactly as before. */}
            <dd className="min-w-0 text-right font-mono text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {r.zp}
            </dd>
          </div>
        ))}
      </dl>

      {(replayNote || replayCost !== undefined) && (
        <p className="mt-2 flex items-start gap-1.5 border-t pt-2 text-xs text-muted-foreground text-pretty">
          <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {replayNote ?? (
              <>
                First go each day is free.{" "}
                <span className="font-semibold text-foreground">
                  Replays cost {replayCost} ZP
                </span>{" "}
                and bank no ZP — they&rsquo;re for chasing the leaderboard.
              </>
            )}
          </span>
        </p>
      )}
    </section>
  )
}

/** The podium + crown payouts. Rendered in competitive modals and above both
 *  leaderboards, so the prize on offer is visible wherever the ranking is. */
export function LeaderboardPrizes({ scope = "today" }: { scope?: "today" | "all-time" }) {
  if (scope === "all-time") {
    return (
      <div className="rounded-lg bg-amber-500/10 px-3 py-2.5 ring-1 ring-amber-500/25">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          Take sole #1 all-time to win{" "}
          <span className="text-amber-600 dark:text-amber-400">+{ALL_TIME_CROWN_ZP} ZP</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          Paid every time you claim the crown — on paid replays too.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-amber-500/10 px-3 py-2.5 ring-1 ring-amber-500/25">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Trophy className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        Finish top 3 today for big ZP at midnight
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
        {DAILY_PRIZES.map((zp, i) => (
          <span key={i} className="flex items-center gap-1">
            <Medal className={cn("h-3.5 w-3.5", PLACE_COLOR[i])} aria-hidden="true" />
            {PLACE_LABEL[i]}
            <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              +{zp} ZP
            </span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <Crown className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          all-time #1
          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            +{ALL_TIME_CROWN_ZP} ZP
          </span>
        </span>
      </div>
    </div>
  )
}
