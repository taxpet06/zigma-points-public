"use client"

// Wheel — GameCard + GameDialog + CasinoShell wiring (14-CONTEXT.md). This file owns the modal
// state, the bet state (bet/segments/risk/rotation/landedMultiplier/outcome) and the one tRPC
// mutation; WheelControls and WheelFace stay presentational and derive nothing.
//
// Wheel is single-shot: wheel.play opens the bet, derives the segment and settles it in ONE
// request (src/trpc/routers/wheel.ts). There is deliberately no promise-chain queue and no
// in-flight-credit or reserved-stake bookkeeping (Plinko-only machinery for animations that
// outlive their mutations — a wheel spin is a single rigid rotation); this file never reads the
// casino resumable-round query — a single-shot game has nothing to resume.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { CircleDashed } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell, type CasinoOutcome } from "@/components/game-hub/casino/casino-shell"
import { BetInput } from "@/components/game-hub/casino/bet-input"
import { BetButton } from "@/components/game-hub/casino/bet-button"
import {
  WheelFace,
  WHEEL_SPIN_MS,
  WHEEL_WINDUP_DEG,
  WHEEL_WINDUP_MS,
  type WheelPhase,
} from "@/components/game-hub/casino/wheel/wheel-face"
import { WheelControls } from "@/components/game-hub/casino/wheel/wheel-controls"
import { MIN_BET, MAX_BET } from "@/lib/casino/limits"
import { landingRotation, type WheelRisk } from "@/lib/casino/wheel"

const DEFAULT_BET = 25
const DEFAULT_SEGMENTS = 30
const DEFAULT_RISK: WheelRisk = "MEDIUM"

// The spin ALWAYS runs its full length. There is deliberately no prefers-reduced-motion read
// here and no shortened path: CasinoShell carries `.game-motion`, which opts the casino out of
// the global reduced-motion rule (globals.css) because iOS Low Power Mode and Android battery
// saver both report `reduce`, and a wheel that snaps straight to its answer is not a game.
const REVEAL_MS = WHEEL_WINDUP_MS + WHEEL_SPIN_MS

export function Wheel({ index = 0 }: { index?: number }) {
  const [open, setOpen] = React.useState(false)
  const [bet, setBet] = React.useState(DEFAULT_BET)
  const [segments, setSegments] = React.useState(DEFAULT_SEGMENTS)
  const [risk, setRisk] = React.useState<WheelRisk>(DEFAULT_RISK)
  const [rotation, setRotation] = React.useState(0)
  const [phase, setPhase] = React.useState<WheelPhase>("idle")
  const [landedMultiplier, setLandedMultiplier] = React.useState<number | null>(null)
  const [outcome, setOutcome] = React.useState<CasinoOutcome | null>(null)
  const [spinning, setSpinning] = React.useState(false)

  const rotationRef = React.useRef(0)
  const timersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([])

  function clearTimers() {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
  }

  React.useEffect(() => clearTimers, [])

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const meQ = useQuery(trpc.user.getMe.queryOptions(undefined, { enabled: authStatus === "authenticated" }))
  const serverBalance = meQ.data?.zigmaPoints ?? 0
  const affordable = serverBalance >= bet

  const play = useMutation(trpc.wheel.play.mutationOptions())

  function openDialog() {
    setOpen(true)
  }

  async function placeBet() {
    if (!affordable) return // BetButton is already "invalid" and un-clickable; belt and suspenders.
    setLandedMultiplier(null)
    setSpinning(true)
    try {
      const res = await play.mutateAsync({ wager: bet, segments, risk })
      void qc.invalidateQueries(trpc.user.getMe.queryFilter())
      void qc.invalidateQueries(trpc.casino.history.queryFilter())

      // The landing angle is computed from the TRUE resting rotation, before the wind-up moves
      // anything — the wind-up is a visual pull-back only, and the release below targets exactly
      // this value, so landingRotation/segmentAtPointer's round-trip is untouched.
      const nextRotation = landingRotation(rotationRef.current, res.index, segments)
      const restingRotation = rotationRef.current
      rotationRef.current = nextRotation

      clearTimers()
      setPhase("windup")
      setRotation(restingRotation - WHEEL_WINDUP_DEG)

      timersRef.current.push(
        setTimeout(() => {
          setPhase("spin")
          setRotation(nextRotation)
        }, WHEEL_WINDUP_MS),
        setTimeout(() => {
          setPhase("idle")
          setLandedMultiplier(res.multiplier)
          setOutcome({ net: res.payout - bet, staked: bet, multiplier: res.multiplier })
          setSpinning(false)
        }, REVEAL_MS),
      )
    } catch {
      setPhase("idle")
      setSpinning(false)
      toast.error("Couldn't settle that round. Your stake is safe — reopen the game to pick it back up.")
    }
  }

  const hint =
    authStatus !== "authenticated"
      ? "Sign in to play"
      : serverBalance < MIN_BET
        ? "Not enough ZP"
        : `Bets ${MIN_BET}–${MAX_BET} ZP`

  const locked = play.isPending || spinning

  return (
    <>
      <GameCard
        icon={CircleDashed}
        name="Wheel"
        hint={hint}
        available={false}
        index={index}
        onClick={openDialog}
        ariaLabel="Wheel — pick segments and risk, then spin"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Wheel"
        description="Choose your segments and risk, then spin. The landed segment is fixed by the seed before you bet."
      >
        <CasinoShell
          board={
            <div>
              <WheelFace
                segments={segments}
                risk={risk}
                rotation={rotation}
                phase={phase}
                landedMultiplier={landedMultiplier}
              />
              <WheelControls
                segments={segments}
                risk={risk}
                locked={locked}
                landedMultiplier={landedMultiplier}
                onSegmentsChange={setSegments}
                onRiskChange={setRisk}
              />
              {landedMultiplier !== null && (
                <span className="sr-only" aria-live="polite">
                  {`Landed ${landedMultiplier}× on a ${segments}-segment ${risk.toLowerCase()}-risk wheel.`}
                </span>
              )}
            </div>
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
