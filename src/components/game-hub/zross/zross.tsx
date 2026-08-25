"use client"

// Zross — card + dialog + tRPC wiring. This file owns the modal state, the four
// tRPC calls (getStatus / start / collect / end), and the "runs remaining" card
// copy. Rendering + simulation live in <ZrossGame />; anti-cheat lives in the
// router. Cloned from the sibling snake-runner game's dialog file (19-CONTEXT.md:
// clone-don't-abstract) — see its useCallback-deps note for why stable mutate
// methods (not the mutation objects) go in the dependency arrays.
//
// MUST-DIVERGE (19-PATTERNS.md §5 / 19-UI-SPEC.md §10): the four small buttons
// below (Play again, the summary Close, the error Close, and the out-of-runs
// Close) are 36px tall in the cloned source. All four here are bumped to the
// 44px touch-target floor — see the class on each one.

import { useCallback, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { PawPrint } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { Countdown } from "@/components/game-hub/countdown"
import { ZrossGame } from "./zross-game"
import { ZrossLeaderboard } from "./zross-leaderboard"
import { ZpRules, LeaderboardPrizes } from "@/components/game-hub/zp-rules"
import { REPLAY_COST, ALL_TIME_CROWN_ZP } from "./constants"
import { DAILY_PRIZES_LABEL } from "@/lib/game-economy"
import { cn } from "@/lib/utils"

type View = "play" | "leaderboard"
type Summary = { score: number; pickups: number; zpWon: number; isPaidReplay: boolean }

export function Zross({ index = 0 }: { index?: number }) {
  const [open, setOpen] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [seed, setSeed] = useState<number | null>(null)
  const [finalSummary, setFinalSummary] = useState<Summary | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [view, setView] = useState<View>("play")

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const statusQ = useQuery(
    trpc.zross.getStatus.queryOptions(undefined, {
      enabled: authStatus === "authenticated",
    }),
  )
  const runsRemaining = statusQ.data?.runsRemaining ?? 0
  const canPlay = statusQ.data?.canPlay ?? false
  const replayCost = statusQ.data?.replayCost ?? REPLAY_COST
  // The next run is a paid replay once the day's free run is gone.
  const nextRunCost = runsRemaining > 0 ? 0 : replayCost
  // Free run used AND can't afford a replay — the card still opens, to a reset
  // countdown instead of the game, matching every other competitive game.
  // Only trust "out of runs" once getStatus has actually ANSWERED. An in-flight or
  // failed query also leaves canPlay false, and the reset countdown below then tells
  // the user their free run is spent when the truth is we don't know yet — a broken
  // query rendered as "come back tomorrow" instead of as an error. isSuccess implies
  // authenticated, since the query is disabled when signed out.
  const statusPending = authStatus === "authenticated" && statusQ.isPending
  const outOfRuns = statusQ.isSuccess && !canPlay

  const start = useMutation(trpc.zross.start.mutationOptions())
  const collect = useMutation(trpc.zross.collect.mutationOptions())
  const end = useMutation(trpc.zross.end.mutationOptions())

  const startAsync = start.mutateAsync
  const collectMutate = collect.mutate
  const endAsync = end.mutateAsync
  const startIsPending = start.isPending

  const hint =
    authStatus !== "authenticated"
      ? "Sign in to play"
      : runsRemaining > 0
        ? "Free run ready"
        : canPlay
          ? `Replay · ${replayCost} ZP`
          : "Back tomorrow"

  function openDialog() {
    setFinalSummary(null)
    setSeed(null)
    setRunId(null)
    setView("play")
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
  }

  // Explicit Start — the run and any replay debit are claimed here, not on the first
  // hop, so ZrossGame only ever mounts with a real seed.
  const handleStart = useCallback(async () => {
    if (runId || startIsPending) return
    setStartError(null)
    try {
      const res = await startAsync()
      setRunId(res.runId)
      setSeed(res.seed)
      void qc.invalidateQueries(trpc.user.getMe.queryFilter())
    } catch (err) {
      // On start failure no debit occurred; keep the dialog open with the message.
      setStartError(err instanceof Error ? err.message : "Could not start run.")
    }
  }, [runId, startIsPending, startAsync, qc, trpc])

  const handleCollect = useCallback(
    (pickupIndex: number) => {
      if (!runId) return
      // No optimistic local counter: ZrossGame's HUD already reads its ZP count
      // straight from its own sim, and the summary score comes from the server on
      // end().
      collectMutate(
        { runId, pickupIndex },
        {
          onSuccess: () => {
            void qc.invalidateQueries(trpc.user.getMe.queryFilter())
          },
        },
      )
    },
    [runId, collectMutate, qc, trpc],
  )

  const handleEnd = useCallback(() => {
    if (!runId) return
    // Retry once with a 1s backoff. If both attempts fail the 5-minute server sweep
    // still marks the run ABANDONED, and the next user.getMe reconciles the balance.
    const tryEnd = () =>
      endAsync({ runId }).then((data) => {
        setFinalSummary({
          score: data.score,
          pickups: data.pickups,
          zpWon: data.zpWon,
          isPaidReplay: data.isPaidReplay,
        })
        void qc.invalidateQueries(trpc.user.getMe.queryFilter())
        void qc.invalidateQueries(trpc.zross.getStatus.queryFilter())
      })
    tryEnd().catch(() => {
      window.setTimeout(() => {
        tryEnd().catch((err) => {
          console.warn("zross end mutation failed twice", err)
        })
      }, 1000)
    })
  }, [runId, endAsync, qc, trpc])

  return (
    <>
      <GameCard
        icon={PawPrint}
        name="Zross"
        hint={hint}
        available={runsRemaining > 0 && authStatus === "authenticated"}
        index={index}
        onClick={openDialog}
        ariaLabel="Zross — swipe or tap to hop, snag logos to earn"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Zross"
        description="Every logo you snag on the way is 1 ZP. Chase the leaderboard for a lot more."
      >
        {/* Tab strip — Play vs Leaderboard. Leaderboard is disabled while a run is
            active because switching tabs unmounts ZrossGame, whose cleanup fires
            onEnd (ending the run server-side). Death/summary state doesn't count as
            active, so users can jump straight to the board after dying. */}
        {(() => {
          const runActive = runId !== null && finalSummary === null
          return (
            <div className="mx-auto mb-3 inline-flex rounded-md bg-muted p-0.5 self-center">
              {(["play", "leaderboard"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={runActive && v === "leaderboard"}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                    view === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "play" ? "Play" : "Leaderboard"}
                </button>
              ))}
            </div>
          )
        })()}

        {view === "leaderboard" ? (
          <ZrossLeaderboard />
        ) : finalSummary ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-6 text-center">
            <p className="text-lg font-semibold">Run over</p>
            <p className="text-4xl font-bold tabular-nums">
              {finalSummary.score}
              <span className="ml-2 align-middle text-base font-medium text-muted-foreground">score</span>
            </p>
            {finalSummary.isPaidReplay ? (
              <p className="text-sm font-medium text-muted-foreground text-pretty">
                Paid replay — banks no ZP, but this score counts on the leaderboard.
              </p>
            ) : (
              <p className="text-sm font-medium text-emerald-500">+{finalSummary.zpWon} ZP banked</p>
            )}
            <p className="text-sm text-muted-foreground text-pretty">
              {finalSummary.pickups} {finalSummary.pickups === 1 ? "logo" : "logos"} snagged.{" "}
              {runsRemaining > 0
                ? "Your free run is still available today."
                : `Replays cost ${replayCost} ZP from here.`}
            </p>
            <button
              type="button"
              onClick={() => setView("leaderboard")}
              className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              See where that ranks
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openDialog}
                disabled={!canPlay}
                className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {nextRunCost > 0 ? `Play again · ${nextRunCost} ZP` : "Play again"}
              </button>
              <button
                type="button"
                onClick={closeDialog}
                className="min-h-11 rounded-md bg-muted px-4 py-2 text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        ) : statusQ.isError ? (
          <div className="mx-auto flex w-full max-w-sm flex-col gap-3 py-6 text-center">
            <p role="alert" className="text-sm text-destructive text-pretty">
              Couldn&rsquo;t load your runs. Close this and try again.
            </p>
            <button
              type="button"
              onClick={closeDialog}
              className="min-h-11 rounded-md bg-muted px-4 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        ) : outOfRuns ? (
          <div className="mx-auto flex w-full max-w-sm flex-col gap-3 py-2">
            <p className="text-center text-sm text-muted-foreground text-pretty">
              Your free run is used and you need {replayCost} ZP to buy a replay. Come back
              after the reset for another free one.
            </p>
            <Countdown
              label="Free run resets in"
              onExpire={() => void qc.invalidateQueries(trpc.zross.getStatus.queryFilter())}
            />
            <LeaderboardPrizes />
            <button
              type="button"
              onClick={closeDialog}
              className="min-h-11 rounded-md bg-muted px-4 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {startError ? (
              <p role="alert" className="text-sm text-destructive text-center py-2">
                {startError}
              </p>
            ) : null}
            {runId === null || seed === null ? (
              // Ready screen — the run is claimed on Start, not on the first hop.
              <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 py-4 text-center">
                <p className="text-sm text-muted-foreground text-pretty">
                  Hop forward, snag every logo, and keep going — it never ends, but it{" "}
                  <span className="font-semibold text-primary">never stops getting harder</span>.
                  Hovercars, laser rails, and the data stream are all fatal — and so is
                  falling behind.
                </p>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={startIsPending || statusPending}
                  className="rounded-xl bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-sm transition active:scale-95 motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {statusPending
                    ? "Loading…"
                    : startIsPending
                      ? "Starting…"
                      : nextRunCost > 0
                        ? `Start replay · ${nextRunCost} ZP`
                        : "Start free run"}
                </button>
                <p className="text-xs text-muted-foreground">
                  Swipe or tap the board, arrow keys, WASD, or the on-screen pad
                </p>

                {/* The same "How ZP works here" panel every game modal renders. */}
                <ZpRules
                  className="w-full text-left"
                  rules={[
                    { what: "Every logo you snag", zp: "+1 ZP" },
                    { what: "Top 3 on today’s board", zp: DAILY_PRIZES_LABEL },
                    { what: "Beat the all-time high score", zp: `+${ALL_TIME_CROWN_ZP} ZP` },
                  ]}
                  replayCost={replayCost}
                />
                <LeaderboardPrizes />
              </div>
            ) : (
              <ZrossGame key={seed} seed={seed} onCollect={handleCollect} onEnd={handleEnd} />
            )}
          </>
        )}
      </GameDialog>
    </>
  )
}
