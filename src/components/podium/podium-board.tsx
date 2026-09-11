"use client"

// PodiumBoard — the term's Zigma Maxxer standings, rank 1 down to last.
//
// Deliberately the SAME row vocabulary as every competitive game leaderboard
// (game-hub/*/[game]-leaderboard.tsx): crown for #1, medals for 2nd and 3rd, avatar,
// name, monospace score on the right, "(you)" marker, self-row highlight. A member
// who can read the Petris board can read this one without being taught anything.
//
// What differs is the scope control: a game board has Today / Term / All-time, but a
// Zigma Maxxer only exists per term, so there is one TermSelect and no toggle.

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Crown, Medal } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { PLACE_COLOR } from "@/components/game-hub/zp-rules"
import { TermSelect, useTerms } from "@/components/term/term-select"
import { UserAvatar } from "@/components/cosmetics/user-avatar"

export function PodiumBoard() {
  const [termId, setTermId] = useState<string | null>(null)
  const trpc = useTRPC()
  const { data: session } = useSession()
  const meId = session?.user?.id ?? null

  const { currentTermId, isLoading: termsLoading } = useTerms()
  const selectedTermId = termId ?? currentTermId
  // The current term has no board yet — scoring runs on the settle cron's first tick
  // after endsAt. Saying so beats an empty list that reads like a loading failure.
  const isCurrent = selectedTermId !== null && selectedTermId === currentTermId

  const q = useQuery(
    trpc.term.podium.queryOptions(
      { termId: selectedTermId },
      // Hold until the term list resolves, so it doesn't fetch the current term and
      // then refetch the same rows under a settled id (same reasoning as the game boards).
      { enabled: !termsLoading },
    ),
  )

  return (
    <div className="flex flex-col gap-3">
      <TermSelect
        value={selectedTermId}
        onChange={setTermId}
        ariaLabel="Podium term"
        className="w-full"
      />

      {/* isPending, not isLoading: a disabled query reports isLoading false in v5,
          which would flash the empty state before the first fetch started. */}
      {q.isPending ? (
        <ul className="flex flex-col gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </ul>
      ) : q.isError ? (
        <p className="py-4 text-center text-sm text-destructive">Couldn&rsquo;t load the podium.</p>
      ) : !q.data || q.data.rows.length === 0 ? (
        <div className="py-16 text-center animate-card-rise">
          <h2 className="mb-2 text-xl font-semibold">
            {isCurrent ? "The term isn’t over yet." : "This term was never scored."}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isCurrent
              ? "The Zigma Maxxer is decided the moment the term ends."
              : "No standings were recorded for this term."}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {q.data.rows.map((row) => {
            const isMe = meId === row.user.id
            const dq = row.isDisqualified
            // A disqualified row keeps its rank but loses every highlight: no podium
            // tint, no medal, no crown. It is on the board precisely so the
            // disqualification is visible, not so it still reads as a placing.
            const podium = row.rank <= 3 && !dq
            const name = row.user.name ?? (row.user.username ? `@${row.user.username}` : "Unknown")
            return (
              <li
                key={row.user.id}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 text-sm",
                  isMe
                    ? "bg-primary/10 ring-1 ring-primary/40"
                    : podium
                      ? "bg-amber-500/5"
                      : "bg-muted/40",
                  dq && "opacity-55",
                )}
              >
                <span className="grid w-6 place-items-center font-mono text-xs text-muted-foreground">
                  {dq ? (
                    row.rank
                  ) : row.rank === 1 ? (
                    <Crown className="h-4 w-4 text-amber-500" aria-label="Zigma Maxxer" />
                  ) : podium ? (
                    <Medal
                      className={cn("h-4 w-4", PLACE_COLOR[row.rank - 1])}
                      aria-label={`${row.rank} place`}
                    />
                  ) : (
                    row.rank
                  )}
                </span>
                <UserAvatar
                  userId={row.user.id}
                  image={row.user.image}
                  name={name}
                  ring={row.user.equippedRing}
                  size={28}
                  fallback={
                    <span className="text-xs font-semibold">{name.slice(0, 1).toUpperCase()}</span>
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate font-medium",
                      dq && "text-muted-foreground line-through decoration-1",
                    )}
                  >
                    {name}
                    {isMe ? <span className="ml-1 text-xs text-primary">(you)</span> : null}
                  </span>
                  {dq ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span aria-hidden="true">💩</span> Disqualified
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "font-mono font-semibold tabular-nums",
                    dq && "text-muted-foreground",
                  )}
                >
                  {row.total}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
