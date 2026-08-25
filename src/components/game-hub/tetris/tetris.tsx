"use client"

// Petris (code slug `tetris`) — card + dialog + tRPC wiring. This file owns
// the modal state and the three tRPC calls (getStatus / start / end). Rendering +
// simulation live in <TetrisGame />; anti-cheat lives in the router (server replays
// the submitted input log and trusts only its own output). Cloned from flappy.tsx —
// see its useCallback-deps bug comment below for why we bind stable mutateAsync.

import { useCallback, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Blocks } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { Countdown } from "@/components/game-hub/countdown"
import { TetrisGame } from "./tetris-game"
import type { Action } from "@/lib/tetris/engine"
import { TetrisLeaderboard } from "./tetris-leaderboard"
import { ZpRules, LeaderboardPrizes } from "@/components/game-hub/zp-rules"
import { REPLAY_COST, ALL_TIME_CROWN_ZP } from "@/lib/tetris/constants"
import { DAILY_PRIZES_LABEL } from "@/lib/game-economy"
import { cn } from "@/lib/utils"

type View = "play" | "leaderboard"
type Summary = { score: number; linesCleared: number; zpWon: number; isPaidReplay: boolean }

export function Tetris({ index = 0 }: { index?: number }) {
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
    trpc.tetris.getStatus.queryOptions(undefined, {
      enabled: authStatus === "authenticated",
    }),
  )
  const runsRemaining = statusQ.data?.runsRemaining ?? 0
  const canPlay = statusQ.data?.canPlay ?? false
  const replayCost = statusQ.data?.replayCost ?? REPLAY_COST
  // The next run is a paid replay once the day's free run is gone.
  const nextRunCost = runsRemaining > 0 ? 0 : replayCost
  // Free run used AND can't afford a replay — the modal opens to a reset countdown.
  // Only trust "out of runs" once getStatus has actually ANSWERED. An in-flight or
  // failed query also leaves canPlay false, and the reset countdown below then tells
  // the user their free run is spent when the truth is we don't know yet — a broken
  // query rendered as "come back tomorrow" instead of as an error. isSuccess implies
  // authenticated, since the query is disabled when signed out.
  const statusPending = authStatus === "authenticated" && statusQ.isPending
  const outOfRuns = statusQ.isSuccess && !canPlay

  const start = useMutation(trpc.tetris.start.mutationOptions())
  const end = useMutation(trpc.tetris.end.mutationOptions())

  // React Query's mutateAsync is stable across renders; the mutation OBJECT
  // (start, end) is not — its identity changes on state churn (e.g. isPending
  // true→false). Passing the objects into useCallback deps re-runs the child
  // effect on every render churn (see flappy.tsx lines 50-58). Depend on the
  // stable methods instead.
  const startAsync = start.mutateAsync
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

  // Explicit Start — the run is claimed here (not on first piece input), so the
  // game never auto-runs the moment the dialog opens, and TetrisGame only mounts
  // once we hold a real seed (no placeholder-seed game + remount, which was the
  // source of the on-open canvas rescale).
  const handleStart = useCallback(async () => {
    if (runId || startIsPending) return
    setStartError(null)
    try {
      const res = await startAsync()
      setRunId(res.runId)
      setSeed(res.seed)
      void qc.invalidateQueries(trpc.user.getMe.queryFilter())
    } catch (err) {
      // On start failure, no run was claimed — keep the dialog open with the message.
      setStartError(err instanceof Error ? err.message : "Could not start run.")
    }
  }, [runId, startIsPending, startAsync, qc, trpc])

  const handleEnd = useCallback(
    (inputLog: { tick: number; action: Action }[]) => {
      if (!runId) return
      // Retry once with a 1s backoff. If both attempts fail, the 5-minute server
      // sweep still marks the run ABANDONED, and the next user.getMe reconciles balance.
      const tryEnd = () =>
        endAsync({ runId, inputLog }).then((data) => {
          setFinalSummary({
            score: data.score,
            linesCleared: data.linesCleared,
            zpWon: data.zpWon,
            isPaidReplay: data.isPaidReplay,
          })
          void qc.invalidateQueries(trpc.user.getMe.queryFilter())
          void qc.invalidateQueries(trpc.tetris.getStatus.queryFilter())
        })
      tryEnd().catch(() => {
        window.setTimeout(() => {
          tryEnd().catch((err) => {
            console.warn("tetris end mutation failed twice", err)
          })
        }, 1000)
      })
    },
    [runId, endAsync, qc, trpc],
  )

  return (
    <>
      <GameCard
        icon={Blocks}
        name="Petris"
        hint={hint}
        available={runsRemaining > 0 && authStatus === "authenticated"}
        index={index}
        onClick={openDialog}
        ariaLabel="Petris — stack lines, bank ZP"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Petris"
        description="Clear lines to bank ZP. Chase the leaderboard for a lot more."
      >
        {/* Tab strip — Play vs Leaderboard. Leaderboard is disabled while a run
            is active because switching tabs unmounts TetrisGame, whose cleanup
            fires onEnd (ending the run server-side). Death/summary state doesn't
            count as active, so users can jump to the leaderboard right after
            topping out to see their rank. */}
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
          <TetrisLeaderboard />
        ) : finalSummary ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-6 text-center">
            <p className="text-lg font-semibold">Run over</p>
            <p className="text-4xl font-bold tabular-nums">
              {finalSummary.score}
              <span className="ml-2 align-middle text-base font-medium text-muted-foreground">score</span>
            </p>
            {finalSummary.isPaidReplay ? (
              <p className="text-sm font-medium text-muted-foreground text-pretty">
                Paid replay â banks no ZP, but this score counts on the leaderboard.
              </p>
            ) : (
              <p className="text-sm font-medium text-emerald-500">+{finalSummary.zpWon} ZP banked</p>
            )}
            <p className="text-sm text-muted-foreground text-pretty">
              {finalSummary.linesCleared} {finalSummary.linesCleared === 1 ? "line" : "lines"} cleared.{" "}
              {runsRemaining > 0
                ? "Your free run is still available today."
                : `Replays cost ${replayCost} ZP from here.`}
            </p>
            <button
              type="button"
              onClick={() => setView("leaderboard")}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              See where that ranks
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openDialog}
                disabled={!canPlay}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {nextRunCost > 0 ? `Play again · ${nextRunCost} ZP` : "Play again"}
              </button>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md bg-muted px-4 py-2 text-sm font-semibold"
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
              className="rounded-md bg-muted px-4 py-2 text-sm font-semibold"
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
              onExpire={() => void qc.invalidateQueries(trpc.tetris.getStatus.queryFilter())}
            />
            <LeaderboardPrizes />
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-md bg-muted px-4 py-2 text-sm font-semibold"
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
              // Ready screen â the game does NOT start until the user taps Start.
              <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 py-4 text-center">
                <p className="text-sm text-muted-foreground text-pretty">
                  Stack four lines at once for a{" "}
                  <span className="font-semibold text-cyan-400">QUAD</span>. It speeds up every
                  five lines — survive the ramp.
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
                  Arrow keys, on-screen buttons, or swipe to play. Swipe up (or C) to
                  hold a piece for later — once per piece.
                </p>

                {/* The same "How ZP works here" panel every game modal renders. */}
                <ZpRules
                  className="w-full text-left"
                  rules={[
                    { what: "Every line you clear", zp: "+1 ZP" },
                    { what: "Top 3 on today’s board", zp: DAILY_PRIZES_LABEL },
                    { what: "Beat the all-time high score", zp: `+${ALL_TIME_CROWN_ZP} ZP` },
                  ]}
                  replayCost={replayCost}
                />
                <LeaderboardPrizes />
              </div>
            ) : (
              <TetrisGame key={seed} seed={seed} onEnd={handleEnd} />
            )}
          </>
        )}
      </GameDialog>
    </>
  )
}
