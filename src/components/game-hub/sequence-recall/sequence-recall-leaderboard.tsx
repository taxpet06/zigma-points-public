"use client"

// SequenceRecallLeaderboard — top-10 list with a Today / All-time scope toggle.
// Consumed by sequence-recall.tsx when the user picks the "Leaderboard" tab. Same
// shape as every other competitive board, so the ranking reads identically across
// games.
//
// 21-PATTERNS.md locks clone-don't-abstract: this is a deliberate near-verbatim
// clone of the sibling Zross leaderboard file, not a shared <GameLeaderboard>. Do
// not extract one here.

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Crown, Medal } from "lucide-react"
import Image from "next/image"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { LeaderboardPrizes, PLACE_COLOR } from "@/components/game-hub/zp-rules"
import { DAILY_PRIZES, ALL_TIME_CROWN_ZP } from "./constants"

type Scope = "today" | "all-time"

// ZP a given rank will win, per scope — the numbers the prize pills show.
function prizeFor(scope: Scope, rank: number): number | null {
  if (scope === "today") return rank >= 1 && rank <= DAILY_PRIZES.length ? DAILY_PRIZES[rank - 1] : null
  return rank === 1 ? ALL_TIME_CROWN_ZP : null
}

export function SequenceRecallLeaderboard() {
  const [scope, setScope] = useState<Scope>("today")
  const trpc = useTRPC()
  const { data: session } = useSession()
  const meId = session?.user?.id ?? null

  const q = useQuery(trpc.sequenceRecall.leaderboard.queryOptions({ scope }))

  return (
    <div className="flex flex-col gap-3">
      {/* Prize callout — the shared panel, same numbers the game modals show. */}
      <LeaderboardPrizes scope={scope} />

      {/* Scope toggle — Today / All-time */}
      <div className="mx-auto inline-flex rounded-md bg-muted p-0.5">
        {(["today", "all-time"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-colors",
              scope === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "today" ? "Today" : "All-time"}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <ul className="flex flex-col gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </ul>
      ) : q.isError ? (
        <p className="text-center text-sm text-destructive py-4">Couldn&rsquo;t load the leaderboard.</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-6">
          {scope === "today" ? "No scores yet today — be the first!" : "No scores recorded yet."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {q.data.map((row) => {
            const isMe = meId === row.userId
            const prize = prizeFor(scope, row.rank)
            const podium = row.rank <= 3
            return (
              <li
                key={row.userId}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 text-sm",
                  isMe ? "bg-primary/10 ring-1 ring-primary/40" : podium ? "bg-amber-500/5" : "bg-muted/40",
                )}
              >
                <span className="grid w-6 place-items-center font-mono text-xs text-muted-foreground">
                  {scope === "all-time" && row.rank === 1 ? (
                    <Crown className="h-4 w-4 text-amber-500" aria-label="1st place" />
                  ) : podium ? (
                    <Medal className={cn("h-4 w-4", PLACE_COLOR[row.rank - 1])} aria-label={`${row.rank} place`} />
                  ) : (
                    row.rank
                  )}
                </span>
                {row.image ? (
                  <Image
                    src={row.image}
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full object-cover"
                    unoptimized
                  />
                ) : (
                  <span className="h-7 w-7 rounded-full bg-muted grid place-items-center text-xs font-semibold text-muted-foreground">
                    {(row.name ?? row.username ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate font-medium">
                  {row.name ?? (row.username ? `@${row.username}` : "Unknown")}
                  {isMe ? <span className="ml-1 text-xs text-primary">(you)</span> : null}
                </span>
                {prize !== null ? (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    +{prize} ZP
                  </span>
                ) : null}
                <span className="font-mono font-semibold tabular-nums">+{row.score}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
