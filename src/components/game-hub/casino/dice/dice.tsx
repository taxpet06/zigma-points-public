"use client"

// Dice — GameCard + GameDialog + CasinoShell wiring (13-UI-SPEC.md). This file owns the modal
// state, the bet state (bet/targetH/mode/outcome/roll/win) and the one tRPC mutation;
// DiceControls stays presentational and derives nothing.
//
// Dice is single-shot: dice.play opens the bet, derives the roll and settles it in ONE request
// (src/trpc/routers/dice.ts). Unlike Plinko, whose drop animations outlive their mutations, a
// dice roll resolves the instant the response lands — the entire concurrency story here is
// BetButton's own "settling" phase for the ~200ms round trip, on top of its built-in
// queueMicrotask double-tap debounce. There is deliberately no promise-chain queue and no
// in-flight-credit or reserved-stake bookkeeping (all Plinko-only machinery for animations that
// don't exist here), and this file never reads the casino resumable-round query — a single-shot
// game has nothing to resume.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Dice5 } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell, type CasinoOutcome } from "@/components/game-hub/casino/casino-shell"
import { BetInput } from "@/components/game-hub/casino/bet-input"
import { BetButton } from "@/components/game-hub/casino/bet-button"
import { DiceControls } from "@/components/game-hub/casino/dice/dice-controls"
import { MIN_BET, MAX_BET, MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"
import type { DiceMode } from "@/lib/casino/dice"

const DEFAULT_BET = 25
const DEFAULT_TARGET_H = 5000 // 50.00, UNDER — a 49.50% starting chance

export function Dice({ index = 0 }: { index?: number }) {
  const [open, setOpen] = React.useState(false)
  const [bet, setBet] = React.useState(DEFAULT_BET)
  const [targetH, setTargetH] = React.useState(DEFAULT_TARGET_H)
  const [mode, setMode] = React.useState<DiceMode>("UNDER")
  const [outcome, setOutcome] = React.useState<CasinoOutcome | null>(null)
  const [roll, setRoll] = React.useState<number | null>(null)
  const [win, setWin] = React.useState<boolean | null>(null)

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const meQ = useQuery(trpc.user.getMe.queryOptions(undefined, { enabled: authStatus === "authenticated" }))
  const serverBalance = meQ.data?.zigmaPoints ?? 0
  const affordable = serverBalance >= bet

  const play = useMutation(trpc.dice.play.mutationOptions())

  // The single rule that removes the entire mid-flight race: the roll is displayed only while
  // it is being compared against the target it was rolled against. Called from exactly three
  // places — the start of placeBet, handleTargetH and handleMode — and nowhere else. The
  // settled `outcome` does NOT clear here: nothing about a slider drag changes what the last
  // round paid.
  function clearRoll() {
    setRoll(null)
    setWin(null)
  }

  function handleTargetH(next: number) {
    setTargetH(next)
    clearRoll()
  }

  function handleMode(next: DiceMode) {
    // The mirror: chance and multiplier are untouched by construction, which is the whole point
    // — a mode flip changes which side of the line pays, not how likely or how much.
    setTargetH(10000 - targetH)
    setMode(next)
    clearRoll()
  }

  function openDialog() {
    setOpen(true)
  }

  async function placeBet() {
    if (!affordable) return // BetButton is already "invalid" and un-clickable; belt and suspenders.
    clearRoll()
    try {
      const res = await play.mutateAsync({ wager: bet, targetH, mode })
      setRoll(res.roll)
      setWin(res.win)
      void qc.invalidateQueries(trpc.user.getMe.queryFilter())
      void qc.invalidateQueries(trpc.casino.history.queryFilter())
      // Derived client-side exactly as plinko.tsx does — payout === MAX_PAYOUT alone isn't
      // enough, since a plain hit at exactly MAX_PAYOUT-worth of multiplier also equals it
      // without ever having been capped.
      const capped =
        payoutFor(bet, res.multiplier) === MAX_PAYOUT && Math.floor(bet * res.multiplier) > MAX_PAYOUT
      setOutcome({ net: res.payout - bet, staked: bet, multiplier: res.multiplier, capped })
    } catch {
      toast.error("Couldn't settle that round. Your stake is safe — reopen the game to pick it back up.")
    }
  }

  const hint =
    authStatus !== "authenticated"
      ? "Sign in to play"
      : serverBalance < MIN_BET
        ? "Not enough ZP"
        : `Bets ${MIN_BET}–${MAX_BET} ZP`

  return (
    <>
      <GameCard
        icon={Dice5}
        name="Dice"
        hint={hint}
        available={false}
        index={index}
        onClick={openDialog}
        ariaLabel="Dice — set a target, roll over or under"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Dice"
        description="Set your target, then roll over or under it. The roll is fixed by the seed before you bet."
      >
        <CasinoShell
          board={
            <DiceControls
              targetH={targetH}
              mode={mode}
              bet={bet}
              roll={roll}
              win={win}
              onTargetH={handleTargetH}
              onModeChange={handleMode}
            />
          }
          outcome={outcome}
          balance={serverBalance}
          controls={
            <div className="flex flex-col gap-3">
              <BetInput value={bet} onChange={setBet} balance={serverBalance} />
              <BetButton
                phase={play.isPending ? "settling" : affordable ? "ready" : "invalid"}
                betLabel={`Bet ${bet} ZP`}
                onClick={placeBet}
              />
            </div>
          }
        />
      </GameDialog>
    </>
  )
}
