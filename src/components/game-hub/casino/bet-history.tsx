"use client"

// BetHistory — the caller's own casino rounds as two-line rows (10-UI-SPEC.md § 6).
// A <ul className="divide-y"> — deliberately not a table element: five columns can't
// fit 360px minus the dialog's p-4 padding without either horizontal scroll (banned,
// MOBL-01) or sub-14px text (banned, DESIGN.md § 6). Two lines is the honest degradation.
//
// Tapping a row is the PRIMARY path into the Verifier (10-UI-SPEC.md § 5) — typing
// 64 hex characters by hand is the fallback, not the design target. The row hands its
// selection up to casino-fairness-dialog.tsx, which drives FairnessPanel's Verifier.

import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ChevronDown, Lock } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { MAX_PAYOUT } from "@/lib/casino/limits"
import { CASINO_GAMES } from "@/lib/casino/games"
import { cn, formatRelativeTime } from "@/lib/utils"

type CasinoGameSlug = (typeof CASINO_GAMES)[number]["slug"]

const GAME_NAMES: Record<string, string> = Object.fromEntries(
  CASINO_GAMES.map((g) => [g.slug, g.name]),
)

/** What a row tap hands up to the Verifier. `serverSeed` and `recordedHash` are both
 *  null when the row's seed pair hasn't been rotated yet — the Verifier renders its
 *  own honest "cannot verify yet" state for that, rather than this component hiding
 *  or disabling the row. `config` and `recordedMultiplier` (11-07) are the bet's own
 *  already-settled data — `config` is per-game (`{rows, risk}` for Plinko) and lets
 *  the Verifier re-derive the actual outcome, not just the hash commitment. */
export type HistoryRowSelection = {
  serverSeed: string | null
  clientSeed: string
  nonce: number
  game: CasinoGameSlug
  recordedHash: string | null
  config: unknown
  recordedMultiplier: number | null
}

function formatNet(net: number): string {
  // U+2212 MINUS SIGN (not a hyphen) per 10-UI-SPEC.md — aligns with tabular-nums.
  const sign = net < 0 ? "−" : "+"
  return `${sign}${Math.abs(net).toLocaleString()} ZP`
}

export function BetHistory({
  onSelectRow,
}: {
  onSelectRow: (selection: HistoryRowSelection) => void
}) {
  const trpc = useTRPC()

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    ...trpc.casino.history.infiniteQueryOptions(
      { limit: 20 },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  })

  const items = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        Bet history
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="mt-2">
        {isLoading && <p className="py-4 text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && items.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-base font-semibold">No bets yet</p>
            <p className="mt-1 text-sm text-pretty text-muted-foreground">
              Rounds you play show up here with the multiplier and payout, and you can verify
              any of them.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const wager = item.wager
              const multiplier = item.multiplier ?? 0
              const payout = item.payout ?? 0
              const net = payout - wager
              // MAX_PAYOUT is a plausible uncapped payout too (e.g. a 100x bet on 100 ZP) —
              // the cap only actually fired when the pre-floor product exceeded it.
              const capped = payout === MAX_PAYOUT && Math.floor(wager * multiplier) > MAX_PAYOUT

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-3 text-left active:bg-muted hover:bg-muted/50 sm:flex sm:items-center sm:justify-between sm:gap-4"
                    onClick={() =>
                      onSelectRow({
                        serverSeed: item.serverSeed,
                        clientSeed: item.clientSeed ?? "",
                        nonce: item.nonce,
                        game: item.game,
                        // The published hash is always fetchable, but only pass it through
                        // when the secret half is too — otherwise the Verifier would hash an
                        // empty string against a real commitment and report a false
                        // "mismatch" instead of the honest "cannot verify yet" for a round
                        // whose seed pair hasn't rotated (T-10-37).
                        recordedHash: item.serverSeed ? item.serverSeedHash : null,
                        config: item.config,
                        recordedMultiplier: item.multiplier,
                      })
                    }
                  >
                    {/* Line 1: name (left) · net payout (right). */}
                    <div className="flex items-center justify-between gap-2 sm:contents">
                      <span className="truncate text-sm font-medium">
                        {GAME_NAMES[item.game] ?? item.game}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span
                          className={cn(
                            "font-mono text-sm font-semibold tabular-nums",
                            net < 0
                              ? "text-destructive"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {formatNet(net)}
                        </span>
                        {capped && (
                          <span className="flex items-center gap-0.5 text-sm text-muted-foreground">
                            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                            capped
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Line 2: wager · multiplier (left) · relative time (right). */}
                    <div className="mt-0.5 flex justify-between gap-2 sm:mt-0 sm:contents">
                      <span className="font-mono text-sm text-muted-foreground">
                        {wager.toLocaleString()} ZP · {multiplier.toFixed(2)}×
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {hasNextPage && (
          <Button
            type="button"
            variant="outline"
            className="mt-2 min-h-11 w-full"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </details>
  )
}
