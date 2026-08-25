"use client"

// Aviamasters — GameCard + GameDialog + CasinoShell wiring (16-04-PLAN.md). This file owns the
// modal state, the bet state (bet/speed/autoplay/steps/landed/shownStep/outcome) and the one
// tRPC mutation; AviaSky and AviaControls stay presentational and derive nothing.
//
// Aviamasters is single-shot: aviamasters.play opens the bet, derives the flight and settles it
// in ONE request (src/trpc/routers/aviamasters.ts) — the round is ALREADY settled server-side
// before the first frame renders, so nothing is at risk if the tab is backgrounded mid-flight
// (16-RESEARCH § Pitfall 5). There is deliberately no promise-chain queue and no in-flight-credit
// or reserved-stake bookkeeping (Plinko-only machinery for animations that outlive their
// mutations — an Aviamasters flight is one round at a time, wheel.tsx's ruling restated); this
// file never reads the casino resumable-round query — a single-shot game has nothing to resume.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Plane } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell, type CasinoOutcome } from "@/components/game-hub/casino/casino-shell"
import { BetInput } from "@/components/game-hub/casino/bet-input"
import { BetButton } from "@/components/game-hub/casino/bet-button"
import { AviaSky } from "@/components/game-hub/casino/aviamasters/avia-sky"
import {
  AviaControls,
  AVIA_SPEED_MS,
  type AviaSpeed,
} from "@/components/game-hub/casino/aviamasters/avia-controls"
import type { AviaStep } from "@/lib/casino/aviamasters"
import { MIN_BET, MAX_BET } from "@/lib/casino/limits"

const DEFAULT_BET = 25
const DEFAULT_SPEED: AviaSpeed = "CRUISE"

// There is deliberately no prefers-reduced-motion read here. Every round flies, for everyone:
// iOS Low Power Mode and Android battery saver both report reduce, and skipping the flight for
// them made the game look broken on a merely low battery (a user decision, recorded in
// globals.css's reduced-motion block, where CasinoShell's `.game-motion` opts the whole casino
// subtree out of the freeze).

export function Aviamasters({ index = 0 }: { index?: number }) {
  const [open, setOpen] = React.useState(false)
  const [bet, setBet] = React.useState(DEFAULT_BET)
  const [speed, setSpeed] = React.useState<AviaSpeed>(DEFAULT_SPEED)
  const [autoplayCount, setAutoplayCount] = React.useState(0)
  const [remaining, setRemaining] = React.useState<number | null>(null)
  const [flying, setFlying] = React.useState(false)

  const [steps, setSteps] = React.useState<AviaStep[] | null>(null)
  const [shownStep, setShownStep] = React.useState(0)
  const [landed, setLanded] = React.useState<boolean | null>(null)
  const [outcome, setOutcome] = React.useState<CasinoOutcome | null>(null)

  const revealTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // The Stop control's effect is a ref read at the NEXT round boundary, never stale state — a
  // click during the current flight must not abort a settled round (16-RESEARCH § Pitfall 6).
  const stopRequestedRef = React.useRef(false)

  React.useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current)
    }
  }, [])

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const meQ = useQuery(trpc.user.getMe.queryOptions(undefined, { enabled: authStatus === "authenticated" }))
  const serverBalance = meQ.data?.zigmaPoints ?? 0
  const affordable = serverBalance >= bet

  const play = useMutation(trpc.aviamasters.play.mutationOptions())

  // Resolves once every step of the trace has been revealed on a `stepMs`-spaced timer — the
  // ONLY thing that advances `shownStep`. AviaSky never derives timing itself.
  function revealSteps(traceLength: number, stepMs: number): Promise<void> {
    return new Promise((resolve) => {
      let i = 0
      const tick = () => {
        i += 1
        setShownStep(i)
        if (i >= traceLength) {
          resolve()
          return
        }
        revealTimerRef.current = setTimeout(tick, stepMs)
      }
      revealTimerRef.current = setTimeout(tick, stepMs)
    })
  }

  // The one and only `aviamasters.play` caller — shared by the single Bet button and every
  // autoplay iteration, so the round-settle/reveal/outcome sequence is written exactly once.
  async function playOneRound(): Promise<{ net: number } | null> {
    setSteps(null)
    setLanded(null)
    setShownStep(0)
    setFlying(true)
    try {
      const res = await play.mutateAsync({ wager: bet })
      void qc.invalidateQueries(trpc.user.getMe.queryFilter())
      void qc.invalidateQueries(trpc.casino.history.queryFilter())
      setSteps(res.steps)

      await revealSteps(res.steps.length, AVIA_SPEED_MS[speed])
      setLanded(res.landed)

      const net = res.payout - bet
      setOutcome({ net, staked: bet, multiplier: res.multiplier, capped: res.capped })
      return { net }
    } catch {
      toast.error("Couldn't settle that round. Your stake is safe — reopen the game to pick it back up.")
      return null
    } finally {
      setFlying(false)
    }
  }

  async function placeBet() {
    if (!affordable || locked) return // BetButton is already "invalid"/disabled; belt and suspenders.
    await playOneRound()
  }

  // Serial, never a parallel fan-out of concurrent mutations — 50 at once would each open a
  // Serializable transaction and risk Vercel Hobby's 10s function timeout (16-RESEARCH § Pitfall
  // 6). Balance is tracked locally rather than re-read from the query cache, which may not have
  // refetched between rounds yet.
  async function startAutoplay(count: number) {
    stopRequestedRef.current = false
    let left = count
    let runningBalance = serverBalance
    setRemaining(left)
    while (left > 0 && !stopRequestedRef.current && runningBalance >= bet) {
      const result = await playOneRound()
      if (result === null) break
      runningBalance += result.net
      left -= 1
      setRemaining(left)
    }
    setRemaining(null)
    setAutoplayCount(0)
  }

  function handleAutoplayChange(count: number) {
    setAutoplayCount(count)
    if (count > 0 && !locked) void startAutoplay(count)
  }

  function handleStopAutoplay() {
    stopRequestedRef.current = true
  }

  function openDialog() {
    setOpen(true)
  }

  const hint =
    authStatus !== "authenticated"
      ? "Sign in to play"
      : serverBalance < MIN_BET
        ? "Not enough ZP"
        : `Bets ${MIN_BET}–${MAX_BET} ZP`

  // A mutation in flight OR the reveal animation still playing OR an autoplay run armed —
  // `flying` alone covers the single-bet path end to end; `remaining !== null` additionally
  // covers the brief gap between two autoplay iterations where `flying` has not yet flipped
  // back to true for the next round.
  const locked = flying || remaining !== null

  return (
    <>
      <GameCard
        icon={Plane}
        name="Avia Masters"
        hint={hint}
        available={false}
        index={index}
        onClick={openDialog}
        ariaLabel="Avia Masters — fly and land, no cash-out"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Avia Masters"
        description="Watch the plane fly and collect pickups. The round's whole flight is fixed by the seed before you bet — there is no cash-out."
      >
        <CasinoShell
          board={
            <div>
              <AviaSky steps={steps} shownStep={shownStep} landed={landed} />
              <div className="mt-3">
                <AviaControls
                  speed={speed}
                  autoplay={autoplayCount}
                  remaining={remaining}
                  bet={bet}
                  locked={locked}
                  onSpeedChange={setSpeed}
                  onAutoplayChange={handleAutoplayChange}
                  onStopAutoplay={handleStopAutoplay}
                />
              </div>
            </div>
          }
          outcome={outcome}
          balance={serverBalance}
          controls={
            <div className="flex flex-col gap-3">
              <BetInput value={bet} onChange={setBet} balance={serverBalance} />
              <BetButton
                phase={!affordable ? "invalid" : locked ? "settling" : "ready"}
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
