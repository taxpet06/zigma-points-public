"use client"

// Mines — GameCard + GameDialog + CasinoShell wiring, round state, the three mutations, and
// resume (12-04-PLAN.md). This file owns the modal state, the bet/mine-count state, the round
// state, and trpc.mines.open/reveal/cashout; MinesBoard/MinesReadout/MinesControls stay
// presentational and derive nothing.
//
// Mines is the FIRST consumer of the multi-step machinery: an ACTIVE round lives across
// requests, and casino.activeRound (queried on dialog open, filtered on game === "MINES") is
// the resume surface a hard refresh restores from. Plinko is single-shot and never reads that
// query at all — this file is where CASN-07 gets its first real exercise.
//
// The reveal/cash-out race is resolved by queueing onto one promise chain (pendingRef), the
// same one-line idiom plinko.tsx uses for its drop queue — never by disabling BetButton, which
// would flash "Cash out" to "Pick a tile" and back under the thumb (12-UI-SPEC § Cash-Out
// Contract). A cash-out that finds the round already settled (a reveal busted first) resolves
// silently — no toast, not a failure.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Bomb } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell, type CasinoOutcome } from "@/components/game-hub/casino/casino-shell"
import { BetInput } from "@/components/game-hub/casino/bet-input"
import { BetButton, type BetButtonPhase } from "@/components/game-hub/casino/bet-button"
import { MinesBoard } from "@/components/game-hub/casino/mines/mines-board"
import { MinesReadout, MinesControls } from "@/components/game-hub/casino/mines/mines-controls"
import { MIN_BET, MAX_BET, MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"
import { minesMultiplier, MINES_TILES } from "@/lib/casino/mines"
import { CASINO_GAMES } from "@/lib/casino/games"

const DEFAULT_BET = 25
const DEFAULT_MINE_COUNT = 3

type MinesRound = {
  betId: string
  mineCount: number
  revealed: number[]
  /** Banked multiplier for the k tiles revealed so far — null at k = 0 (nothing banked yet). */
  multiplier: number | null
  nextMultiplier: number | null
  /** Adopted from casino.activeRound rather than opened this session — drives BetButton's
   *  "resumed" phase and the resume line above the readout. */
  resumed: boolean
}

function formatSignedZp(net: number): string {
  const sign = net < 0 ? "−" : "+" // U+2212, matching CasinoShell/MinesReadout
  return `${sign}${Math.abs(net)} ZP`
}

export function Mines({ index = 0 }: { index?: number }) {
  const [open, setOpen] = React.useState(false)
  const [bet, setBet] = React.useState(DEFAULT_BET)
  const [mineCount, setMineCount] = React.useState(DEFAULT_MINE_COUNT)
  const [round, setRound] = React.useState<MinesRound | null>(null)
  const [outcome, setOutcome] = React.useState<CasinoOutcome | null>(null)
  const [hitTile, setHitTile] = React.useState<number | null>(null)
  // The end-of-round board — null while the round is live, per MinesBoard's own contract.
  const [boardMines, setBoardMines] = React.useState<number[] | null>(null)
  // The tiles the player actually found, kept alive past `setRound(null)`. Without this the
  // settled board forgets them (round is gone, so `round?.revealed ?? []` is empty) and every
  // gem the player banked reverts to the muted "not picked" treatment at the exact moment the
  // win is being shown. Server-supplied on both settle paths — never inferred.
  const [settledRevealed, setSettledRevealed] = React.useState<number[]>([])
  const [pendingTile, setPendingTile] = React.useState<number | null>(null)
  // Own flag rather than cashout.isPending: it must flip the instant the tap is queued, even
  // while the actual request is still waiting behind an in-flight reveal (12-UI-SPEC's race).
  const [cashingOut, setCashingOut] = React.useState(false)

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const meQ = useQuery(trpc.user.getMe.queryOptions(undefined, { enabled: authStatus === "authenticated" }))
  const serverBalance = meQ.data?.zigmaPoints ?? 0
  const affordable = serverBalance >= bet

  const openMutation = useMutation(trpc.mines.open.mutationOptions())
  const reveal = useMutation(trpc.mines.reveal.mutationOptions())
  const cashout = useMutation(trpc.mines.cashout.mutationOptions())

  // Casino settles never call notifyZpChange (10-CONTEXT § Notifications) — invalidating
  // user.getMe after every settle is the only balance-sync step this file owes. Also
  // invalidates casino.history (staleTime 30s) so the fairness dialog's tap-to-verify row
  // for this round isn't briefly missing if reopened right after settling (FAIR-04).
  function invalidateBalance() {
    void qc.invalidateQueries(trpc.user.getMe.queryFilter())
    void qc.invalidateQueries(trpc.casino.history.queryFilter())
  }

  const revealPending = reveal.isPending

  // Resume (CASN-07) — gated on the dialog being open, never on page mount, so the query only
  // runs when the Casino tab is actually in use. Plinko is single-shot and never reads this at
  // all; Mines is its first real consumer.
  const activeRoundQ = useQuery(
    trpc.casino.activeRound.queryOptions(undefined, { enabled: open && authStatus === "authenticated" }),
  )
  // Guards against re-adopting on every render once a round is live, and resets on close so a
  // later reopen (a genuinely new session) can adopt again.
  const adoptedRef = React.useRef(false)

  React.useEffect(() => {
    if (!open) {
      adoptedRef.current = false
      return
    }
    if (adoptedRef.current || round) return
    const data = activeRoundQ.data
    // Filtered on the game — Plinko's rows are never ACTIVE, so this is Mines-only by
    // construction, but the check is explicit rather than assumed.
    if (!data || data.game !== "MINES") return
    adoptedRef.current = true

    // Deferred to a microtask so the state sync happens in a callback rather than
    // synchronously in the effect body (react-hooks/set-state-in-effect) — the same idiom
    // ios-install-nudge.tsx already uses.
    queueMicrotask(() => {
      const cfg = data.config as { mines: number }
      const st = data.state as { revealed: number[] } | null
      const revealed = st?.revealed ?? []
      const k = revealed.length
      // No server field carries `nextMultiplier` on resume — recomputed from the shared pure
      // module, the same one the server uses, so there is nothing new to trust.
      const nextMultiplier = k < MINES_TILES - cfg.mines ? minesMultiplier(cfg.mines, k + 1) : null

      setBet(data.wager)
      setMineCount(cfg.mines)
      setOutcome(null)
      setHitTile(null)
      setBoardMines(null)
      setSettledRevealed([])
      setPendingTile(null)
      setRound({
        betId: data.betId,
        mineCount: cfg.mines,
        revealed,
        multiplier: data.multiplier,
        nextMultiplier,
        resumed: true,
      })
    })
  }, [open, activeRoundQ.data, round])

  // The serialized race-resolution chain (12-UI-SPEC § Cash-Out Contract): a cash-out tapped
  // while a reveal is in flight chains onto it rather than firing concurrently, and pays the
  // better multiplier if the reveal was safe, or resolves silently if it busted first.
  const pendingRef = React.useRef<Promise<void>>(Promise.resolve())

  async function openRound() {
    if (round || !affordable) return
    const wager = bet
    const mines = mineCount
    try {
      const res = await openMutation.mutateAsync({ wager, mines })
      setOutcome(null)
      setHitTile(null)
      setBoardMines(null)
      setSettledRevealed([])
      setPendingTile(null)
      setRound({
        betId: res.betId,
        mineCount: res.mineCount,
        revealed: res.revealed,
        multiplier: res.multiplier,
        nextMultiplier: res.nextMultiplier,
        resumed: false,
      })
    } catch (err) {
      const code = (err as { data?: { code?: string } })?.data?.code
      if (code === "CONFLICT") {
        // Refetch and, once the fresh data lands in the cache, name the blocking game — the
        // same CASINO_GAMES lookup chicken.tsx uses, no second slug->name map. If the refetch
        // instead yields a MINES round, the adoption effect above picks it up, the same path
        // a hard refresh takes.
        void qc.invalidateQueries(trpc.casino.activeRound.queryFilter()).then(() => {
          const data = qc.getQueryData(trpc.casino.activeRound.queryKey())
          if (data && data.game !== "MINES") {
            const other = CASINO_GAMES.find((g) => g.slug === data.game)
            toast.error(`You still have a ${other?.name ?? data.game} round open. Finish that one first.`)
          } else {
            toast.error("You already have a round in progress.")
          }
        })
      } else {
        toast.error("Couldn't settle that round. Your stake is safe — reopen the game to pick it back up.")
      }
    }
  }

  function revealTile(tile: number) {
    if (!round || reveal.isPending) return
    const betId = round.betId
    setPendingTile(tile)
    pendingRef.current = pendingRef.current
      .then(() => reveal.mutateAsync({ betId, tile }))
      .then((res) => {
        if (res.settled) {
          // Both settled branches (bust, cleared) always carry `mines` and a real numeric
          // `multiplier` — the fallbacks below only satisfy the union type shared with the
          // non-settled branches, never a runtime path.
          const multiplier = res.multiplier ?? 0
          setBoardMines(res.mines ?? null)
          setSettledRevealed(res.revealed)
          if (!res.safe) setHitTile(res.tile)
          // Plinko's exact capped derivation — payout === MAX_PAYOUT alone isn't enough, since
          // a plain multiplier hit on this wager can also land exactly on MAX_PAYOUT uncapped.
          const capped = payoutFor(bet, multiplier) === MAX_PAYOUT && Math.floor(bet * multiplier) > MAX_PAYOUT
          setOutcome({ net: res.payout - bet, staked: bet, multiplier, capped })
          setRound(null)
          invalidateBalance()
        } else {
          setRound((r) =>
            r ? { ...r, revealed: res.revealed, multiplier: res.multiplier, nextMultiplier: res.nextMultiplier } : r,
          )
        }
      })
      .catch(() => {
        toast.error("Couldn't reveal that tile. Your round is still open — try again.")
      })
      .finally(() => setPendingTile(null))
  }

  function cashOut() {
    if (!round) return
    const betId = round.betId
    setCashingOut(true)
    pendingRef.current = pendingRef.current
      .then(() => cashout.mutateAsync({ betId }))
      .then((res) => {
        setBoardMines(res.mines)
        setSettledRevealed(res.revealed)
        const capped =
          payoutFor(bet, res.multiplier) === MAX_PAYOUT && Math.floor(bet * res.multiplier) > MAX_PAYOUT
        setOutcome({ net: res.payout - bet, staked: bet, multiplier: res.multiplier, capped })
        setRound(null)
        invalidateBalance()
      })
      .catch((err) => {
        const code = (err as { data?: { code?: string } })?.data?.code
        // A queued cash-out that finds the round already settled (its reveal busted first) is
        // not a failure — the outcome already on screen is the correct one.
        if (code !== "NOT_FOUND") {
          toast.error("Couldn't settle that round. Your stake is safe — reopen the game to pick it back up.")
        }
      })
      .finally(() => setCashingOut(false))
  }

  function pickRandomTile() {
    if (!round) return
    const unrevealed = Array.from({ length: MINES_TILES }, (_, i) => i).filter((i) => !round.revealed.includes(i))
    if (unrevealed.length === 0) return
    // ponytail: this picks a UI target only, never a game outcome — the mine set was fixed by
    // the seed at bet time, so tile choice carries zero fairness weight. Must stay client-side;
    // a server "pick random" procedure would put a second randomness source inside the fairness
    // path.
    const tile = unrevealed[Math.floor(Math.random() * unrevealed.length)]
    revealTile(tile)
  }

  const phase: BetButtonPhase = cashingOut
    ? "cashing-out"
    : !round
      ? openMutation.isPending
        ? "settling"
        : affordable
          ? "ready"
          : "invalid"
      : round.multiplier === null
        ? "invalid" // k = 0 — nothing banked yet, "Pick a tile" and disabled
        : round.resumed
          ? "resumed"
          : "cashable"

  const betLabel = round ? "Pick a tile" : `Bet ${bet} ZP`
  const subLabel =
    round && round.multiplier !== null
      ? `${formatSignedZp(payoutFor(bet, round.multiplier) - bet)} · ${round.multiplier.toFixed(2)}×`
      : undefined

  function handlePrimary() {
    if (!round) {
      void openRound()
    } else {
      cashOut()
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
        icon={Bomb}
        name="Mines"
        hint={hint}
        available={false}
        index={index}
        onClick={() => setOpen(true)}
        ariaLabel="Mines — find gems, avoid the mines, cash out any time"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Mines"
        description="Reveal tiles. One mine ends the round."
      >
        <CasinoShell
          board={
            <div className="flex flex-col gap-3">
              {round?.resumed && (
                <p className="text-sm text-muted-foreground">
                  You had a round open — <span className="font-mono tabular-nums">{bet}</span> ZP staked at{" "}
                  <span className="font-mono tabular-nums">{(round.multiplier ?? 0).toFixed(2)}×</span>.
                </p>
              )}
              <MinesReadout
                mineCount={round?.mineCount ?? mineCount}
                bet={bet}
                k={round?.revealed.length ?? 0}
                currentMultiplier={round?.multiplier ?? null}
                nextMultiplier={round ? round.nextMultiplier : minesMultiplier(mineCount, 1)}
              />
              <MinesBoard
                revealed={round?.revealed ?? settledRevealed}
                mines={boardMines}
                hitTile={hitTile}
                roundActive={round !== null}
                revealPending={revealPending}
                pendingTile={pendingTile}
                onReveal={revealTile}
              />
              <MinesControls
                mineCount={round?.mineCount ?? mineCount}
                onMineCountChange={setMineCount}
                bet={bet}
                locked={round !== null}
                roundActive={round !== null}
                revealPending={revealPending}
                onPickRandom={pickRandomTile}
              />
            </div>
          }
          outcome={outcome}
          balance={serverBalance}
          controls={
            <div className="flex flex-col gap-3">
              {round ? (
                <p className="text-sm font-mono tabular-nums text-muted-foreground">
                  {bet} ZP staked · {round.mineCount === 1 ? "1 mine" : `${round.mineCount} mines`}
                </p>
              ) : (
                <BetInput value={bet} onChange={setBet} balance={serverBalance} />
              )}
              <BetButton phase={phase} betLabel={betLabel} subLabel={subLabel} onClick={handlePrimary} />
            </div>
          }
        />
      </GameDialog>
    </>
  )
}
