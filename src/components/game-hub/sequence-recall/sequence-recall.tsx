"use client"

// SequenceRecall — card + dialog + tRPC wiring. This file owns the modal state, all
// five tRPC calls (getStatus / start / beginRound / submitRound / end), and the
// "runs remaining" card copy. Rendering + local choreography live in
// <SequenceRecallGame />; anti-cheat and the round/tier state machine live in the
// router. Cloned from the sibling Zross dialog file (21-PATTERNS.md: clone the
// already-corrected sibling, not Znake's original) — see its useCallback-deps note
// for why stable mutate methods (not the mutation objects) go in the dependency
// arrays.
//
// Every small button below carries min-h-11 — cloned from zross.tsx's own
// already-corrected 44px touch-target fix (19-UI-SPEC.md §10), not Znake's
// original uncorrected 36px version.

import { useCallback, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Brain } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { Countdown } from "@/components/game-hub/countdown"
import { SequenceRecallGame, type SubmitRoundResult } from "./sequence-recall-game"
import { SequenceRecallLeaderboard } from "./sequence-recall-leaderboard"
import { ZpRules, LeaderboardPrizes } from "@/components/game-hub/zp-rules"
import { REPLAY_COST, ALL_TIME_CROWN_ZP } from "./constants"
import { DAILY_PRIZES_LABEL } from "@/lib/game-economy"
import { cn } from "@/lib/utils"

type View = "play" | "leaderboard"
type Summary = { zpEarned: number; tier: number; round: number; zpWon: number; isPaidReplay: boolean }
type FailReason = "wrong" | "timeout" | "tooFast"

export function SequenceRecall({ index = 0 }: { index?: number }) {
  const [open, setOpen] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [seed, setSeed] = useState<number | null>(null)
  const [startTier, setStartTier] = useState(1)
  const [startRound, setStartRound] = useState(1)
  const [finalSummary, setFinalSummary] = useState<Summary | null>(null)
  const [failReason, setFailReason] = useState<FailReason | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [view, setView] = useState<View>("play")

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const statusQ = useQuery(
    trpc.sequenceRecall.getStatus.queryOptions(undefined, {
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

  const start = useMutation(trpc.sequenceRecall.start.mutationOptions())
  const beginRound = useMutation(trpc.sequenceRecall.beginRound.mutationOptions())
  const submitRound = useMutation(trpc.sequenceRecall.submitRound.mutationOptions())
  const end = useMutation(trpc.sequenceRecall.end.mutationOptions())

  const startAsync = start.mutateAsync
  const beginRoundAsync = beginRound.mutateAsync
  const submitRoundAsync = submitRound.mutateAsync
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

  // Whether a run is currently in flight (used both to disable the Leaderboard tab
  // below and, per the 21-10-PLAN.md Gate A finding, to suppress the dialog
  // description while ACTIVE — see the description prop below for why).
  const runActive = runId !== null && finalSummary === null

  function openDialog() {
    setFinalSummary(null)
    setFailReason(null)
    setSeed(null)
    setRunId(null)
    setView("play")
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
  }

  // Explicit Start — the run and any replay debit are claimed here, not on the
  // first round, so SequenceRecallGame only ever mounts with a real seed.
  const handleStart = useCallback(async () => {
    if (runId || startIsPending) return
    setStartError(null)
    try {
      const res = await startAsync()
      setRunId(res.runId)
      setSeed(res.seed)
      setStartTier(res.tier)
      setStartRound(res.round)
      void qc.invalidateQueries(trpc.user.getMe.queryFilter())
    } catch (err) {
      // On start failure no debit occurred; keep the dialog open with the message.
      setStartError(err instanceof Error ? err.message : "Could not start run.")
    }
  }, [runId, startIsPending, startAsync, qc, trpc])

  const handleBeginRound = useCallback(
    async (tier: number, round: number) => {
      if (!runId) throw new Error("No active run.")
      // Let a rejection propagate — the game component owns the retry.
      await beginRoundAsync({ runId, tier, round })
    },
    [runId, beginRoundAsync],
  )

  const handleSubmitRound = useCallback(
    async (tier: number, round: number, taps: number[]): Promise<SubmitRoundResult> => {
      if (!runId) throw new Error("No active run.")
      const res = await submitRoundAsync({ runId, tier, round, taps })
      if (res.zpEarned > 0) {
        void qc.invalidateQueries(trpc.user.getMe.queryFilter())
      }
      // Let a rejection propagate so the game component can apply its
      // CONFLICT-versus-network-failure branch.
      return res
    },
    [runId, submitRoundAsync, qc, trpc],
  )

  const handleEnd = useCallback(
    (outcome: { reason: FailReason }) => {
      if (!runId) return
      setFailReason(outcome.reason)
      // Retry once with a 1s backoff. If both attempts fail the 5-minute server sweep
      // still marks the run ABANDONED, and the next user.getMe reconciles the balance.
      const tryEnd = () =>
        endAsync({ runId }).then((data) => {
          setFinalSummary({
            zpEarned: data.zpEarned,
            tier: data.tier,
            round: data.round,
            zpWon: data.zpWon,
            isPaidReplay: data.isPaidReplay,
          })
          void qc.invalidateQueries(trpc.user.getMe.queryFilter())
          void qc.invalidateQueries(trpc.sequenceRecall.getStatus.queryFilter())
        })
      tryEnd().catch(() => {
        window.setTimeout(() => {
          tryEnd().catch((err) => {
            console.warn("sequence-recall end mutation failed twice", err)
          })
        }, 1000)
      })
    },
    [runId, endAsync, qc, trpc],
  )

  return (
    <>
      <GameCard
        icon={Brain}
        name="Monkey Test"
        hint={hint}
        available={runsRemaining > 0 && authStatus === "authenticated"}
        index={index}
        onClick={openDialog}
        ariaLabel="Monkey Test — memorize the blinking tiles and tap them back in order before time runs out"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Monkey Test"
        description={
          // The board's ready screen already restates these rules inline the
          // instant a player has idle time to read them; repeating the same copy
          // in the dialog description while a run is ACTIVE only costs vertical
          // budget it doesn't have — the 360x640 UAT gate (21-10-PLAN.md Gate A)
          // measured the description's line-wrap alone pushing this dialog's
          // scrollHeight 34px past its clientHeight during the armed input window.
          // Every OTHER view (ready, summary, leaderboard, error, out-of-runs)
          // still gets the full description; GameDialog's own `description ??
          // title` + sr-only fallback keeps the Radix-required accessible
          // description intact when this is undefined.
          runActive
            ? undefined
            : "Watch the tiles light up, then tap them back in the same order. Every round you clear is worth 1 ZP — miss one and the run ends."
        }
      >
        {/* Tab strip — Play vs Leaderboard. Leaderboard is disabled while a run is
            active because switching tabs unmounts SequenceRecallGame mid-run.
            Death/summary state doesn't count as active, so users can jump straight
            to the board after dying. */}
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

        {view === "leaderboard" ? (
          <SequenceRecallLeaderboard />
        ) : finalSummary ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-6 text-center">
            <p className="text-lg font-semibold">Run over</p>
            {/* Three distinct failure modes get three distinct messages — telling a
                player "Wrong tile" when the server actually rejected their timing is
                misleading about what they did. */}
            {failReason === "timeout" ? (
              <p className="text-sm font-medium text-muted-foreground">Too slow — run over</p>
            ) : failReason === "tooFast" ? (
              <p className="text-sm font-medium text-muted-foreground">Too fast to be real — run over</p>
            ) : (
              <p className="text-sm font-medium text-muted-foreground">Wrong tile — run over</p>
            )}
            <p className="text-3xl font-semibold tabular-nums">
              {finalSummary.zpEarned}
              <span className="ml-2 align-middle text-base font-medium text-muted-foreground">ZP earned</span>
            </p>
            {finalSummary.isPaidReplay ? (
              <p className="text-sm font-medium text-muted-foreground text-pretty">
                Paid replay — banks no ZP, but this score counts on the leaderboard.
              </p>
            ) : (
              <p className="text-sm font-medium text-emerald-500">+{finalSummary.zpWon} ZP banked</p>
            )}
            <p className="text-sm text-muted-foreground text-pretty">
              Reached tier {finalSummary.tier}, round {finalSummary.round}.
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
              onExpire={() => void qc.invalidateQueries(trpc.sequenceRecall.getStatus.queryFilter())}
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
              // Ready screen — the run is claimed on Start, not on the first round.
              <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 py-4 text-center">
                <p className="text-sm text-muted-foreground text-pretty">
                  Tap the tiles in the order they blinked. Once the pattern finishes you get 5
                  seconds to answer. Clear a tier and the next one starts automatically, one
                  tile bigger — get it wrong or run out of time, and the run ends there.
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
                  Tap the tiles, or Tab + Enter/Space on a keyboard
                </p>

                {/* The same "How ZP works here" panel every game modal renders. */}
                <ZpRules
                  className="w-full text-left"
                  rules={[
                    { what: "Every round you clear", zp: "+1 ZP" },
                    { what: "Top 3 on today's board", zp: DAILY_PRIZES_LABEL },
                    { what: "Beat the all-time high score", zp: `+${ALL_TIME_CROWN_ZP} ZP` },
                  ]}
                  replayCost={replayCost}
                />
                <LeaderboardPrizes />
              </div>
            ) : (
              <SequenceRecallGame
                key={seed}
                seed={seed}
                startTier={startTier}
                startRound={startRound}
                onBeginRound={handleBeginRound}
                onSubmitRound={handleSubmitRound}
                onEnd={handleEnd}
              />
            )}
          </>
        )}
      </GameDialog>
    </>
  )
}
