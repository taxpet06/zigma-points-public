"use client"

// ZrossLeaderboard — top-10 list with a Today / Term / All-time scope toggle.
// Consumed by zross.tsx when the user picks the "Leaderboard" tab. Same shape as
// every other competitive board, so the ranking reads identically across games.
//
// 19-CONTEXT.md locks clone-don't-abstract: this is a deliberate near-verbatim
// clone of the sibling snake-runner game's leaderboard file, not a shared
// <GameLeaderboard>. Do not extract one here.

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Crown, Medal } from "lucide-react"
import Image from "next/image"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { LeaderboardPrizes, PLACE_COLOR } from "@/components/game-hub/zp-rules"
import { TermSelect, useTerms } from "@/components/term/term-select"
import { DAILY_PRIZES, ALL_TIME_CROWN_ZP } from "./constants"

type Scope = "today" | "term" | "all-time"

// Label per scope. "Term" over "This term" because the picker below already names
// which term, and the segmented control has three slots to fit at 360px.
const SCOPE_LABEL: Record<Scope, string> = { today: "Today", term: "Term", "all-time": "All-time" }

// ZP a given rank will win, per scope — the numbers the prize pills show.
function prizeFor(scope: Scope, rank: number, termClosed: boolean): number | null {
  if (scope === "today") return rank >= 1 && rank <= DAILY_PRIZES.length ? DAILY_PRIZES[rank - 1] : null
  // A finished term's board can never be climbed again, so there is no prize to
  // advertise on it — showing one would promise ZP that can't be won.
  if (scope === "term" && termClosed) return null
  return rank === 1 ? ALL_TIME_CROWN_ZP : null
}

export function ZrossLeaderboard() {
  const [scope, setScope] = useState<Scope>("today")
  // null = "whichever term is current" — resolved once useTerms lands, and by the
  // server too, so the first fetch is already the right board.
  const [termId, setTermId] = useState<string | null>(null)
  const trpc = useTRPC()
  const { data: session } = useSession()
  const meId = session?.user?.id ?? null

  const { currentTermId, isLoading: termsLoading } = useTerms()
  const selectedTermId = termId ?? currentTermId
  const isTerm = scope === "term"
  // A term other than the current one is settled: its window has passed, so no run
  // can ever change it. That drives the finality note and hides the prize pills.
  const termClosed = isTerm && selectedTermId !== null && selectedTermId !== currentTermId

  const q = useQuery(
    trpc.zross.leaderboard.queryOptions(
      isTerm ? { scope: "term" as const, termId: selectedTermId } : { scope },
      // Hold the term board until the term list resolves, so it doesn't fetch the
      // current term, then refetch the same rows under a settled id.
      { enabled: !isTerm || !termsLoading },
    ),
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Prize callout — the shared panel, same numbers the game modals show. */}
      {/* With zero terms started there is no board to top — leaderboardScopeWhere
          returns null and the server ships an empty list — so the amber "+50 ZP"
          callout would be advertising an unreachable prize. Show nothing instead. */}
      {isTerm && selectedTermId === null ? null : (
        <LeaderboardPrizes scope={scope} termClosed={termClosed} />
      )}

      {/* Scope toggle — Today / Term / All-time. Full-width 3-up grid rather than the
          old centred inline pill: three labels no longer fit side by side at 360px,
          and the pill's 26px rows sat under the 44px touch floor the hub tabs already
          fixed (MOBL-02). Same segmented-control vocabulary, correctly sized. */}
      <div className="grid w-full grid-cols-3 gap-0.5 rounded-md bg-muted p-1" role="group">
        {(["today", "term", "all-time"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={cn(
              "min-h-11 rounded px-2 text-xs font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              scope === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {SCOPE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Which term's board — only meaningful under the Term scope, so it appears
          with it instead of sitting inert above the other two. */}
      {isTerm ? (
        <TermSelect
          value={selectedTermId}
          onChange={setTermId}
          ariaLabel="Leaderboard term"
          className="w-full"
        />
      ) : null}

      {/* isPending, not isLoading: while the term list resolves the query is disabled,
          and a disabled query reports isLoading false (v5: isPending && isFetching) —
          which flashed "No scores this term yet" before the first fetch even started. */}
      {q.isPending ? (
        <ul className="flex flex-col gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </ul>
      ) : q.isError ? (
        <p className="text-center text-sm text-destructive py-4">Couldn&rsquo;t load the leaderboard.</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-6">
          {scope === "today"
            ? "No scores yet today — be the first!"
            : scope === "term"
              ? termClosed
                ? "No scores were recorded this term."
                : "No scores this term yet — be the first!"
              : "No scores recorded yet."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {q.data.map((row) => {
            const isMe = meId === row.userId
            const prize = prizeFor(scope, row.rank, termClosed)
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
                  {/* Both crown boards mark their #1 with the crown, settled terms
                      included — it is the champion marker, not a prize indicator. */}
                  {scope !== "today" && row.rank === 1 ? (
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
