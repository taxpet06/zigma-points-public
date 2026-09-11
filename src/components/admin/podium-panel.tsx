"use client"

// AdminPodiumPanel — the same board members see, plus the two things only an admin
// needs: every pillar subtotal (what makes a placing contestable when someone argues)
// and a button to score or re-score a term on demand.
//
// The cron already scores each term once, automatically, on its first tick after
// endsAt. This button exists for the re-run after a correction, and for a mid-term
// standings preview.

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Crown } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { TermSelect, useTerms } from "@/components/term/term-select"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"

// Column header -> row key. Kept as one list so the header and the cells can never
// drift apart, and so adding a pillar is a one-line change here.
const PILLARS = [
  ["Community", "community"],
  ["Economy", "economy"],
  ["Games", "games"],
  ["Consist.", "consistency"],
  ["Collect.", "collection"],
  ["Betting", "betting"],
] as const

export function AdminPodiumPanel() {
  const [termId, setTermId] = useState<string | null>(null)
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { currentTermId, isLoading: termsLoading } = useTerms()
  const selectedTermId = termId ?? currentTermId

  const q = useQuery(
    trpc.term.podiumDetail.queryOptions({ termId: selectedTermId }, { enabled: !termsLoading }),
  )

  const runScoring = useMutation(
    trpc.term.runScoring.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.winnerId
            ? `Scored ${res.scored} members. Winner set and crowned.`
            : `Scored ${res.scored} members. No eligible winner (admins can't win).`,
        )
        void queryClient.invalidateQueries(trpc.term.podiumDetail.queryFilter())
        void queryClient.invalidateQueries(trpc.term.podium.queryFilter())
        void queryClient.invalidateQueries(trpc.term.list.queryFilter())
        void queryClient.invalidateQueries(trpc.term.crownHolder.queryFilter())
      },
      onError: (err) => toast.error(err.message || "Scoring failed."),
    }),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <TermSelect
          value={selectedTermId}
          onChange={setTermId}
          ariaLabel="Podium term"
          className="flex-1 min-w-[12rem]"
        />
        <Button
          onClick={() => selectedTermId && runScoring.mutate({ termId: selectedTermId })}
          disabled={!selectedTermId || runScoring.isPending}
        >
          {runScoring.isPending ? "Scoring…" : q.data?.rows.length ? "Re-run scoring" : "Run scoring"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Terms are scored automatically when they end. Re-running replaces the whole board
        and re-assigns the crown. No notification is sent either way.
      </p>

      {q.isPending ? (
        <FeedSkeleton count={3} />
      ) : q.isError ? (
        <p className="py-4 text-center text-sm text-destructive">Couldn&rsquo;t load the podium.</p>
      ) : !q.data || q.data.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          This term has no scores yet.
        </p>
      ) : (
        // Horizontal scroll container, not a wrapping grid: nine numeric columns cannot
        // fit at 360px, and squeezing them would make the whole table unreadable rather
        // than just the far end of it.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Member</th>
                <th className="py-2 pr-2 text-right font-medium">Total</th>
                {PILLARS.map(([label]) => (
                  <th key={label} className="py-2 pr-2 text-right font-medium">
                    {label}
                  </th>
                ))}
                <th className="py-2 pr-2 text-right font-medium">Days</th>
                <th className="py-2 text-right font-medium">Earned</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((row) => {
                const isAdmin = row.user.role === "ADMIN"
                return (
                  <tr
                    key={row.user.id}
                    className={cn(
                      "border-b last:border-0",
                      row.rank <= 3 && !row.isDisqualified && "bg-amber-500/5",
                      row.isDisqualified && "opacity-60",
                    )}
                  >
                    <td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
                      {row.rank === 1 && !row.isDisqualified ? (
                        <Crown className="h-4 w-4 text-amber-500" aria-label="Rank 1" />
                      ) : (
                        row.rank
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={cn(
                          "font-medium",
                          row.isDisqualified && "text-muted-foreground line-through decoration-1",
                        )}
                      >
                        {row.user.name ?? (row.user.username ? `@${row.user.username}` : "Unknown")}
                      </span>
                      {row.isDisqualified ? (
                        <span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          💩 disqualified
                        </span>
                      ) : null}
                      {/* Admins are ranked but can never be the winner — their balance
                          is unauditable (admin.updateBalance writes no ledger row), so
                          the marker explains why rank 1 may not be the Maxxer. */}
                      {isAdmin ? (
                        <span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          admin · can&rsquo;t win
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono font-semibold tabular-nums">
                      {row.total}
                    </td>
                    {PILLARS.map(([label, key]) => (
                      <td
                        key={label}
                        className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground"
                      >
                        {row[key]}
                      </td>
                    ))}
                    <td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                      {row.activeDays}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                      {row.zpEarned}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
