"use client"

// Deal choreography — cards appear one-at-a-time in casino order:
// player, dealer-up, player, dealer-hole. Actions / result banners wait until
// the deal finishes so peek blackjacks and insurance aren't instant pop-ins.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Spade, Volume2, VolumeX } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell, type CasinoOutcome } from "@/components/game-hub/casino/casino-shell"
import { BetInput } from "@/components/game-hub/casino/bet-input"
import { BetButton, type BetButtonPhase } from "@/components/game-hub/casino/bet-button"
import { BlackjackTable, type ResultBanner } from "./blackjack-table"
import { BlackjackActions, BlackjackCapNote } from "./blackjack-controls"
import * as sprites from "./sprites"
import * as sounds from "./sounds"
import { MIN_BET, MAX_BET, MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"
import {
  availableActions,
  insuranceCost,
  type BlackjackAction,
  type BlackjackPersistedState,
  type Card,
  type PlayerHand,
} from "@/lib/casino/blackjack"
import { cn } from "@/lib/utils"

const DEFAULT_BET = 25
/** Gap between each of the four initial deal cards. */
const DEAL_STEP_MS = 420
/** Pause after the hole is down before flipping / unlocking actions. */
const DEAL_HOLD_MS = 280
/** Gap between dealer hit cards after the hole flip. */
const DEALER_HIT_MS = 400
const HOLE_FLIP_MS = 520
const POST_REVEAL_MS = 380

type RoundView = {
  betId: string
  wager: number
  hands: PlayerHand[]
  activeHand: number
  dealerUp: Card
  dealerCards: Card[] | null
  holeHidden: boolean
  phase: "insurance" | "playing" | "settled"
  insuranceStake: number
  actions: BlackjackAction[]
  resumed: boolean
  persisted: BlackjackPersistedState | null
}

type PendingSettle = {
  outcome: CasinoOutcome
  flash: "win" | "lose" | "push"
  banner: ResultBanner
}

/** How many of the initial 4 seats are visible (0..4). */
type DealSeat = 0 | 1 | 2 | 3 | 4

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* ignore */
  }
}

function actionsFromPersisted(st: BlackjackPersistedState): BlackjackAction[] {
  return availableActions(st)
}

function buildPendingSettle(res: {
  wager: number
  payout: number
  multiplier: number | null
}): PendingSettle {
  const mult = res.multiplier ?? 0
  const payout = res.payout
  const net = payout - res.wager
  const capped =
    payoutFor(res.wager, mult) === MAX_PAYOUT && Math.floor(res.wager * mult) > MAX_PAYOUT
  const kind: ResultBanner["kind"] = net > 0 ? "win" : net < 0 ? "lose" : "push"
  const sign = net > 0 ? "+" : net < 0 ? "−" : ""
  return {
    outcome: { net, staked: res.wager, multiplier: mult, capped },
    flash: kind,
    banner: {
      kind,
      title: kind === "win" ? "You win" : kind === "lose" ? "Dealer wins" : "Push",
      detail:
        kind === "push"
          ? `${res.wager} ZP returned`
          : `${sign}${Math.abs(net).toLocaleString()} ZP · ${mult.toFixed(2)}×`,
    },
  }
}

export function Blackjack({ index = 0 }: { index?: number }) {
  const [open, setOpen] = React.useState(false)
  const [bet, setBet] = React.useState(DEFAULT_BET)
  const [round, setRound] = React.useState<RoundView | null>(null)
  const [outcome, setOutcome] = React.useState<CasinoOutcome | null>(null)
  const [flash, setFlash] = React.useState<"win" | "lose" | "push" | null>(null)
  const [banner, setBanner] = React.useState<ResultBanner | null>(null)
  const [dealKey, setDealKey] = React.useState(0)
  const [hitSeq, setHitSeq] = React.useState(0)
  const [animateEnter, setAnimateEnter] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [muted, setMutedUi] = React.useState(false)

  /** 0 = dealing in progress seats; 4 = all four down; actions unlock only when dealReady. */
  const [dealSeat, setDealSeat] = React.useState<DealSeat>(4)
  const [dealReady, setDealReady] = React.useState(true)
  const [holeFlip, setHoleFlip] = React.useState(false)
  /** How many of `round.dealerCards` are visible during resolve (0 = use up+hole-back mode). */
  const [dealerShown, setDealerShown] = React.useState(0)
  const pendingSettleRef = React.useRef<PendingSettle | null>(null)
  const dealTimersRef = React.useRef<number[]>([])
  /** Sync lock — `busy` state alone loses to double-taps before re-render. */
  const inflightRef = React.useRef(false)

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  const meQ = useQuery(trpc.user.getMe.queryOptions(undefined, { enabled: authStatus === "authenticated" }))
  const serverBalance = meQ.data?.zigmaPoints ?? 0
  const affordable = serverBalance >= bet

  const openMutation = useMutation(trpc.blackjack.open.mutationOptions())
  const actionMutation = useMutation(trpc.blackjack.action.mutationOptions())

  function clearDealTimers() {
    for (const t of dealTimersRef.current) window.clearTimeout(t)
    dealTimersRef.current = []
  }

  function invalidateBalance() {
    void qc.invalidateQueries(trpc.user.getMe.queryFilter())
    void qc.invalidateQueries(trpc.casino.history.queryFilter())
  }

  function publishPendingSettle() {
    const pending = pendingSettleRef.current
    if (!pending) return
    pendingSettleRef.current = null
    setOutcome(pending.outcome)
    setFlash(pending.flash)
    setBanner(pending.banner)
    if (pending.outcome.net > 0) {
      sounds.playWin()
      vibrate(25)
    } else if (pending.outcome.net < 0) {
      sounds.playLose()
      vibrate(40)
    }
  }

  /**
   * After the player's turn ends: flip the hole, then deal any dealer hits
   * one-at-a-time, then publish the pending settle banner.
   */
  function revealDealerThenSettle(fullCards: Card[] | null | undefined) {
    clearDealTimers()
    setDealReady(false)
    const cards = fullCards ?? []
    // Start with upcard only + face-down hole (dealerShown stays 0 → table uses forceHoleBack).
    setDealerShown(0)
    setHoleFlip(false)

    const flipTimer = window.setTimeout(() => {
      setHoleFlip(true)
      setDealerShown(Math.min(2, cards.length))
      sounds.playFlip()

      const hits = Math.max(0, cards.length - 2)
      if (hits === 0) {
        const done = window.setTimeout(() => {
          setDealReady(true)
          publishPendingSettle()
        }, HOLE_FLIP_MS)
        dealTimersRef.current.push(done)
        return
      }

      for (let i = 0; i < hits; i++) {
        const t = window.setTimeout(() => {
          setDealerShown(3 + i)
          sounds.playDeal()
          if (i === hits - 1) {
            const done = window.setTimeout(() => {
              setDealReady(true)
              publishPendingSettle()
            }, POST_REVEAL_MS)
            dealTimersRef.current.push(done)
          }
        }, HOLE_FLIP_MS + DEALER_HIT_MS * (i + 1))
        dealTimersRef.current.push(t)
      }
    }, DEAL_HOLD_MS)
    dealTimersRef.current.push(flipTimer)
  }

  /** Run P→D→P→D deal, then optionally resolve dealer (flip + hits) for a settled round. */
  function startInitialDeal(opts: { settled: boolean; dealerCards?: Card[] | null }) {
    clearDealTimers()
    setDealSeat(0)
    setDealReady(false)
    setHoleFlip(false)
    setDealerShown(0)
    setAnimateEnter(true)

    const steps: DealSeat[] = [1, 2, 3, 4]
    steps.forEach((seat, i) => {
      const t = window.setTimeout(() => {
        setDealSeat(seat)
        sounds.playDeal()
        if (seat === 4) {
          const hold = window.setTimeout(() => {
            if (opts.settled) {
              revealDealerThenSettle(opts.dealerCards)
            } else {
              setDealReady(true)
            }
          }, DEAL_HOLD_MS)
          dealTimersRef.current.push(hold)
        }
      }, DEAL_STEP_MS * (i + 1))
      dealTimersRef.current.push(t)
    })
  }

  const activeRoundQ = useQuery(
    trpc.casino.activeRound.queryOptions(undefined, { enabled: open && authStatus === "authenticated" }),
  )
  const adoptedRef = React.useRef(false)

  React.useEffect(() => {
    if (open) {
      void sprites.preload()
      void sounds.preload().then(() => setMutedUi(sounds.isMuted()))
    }
  }, [open])

  React.useEffect(() => {
    return () => clearDealTimers()
  }, [])

  React.useEffect(() => {
    if (!open) {
      adoptedRef.current = false
      return
    }
    if (adoptedRef.current || round) return
    const data = activeRoundQ.data
    if (!data || data.game !== "BLACKJACK") return
    adoptedRef.current = true

    queueMicrotask(() => {
      const st = data.state as BlackjackPersistedState | null
      if (!st?.hands || !st.dealerUp) return
      setBet(data.wager)
      setOutcome(null)
      setFlash(null)
      setBanner(null)
      setAnimateEnter(false)
      setHitSeq(0)
      setDealSeat(4)
      setDealReady(true)
      setHoleFlip(false)
      setDealerShown(0)
      setDealKey((k) => k + 1)
      setRound({
        betId: data.betId,
        wager: data.wager,
        hands: st.hands,
        activeHand: st.activeHand,
        dealerUp: st.dealerUp,
        dealerCards: null,
        holeHidden: true,
        phase: st.phase,
        insuranceStake: st.insuranceStake,
        actions: actionsFromPersisted(st),
        resumed: true,
        persisted: st,
      })
    })
  }, [open, activeRoundQ.data, round])

  function applyServerRound(
    res: {
      betId: string
      wager: number
      settled: boolean
      payout: number
      multiplier: number | null
      hands: PlayerHand[]
      activeHand: number
      dealerUp: Card
      dealerCards: Card[] | null
      holeHidden: boolean
      phase: "insurance" | "playing" | "settled"
      insuranceStake: number
      actions: BlackjackAction[]
    },
    opts?: { choreographDeal?: boolean },
  ) {
    const choreograph = opts?.choreographDeal === true

    if (res.settled) {
      const pending = buildPendingSettle(res)
      // Keep dealerCards on the round for the post-deal flip; the table hides them
      // until holeFlip / dealReady so the hole isn't spoiled mid-deal.
      setRound({
        betId: res.betId,
        wager: res.wager,
        hands: res.hands,
        activeHand: res.activeHand,
        dealerUp: res.dealerUp,
        dealerCards: res.dealerCards,
        holeHidden: true,
        phase: "settled",
        insuranceStake: res.insuranceStake,
        actions: [],
        resumed: false,
        persisted: null,
      })
      invalidateBalance()

      if (choreograph) {
        pendingSettleRef.current = pending
        startInitialDeal({ settled: true, dealerCards: res.dealerCards })
      } else {
        // Player finished (stand / bust-out of remaining hands) — flip hole, then
        // deal dealer hits one-by-one before the result banner.
        pendingSettleRef.current = pending
        setDealSeat(4)
        revealDealerThenSettle(res.dealerCards)
      }
      return
    }

    setRound({
      betId: res.betId,
      wager: res.wager,
      hands: res.hands,
      activeHand: res.activeHand,
      dealerUp: res.dealerUp,
      dealerCards: res.dealerCards,
      holeHidden: res.holeHidden,
      phase: res.phase === "settled" ? "playing" : res.phase,
      insuranceStake: res.insuranceStake,
      actions: res.actions,
      resumed: false,
      persisted: null,
    })

    if (choreograph) {
      startInitialDeal({ settled: false })
    } else {
      setDealSeat(4)
      setDealReady(true)
      setDealerShown(0)
      setHoleFlip(false)
    }
  }

  async function onDeal() {
    if (busy || inflightRef.current || !affordable) return
    if (round && (round.phase === "playing" || round.phase === "insurance")) return
    inflightRef.current = true
    setBusy(true)
    // Clear the finished hand immediately — otherwise the new round reconciles over
    // leftover cards (last card morphs) before dealSeat resets and the redeal runs.
    clearDealTimers()
    pendingSettleRef.current = null
    setRound(null)
    setOutcome(null)
    setFlash(null)
    setBanner(null)
    setHitSeq(0)
    setDealSeat(0)
    setDealReady(false)
    setHoleFlip(false)
    setDealerShown(0)
    setAnimateEnter(true)
    setDealKey((k) => k + 1)
    try {
      sounds.playChip()
      const res = await openMutation.mutateAsync({ wager: bet })
      setDealKey((k) => k + 1)
      applyServerRound(res, { choreographDeal: true })
      if (!res.settled) invalidateBalance()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not deal")
      setDealReady(true)
      setDealSeat(4)
    } finally {
      inflightRef.current = false
      setBusy(false)
    }
  }

  async function onAction(action: BlackjackAction) {
    if (!round || busy || inflightRef.current || round.phase === "settled" || !dealReady) return
    inflightRef.current = true
    setBusy(true)
    try {
      if (action === "hit" || action === "double" || action === "split") {
        setHitSeq((n) => n + 1)
        sounds.playDeal()
      }
      if (action === "insure" || action === "double" || action === "split") sounds.playChip()
      const res = await actionMutation.mutateAsync({ betId: round.betId, action })
      // Flip sound is owned by revealDealerThenSettle — don't play it here or the
      // hole still face-down gets an early flip cue before the choreography runs.
      applyServerRound(res, { choreographDeal: false })
      if (!res.settled) invalidateBalance()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed")
    } finally {
      inflightRef.current = false
      setBusy(false)
    }
  }

  const inRound = Boolean(round && (round.phase === "playing" || round.phase === "insurance"))
  const handStake = round?.hands[round.activeHand]?.stake ?? bet
  const baseForInsurance =
    (round?.persisted as BlackjackPersistedState | null)?.hands[0]?.stake ??
    round?.hands[0]?.stake ??
    bet
  const insCost = insuranceCost(baseForInsurance)

  let phase: BetButtonPhase = "ready"
  if (!affordable) phase = "invalid"
  if (busy || inRound || !dealReady) phase = "settling"

  const hint =
    authStatus !== "authenticated"
      ? "Sign in to play"
      : serverBalance < MIN_BET
        ? "Not enough ZP"
        : `Bets ${MIN_BET}–${MAX_BET} ZP`

  // Slice the live table to the current deal seat so cards mount one-by-one.
  const tableHands: PlayerHand[] = (() => {
    if (!round) return []
    if (dealReady || dealSeat >= 4) return round.hands
    return round.hands.map((h, hi) => {
      if (hi !== 0) return { ...h, cards: [] }
      const n = dealSeat >= 3 ? 2 : dealSeat >= 1 ? 1 : 0
      return { ...h, cards: h.cards.slice(0, n) }
    })
  })()

  const tableDealerUp = round && dealSeat >= 2 ? round.dealerUp : null
  // During resolve: show face-down hole until flip, then progressively reveal dealerCards.
  const resolving = Boolean(round?.phase === "settled" && !dealReady && round.dealerCards)
  const showHoleBack = Boolean(
    round &&
      dealSeat >= 4 &&
      !holeFlip &&
      (round.phase === "playing" || round.phase === "insurance" || resolving),
  )

  let tableDealerCards: Card[] | null = null
  if (round?.dealerCards && dealerShown > 0) {
    tableDealerCards = round.dealerCards.slice(0, dealerShown)
  } else if (round?.dealerCards && holeFlip && dealReady) {
    tableDealerCards = round.dealerCards
  }

  const tableHoleHidden = !(tableDealerCards && tableDealerCards.length >= 2 && holeFlip)

  const showActions = Boolean(inRound && round && dealReady && round.phase !== "settled")

  return (
    <>
      <GameCard
        icon={Spade}
        name="Blackjack"
        hint={hint}
        available={false}
        index={index}
        onClick={() => setOpen(true)}
        ariaLabel="Blackjack — beat the dealer at Vegas rules"
      />

      <GameDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            clearDealTimers()
            pendingSettleRef.current = null
            setRound(null)
            setOutcome(null)
            setFlash(null)
            setBanner(null)
            setHitSeq(0)
            setDealSeat(4)
            setDealReady(true)
            setHoleFlip(false)
            setDealerShown(0)
          }
        }}
        title="Blackjack"
        description="Vegas rules · dealer stands on soft 17 · blackjack pays 3:2. Abandoned hands forfeit the stake."
      >
        <CasinoShell
          balance={serverBalance}
          outcome={outcome}
          board={
            <BlackjackTable
              dealerUp={tableDealerUp}
              dealerCards={tableDealerCards}
              holeHidden={tableHoleHidden}
              forceHoleBack={showHoleBack}
              hands={tableHands}
              activeHand={round?.activeHand ?? 0}
              wager={round?.wager ?? (outcome ? outcome.staked : 0)}
              flash={flash}
              dealKey={dealKey}
              banner={banner}
              animateEnter={animateEnter}
              hitSeq={hitSeq}
              dealerHitFrom={2}
              insurancePrompt={showActions && round?.phase === "insurance"}
            />
          }
          panels={
            <div className="flex items-center justify-between gap-2">
              <BlackjackCapNote bet={bet} />
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const next = !sounds.isMuted()
                  sounds.setMuted(next)
                  setMutedUi(next)
                }}
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {muted ? "Muted" : "Sound"}
              </button>
            </div>
          }
          controls={
            <div className="flex flex-col gap-3">
              {showActions && round ? (
                <BlackjackActions
                  actions={round.actions}
                  busy={busy}
                  onAction={onAction}
                  canAffordDouble={serverBalance >= handStake}
                  canAffordSplit={serverBalance >= handStake}
                  canAffordInsurance={serverBalance >= insCost}
                  splitHint={
                    round.phase === "insurance"
                      ? `Dealer shows an Ace — insurance costs ${insCost} ZP (pays 2:1 if dealer has blackjack).`
                      : round.actions.includes("split")
                        ? "Split deals one card to each hand, then you play them in turn."
                        : round.hands.length > 1 && round.phase === "playing"
                          ? "Play the highlighted hand — Hit, Stand, or Double."
                          : null
                  }
                />
              ) : !dealReady && round ? (
                <p className="text-center text-sm text-muted-foreground">
                  {round.phase === "settled" && holeFlip ? "Dealer drawing…" : "Dealing…"}
                </p>
              ) : (
                <>
                  <BetInput value={bet} balance={serverBalance} onChange={setBet} locked={busy} />
                  <BetButton
                    phase={phase}
                    betLabel={`Bet ${bet} ZP`}
                    onClick={() => void onDeal()}
                    className={cn(phase === "invalid" && "opacity-60")}
                  />
                  {round?.phase === "settled" && dealReady && (
                    <p className="text-center text-xs text-muted-foreground">Bet again when ready</p>
                  )}
                </>
              )}
              {round?.resumed && inRound && dealReady && (
                <p className="text-center text-xs text-amber-700 dark:text-amber-400">
                  Resumed in-progress hand
                </p>
              )}
            </div>
          }
        />
      </GameDialog>
    </>
  )
}
