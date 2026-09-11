"use client"

// Plinko — GameCard + GameDialog + CasinoShell wiring + the serialized drop queue
// (11-06-PLAN.md). This file owns the modal state, the bet state (bet/rows/risk), and the
// one tRPC mutation; PlinkoBoard/PlinkoControls stay presentational and derive nothing.
//
// PLNK-04's real implementation lives here. Every openBet() writes the same CasinoSeed row
// inside a Serializable transaction, and runSerializable retries only 3 times (src/lib/db.ts) —
// ~10 rapid concurrent drops can exhaust that budget and surface a raw 40001 to the user. The
// fix is a promise chain on the client: mutations run one at a time, animations stay fully
// concurrent. Balls fly together; only the round-trips queue.
//
// Plinko is single-shot (opens and settles in one request, src/trpc/routers/plinko.ts) and has
// nothing to resume, so this file never reads the casino "resumable round" query and never
// renders a resumed-style affordance.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { CircleDot } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell, type CasinoOutcome } from "@/components/game-hub/casino/casino-shell"
import { BetInput } from "@/components/game-hub/casino/bet-input"
import { BetButton } from "@/components/game-hub/casino/bet-button"
import { PlinkoBoard, type PlinkoBoardHandle } from "@/components/game-hub/casino/plinko/plinko-board"
import { PlinkoControls } from "@/components/game-hub/casino/plinko/plinko-controls"
import { MIN_BET, MAX_BET, MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"
import { PLINKO_TABLES, type PlinkoRisk } from "@/lib/casino/plinko"

const DEFAULT_ROWS = 12
const DEFAULT_RISK: PlinkoRisk = "MEDIUM"
const DEFAULT_BET = 25

export function Plinko({ index = 0 }: { index?: number }) {
  const [open, setOpen] = React.useState(false)
  const [bet, setBet] = React.useState(DEFAULT_BET)
  const [rows, setRows] = React.useState(DEFAULT_ROWS)
  const [risk, setRisk] = React.useState<PlinkoRisk>(DEFAULT_RISK)
  const [outcome, setOutcome] = React.useState<CasinoOutcome | null>(null)
  const [landedBucket, setLandedBucket] = React.useState<number | null>(null)
  // Balls currently animating on the board — drives PlinkoControls' `locked` prop only.
  // Incremented right before launch(), decremented inside its onLand callback.
  const [activeBalls, setActiveBalls] = React.useState(0)

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const meQ = useQuery(trpc.user.getMe.queryOptions(undefined, { enabled: authStatus === "authenticated" }))
  const serverBalance = meQ.data?.zigmaPoints ?? 0

  const play = useMutation(trpc.plinko.play.mutationOptions())

  const boardRef = React.useRef<PlinkoBoardHandle>(null)

  // The serialized drop queue (PLNK-04) — a plain useRef<Promise> chain, reassigned in drop()
  // below. No queuing library, no worker thread, no finite-state library, no polling loop:
  // round-trip latency (~150-300ms) is already the reference clone's 250ms drop interval, so
  // none of that machinery would buy anything. Upgrade path if drops ever need to outpace that:
  // batch them into one server transaction, not client-side machinery.
  const chainRef = React.useRef<Promise<void>>(Promise.resolve())
  const nextDropId = React.useRef(0)

  // pendingCredits: betId -> payout withheld until that ball lands. `displayedBalance` below is
  // the server's number minus every payout still in here — a true lower bound at every instant
  // (11-UI-SPEC.md § Balance coherence). Any invalidation triggered by
  // ball #1 landing would otherwise also pull in ball #5's not-yet-shown credit, so subtraction —
  // not a second query — is the only formulation that stays coherent with several balls in flight.
  const [pendingCredits, setCredits] = React.useState<Map<string, number>>(new Map())

  // Stakes reserved from the moment a drop is requested until its ball lands — the client-side
  // affordability guard (T-11-22, a UX courtesy only). openBet's conditional debit inside
  // Serializable remains the real balance check and cannot be bypassed by editing client state.
  const [reservedWagers, setReservedWagers] = React.useState<Map<number, number>>(new Map())

  const creditedTotal = React.useMemo(
    () => Array.from(pendingCredits.values()).reduce((a, b) => a + b, 0),
    [pendingCredits],
  )
  const reservedTotal = React.useMemo(
    () => Array.from(reservedWagers.values()).reduce((a, b) => a + b, 0),
    [reservedWagers],
  )
  // The deferral is invisible by construction: no spinner, no deferred-credit suffix, no dimming —
  // this is the same snapping 14px mono figure CasinoShell already renders, just fed a number
  // that withholds in-flight payouts. It converges to serverBalance the instant pendingCredits
  // empties.
  const displayedBalance = serverBalance - creditedTotal
  const affordable = serverBalance - reservedTotal >= bet

  const table = PLINKO_TABLES[risk][rows]
  const boardAriaLabel = `Plinko board, ${rows} rows, ${risk.toLowerCase()} risk, payouts ${Math.min(...table)}× to ${Math.max(...table)}×`

  function openDialog() {
    setOpen(true)
  }

  function drop() {
    if (!affordable) return // BetButton is already "invalid" and un-clickable; belt and suspenders.
    const dropId = nextDropId.current++
    const wager = bet
    const dropRows = rows
    const dropRisk = risk
    setReservedWagers((m) => new Map(m).set(dropId, wager))

    // Chained onto the previous request, never Promise.all and never fire-and-forget — this IS
    // the serialization PLNK-04 requires. launch() below fires the moment THIS mutation
    // resolves, so a second drop's ball is already falling long before the first one lands.
    chainRef.current = chainRef.current
      .then(() => play.mutateAsync({ wager, rows: dropRows, risk: dropRisk }))
      .then((res) => {
        // The stake was debited and the payout credited server-side inside that one request —
        // invalidate now so the (already-shown) debit is correct; the payout stays hidden in
        // pendingCredits until the ball actually lands.
        setCredits((m) => new Map(m).set(res.betId, res.payout))
        void qc.invalidateQueries(trpc.user.getMe.queryFilter())
        void qc.invalidateQueries(trpc.casino.history.queryFilter())
        setActiveBalls((n) => n + 1)

        // The ball ALWAYS falls — there is no reduced-motion shortcut in launch() any more
        // (see plinko-board.tsx), so onLand is always async and pendingCredits always holds
        // the payout for the length of the drop. Do not add a matchMedia check here either.
        boardRef.current?.launch({
          path: res.path,
          bucket: res.bucket,
          onLand: () => {
            setCredits((m) => {
              const next = new Map(m)
              next.delete(res.betId)
              return next
            })
            setReservedWagers((m) => {
              const next = new Map(m)
              next.delete(dropId)
              return next
            })
            setActiveBalls((n) => n - 1)
            setLandedBucket(res.bucket)
            // Derived client-side from the already-shared payoutFor/MAX_PAYOUT — no extra
            // server field. payout === MAX_PAYOUT alone isn't enough: a plain 100x hit on a
            // 100 ZP bet also equals MAX_PAYOUT without ever having been capped.
            const capped =
              payoutFor(wager, res.multiplier) === MAX_PAYOUT && Math.floor(wager * res.multiplier) > MAX_PAYOUT
            setOutcome({ net: res.payout - wager, staked: wager, multiplier: res.multiplier, capped })
          },
        })
      })
      .catch(() => {
        setReservedWagers((m) => {
          const next = new Map(m)
          next.delete(dropId)
          return next
        })
        toast.error("Couldn't settle that round. Your stake is safe — reopen the game to pick it back up.")
      })
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
        icon={CircleDot}
        name="Plinko"
        hint={hint}
        available={false}
        index={index}
        onClick={openDialog}
        ariaLabel="Plinko — drop a ball, land a multiplier"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Plinko"
        description="Pick your rows and risk, then drop. The bucket is fixed by the seed before the ball moves."
      >
        <CasinoShell
          board={
            <div className="flex flex-col gap-3">
              <PlinkoBoard ref={boardRef} rows={rows} risk={risk} ariaLabel={boardAriaLabel} />
              <PlinkoControls
                rows={rows}
                risk={risk}
                bet={bet}
                locked={activeBalls > 0}
                landedBucket={landedBucket}
                onRowsChange={setRows}
                onRiskChange={setRisk}
              />
            </div>
          }
          outcome={outcome}
          balance={displayedBalance}
          controls={
            <div className="flex flex-col gap-3">
              <BetInput value={bet} onChange={setBet} balance={serverBalance} />
              <BetButton phase={affordable ? "ready" : "invalid"} betLabel={`Bet ${bet} ZP`} onClick={drop} />
            </div>
          }
        />
      </GameDialog>
    </>
  )
}
