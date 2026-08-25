"use client"

// BetPanel — the interactive surface for a BET-kind Task (rendered on /tasks/[id]).
// Three audiences, one component:
//   • A user who hasn't bet → choice picker + stake input → placeBet
//   • A user who has bet     → locked ticket + live pot/odds
//   • An admin (pre-settle)  → "declare winner" control → settleBet (pays out the pot)
// Post-settlement everyone sees the winning choice and their own result.
//
// Reads its own snapshot via bet.getBetState (aggregate totals only — no per-user
// stake disclosure). Money mutations are guarded + atomic server-side (bet router).

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Check, Trophy, Coins, Lock, Ban } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

// "Jul 12, 6:00 PM" in the viewer's locale/timezone. Client-only component, no SSR mismatch.
function formatCloseTime(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// One selectable choice row with a live odds bar. Used for both betting and settling.
function ChoiceRow({
  label,
  total,
  count,
  pot,
  selected,
  onSelect,
  disabled,
  variant = "default",
}: {
  label: string
  total: number
  count: number
  pot: number
  selected?: boolean
  onSelect?: () => void
  disabled?: boolean
  variant?: "default" | "win" | "mine"
}) {
  const share = pot > 0 ? total / pot : 0
  const interactive = !!onSelect && !disabled

  const ring =
    variant === "win"
      ? "border-emerald-500/70 bg-emerald-500/5"
      : selected
      ? "border-primary bg-primary/5 ring-1 ring-primary"
      : variant === "mine"
      ? "border-primary/50 bg-primary/5"
      : "border-border"

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !onSelect}
      aria-pressed={selected}
      className={`relative w-full overflow-hidden rounded-lg border ${ring} px-3.5 py-3 text-left transition-[transform,border-color,background-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        interactive
          ? "hover:border-primary/60 active:scale-[0.99] cursor-pointer"
          : "cursor-default"
      } disabled:cursor-default`}
    >
      {/* Odds bar — share of the pot, GPU-friendly scaleX */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 origin-left ${
          variant === "win" ? "bg-emerald-500/12" : "bg-primary/10"
        } transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`}
        style={{ width: "100%", transform: `scaleX(${share})` }}
      />
      <span className="relative flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          {variant === "win" && <Trophy className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          {selected && variant !== "win" && (
            <Check className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          <span>{label}</span>
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{total} ZP</span>
          <span className="ml-1.5">
            {pct(total, pot)}% · {count} {count === 1 ? "bet" : "bets"}
          </span>
        </span>
      </span>
    </button>
  )
}

export function BetPanel({ taskId, isAdmin }: { taskId: string; isAdmin: boolean }) {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery(trpc.bet.getBetState.queryOptions({ taskId }))

  const [choice, setChoice] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [winner, setWinner] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)

  function invalidate() {
    void qc.invalidateQueries(trpc.bet.getBetState.queryFilter({ taskId }))
    void qc.invalidateQueries(trpc.user.getMe.queryFilter())
  }

  const placeBet = useMutation(
    trpc.bet.placeBet.mutationOptions({
      onSuccess: () => {
        invalidate()
        setChoice(null)
        setAmount("")
        toast.success("Bet placed — good luck")
      },
      onError: (e) => toast.error(e.message || "Couldn't place that bet"),
    })
  )

  const lockBets = useMutation(
    trpc.bet.lockBets.mutationOptions({
      onSuccess: () => {
        invalidate()
        setLockConfirmOpen(false)
        toast.success("Betting locked")
      },
      onError: (e) => {
        setLockConfirmOpen(false)
        toast.error(e.message || "Couldn't lock betting")
      },
    })
  )

  const cancelBet = useMutation(
    trpc.bet.cancelBet.mutationOptions({
      onSuccess: () => {
        invalidate()
        setCancelConfirmOpen(false)
        toast.success("Pool cancelled — every stake refunded")
      },
      onError: (e) => {
        setCancelConfirmOpen(false)
        toast.error(e.message || "Couldn't cancel the pool")
      },
    })
  )

  const settleBet = useMutation(
    trpc.bet.settleBet.mutationOptions({
      onSuccess: () => {
        invalidate()
        setConfirmOpen(false)
        setWinner(null)
        toast.success("Pool settled — payouts sent")
      },
      onError: (e) => {
        setConfirmOpen(false)
        toast.error(e.message || "Couldn't settle the pool")
      },
    })
  )

  // Flip to the locked state live: one refetch scheduled for the cutoff moment.
  // The server recomputes `locked`, so a stale tab can't keep the form open.
  const closeAtMs = data?.betsCloseAt ? new Date(data.betsCloseAt).getTime() : null
  const isLocked = !!data?.locked
  useEffect(() => {
    if (closeAtMs === null || isLocked) return
    const wait = closeAtMs - Date.now() + 500
    if (wait > 2 ** 31 - 1) return // ponytail: setTimeout overflows past ~24.8 days; a refresh covers cutoffs that far out
    const t = setTimeout(
      () => void qc.invalidateQueries(trpc.bet.getBetState.queryFilter({ taskId })),
      Math.max(0, wait)
    )
    return () => clearTimeout(t)
  }, [closeAtMs, isLocked, qc, trpc, taskId])

  if (isLoading || !data) {
    return <div className="h-52 rounded-xl border bg-card animate-pulse" aria-busy="true" />
  }

  const { choices, minBet, betsCloseAt, locked, settled, winningChoice, pot, tally, bettorCount, myBalance, myBet } = data
  const tallyOf = (c: string) => tally.find((t) => t.choice === c) ?? { total: 0, count: 0 }

  // A cancelled pool is settled with no winning choice (bet.cancelBet) — every stake
  // was refunded, so nothing here should read as a win or a loss.
  const cancelled = settled && !winningChoice

  const amt = Number(amount)
  const amtValid = Number.isInteger(amt) && amt >= minBet && amt <= myBalance
  const canAfford = myBalance >= minBet

  return (
    <section
      className={`rounded-xl border bg-card p-4 sm:p-5 animate-card-rise ${
        cancelled ? "opacity-70 grayscale hover:opacity-100" : ""
      }`}
      aria-label="Betting Pool"
    >
      {/* Header: pot + meta */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {cancelled ? "Refunded pot" : settled ? "Final pot" : "Prize pot"}
          </p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-3xl font-bold tabular-nums ${
              // Struck through on a cancelled pool: this ZP was never won by anyone.
              cancelled ? "text-muted-foreground line-through decoration-2" : ""
            }`}
          >
            <Coins
              className={`h-6 w-6 ${cancelled ? "text-muted-foreground" : "text-emerald-600"}`}
              aria-hidden="true"
            />
            {pot}
            <span className="text-lg font-semibold text-muted-foreground">ZP</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5 pb-1 text-right text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {bettorCount} {bettorCount === 1 ? "bettor" : "bettors"}
          </span>
          <span className="text-xs">min bet {minBet} ZP</span>
          {betsCloseAt && !settled && !locked && (
            <span className="text-xs">bets close {formatCloseTime(betsCloseAt)}</span>
          )}
        </div>
      </div>

      {/* Cancelled banner — an admin voided the pool; every stake went back */}
      {cancelled && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm font-medium text-muted-foreground">
          <Ban className="h-4 w-4" aria-hidden="true" />
          An admin cancelled this pool. Every stake was refunded.
        </div>
      )}

      {/* Locked banner — cutoff passed, result pending */}
      {locked && !settled && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-400">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Betting is locked — waiting for the result.
        </div>
      )}

      {/* Settled banner */}
      {settled && winningChoice && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Trophy className="h-4 w-4" aria-hidden="true" />
          {winningChoice} won the pool.
        </div>
      )}

      {/* Choices + odds */}
      <div className="mt-4 space-y-2">
        {choices.map((c) => {
          const t = tallyOf(c)
          const isWinner = settled && c === winningChoice
          const isMine = !settled && myBet?.choice === c
          const selectable = !settled && !locked && !myBet && canAfford
          return (
            <ChoiceRow
              key={c}
              label={c}
              total={t.total}
              count={t.count}
              pot={pot}
              selected={selectable ? choice === c : false}
              onSelect={selectable ? () => setChoice(c) : undefined}
              variant={isWinner ? "win" : isMine ? "mine" : "default"}
            />
          )
        })}
      </div>

      {/* --- Your-bet / stake / result zone --- */}
      {myBet ? (
        <div className="mt-4 rounded-lg bg-muted/60 px-3.5 py-3 text-sm">
          {!settled ? (
            <p>
              Your bet: <span className="font-semibold">{myBet.amount} ZP</span> on{" "}
              <span className="font-semibold">{myBet.choice}</span>. Waiting for the result…
            </p>
          ) : cancelled ? (
            <p>Your {myBet.amount} ZP stake was refunded.</p>
          ) : myBet.payout && myBet.payout > 0 ? (
            myBet.payout === myBet.amount ? (
              <p>Nobody called it — your {myBet.amount} ZP stake was refunded.</p>
            ) : (
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                You won {myBet.payout} ZP — net {myBet.payout - myBet.amount >= 0 ? "+" : ""}
                {myBet.payout - myBet.amount} ZP.
              </p>
            )
          ) : (
            <p className="text-muted-foreground">
              Your {myBet.amount} ZP on {myBet.choice} didn&apos;t hit. Better luck next round.
            </p>
          )}
        </div>
      ) : settled ? (
        <p className="mt-4 text-sm text-muted-foreground">You didn&apos;t bet on this one.</p>
      ) : locked ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Bets closed {betsCloseAt ? formatCloseTime(betsCloseAt) : ""} — you didn&apos;t get one in.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-muted-foreground">
          You need at least {minBet} ZP to bet — you have {myBalance} ZP.
        </p>
      ) : (
        /* Stake input + place bet */
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type="number"
                inputMode="numeric"
                min={minBet}
                max={myBalance}
                placeholder={`Stake (min ${minBet})`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Bet amount in ZP"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAmount(String(myBalance))}
              disabled={myBalance <= 0}
            >
              All in
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              You have <span className="font-semibold text-foreground">{myBalance} ZP</span>
            </p>
            <Button
              type="button"
              disabled={!choice || !amtValid || placeBet.isPending}
              onClick={() => choice && placeBet.mutate({ taskId, choice, amount: amt })}
            >
              {placeBet.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Placing…
                </>
              ) : choice ? (
                `Bet ${amtValid ? amt : ""} ZP on ${choice}`
              ) : (
                "Pick a choice"
              )}
            </Button>
          </div>
        </div>
      )}

      {/* --- Admin lock control --- */}
      {isAdmin && !settled && !locked && (
        <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {betsCloseAt
              ? `Bets lock automatically at ${formatCloseTime(betsCloseAt)}.`
              : "No betting cutoff set — bets stay open until you settle."}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setLockConfirmOpen(true)}
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Lock betting now
          </Button>
        </div>
      )}

      {/* --- Admin settle control --- */}
      {isAdmin && !settled && (
        <div className="mt-5 border-t pt-4">
          <p className="text-sm font-semibold">Settle the pool</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick the winning choice — the {pot} ZP pot is split among its backers by stake.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {choices.map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                variant={winner === c ? "default" : "outline"}
                aria-pressed={winner === c}
                onClick={() => setWinner(c)}
              >
                {c}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="destructive"
            className="mt-3 w-full"
            disabled={!winner}
            onClick={() => setConfirmOpen(true)}
          >
            Declare winner &amp; pay out
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-muted-foreground"
            onClick={() => setCancelConfirmOpen(true)}
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Cancel pool &amp; refund
          </Button>
        </div>
      )}

      {/* Confirm dialog — locking is irreversible (no reopening a locked pool) */}
      <Dialog open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lock betting now?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            No further bets can be placed and the pool can&apos;t be reopened or edited.
            You&apos;ll still declare the winner to pay out the {pot} ZP pot.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={lockBets.isPending}
              onClick={() => lockBets.mutate({ taskId })}
            >
              {lockBets.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Locking…
                </>
              ) : (
                "Lock betting"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog — cancelling is irreversible (no un-cancel procedure) */}
      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this pool?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            All {pot} ZP goes back to the {bettorCount} {bettorCount === 1 ? "bettor" : "bettors"}{" "}
            who staked it. Nobody wins, no further bets can be placed, and the pool can&apos;t be
            reopened or settled afterwards.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelConfirmOpen(false)}>
              Keep pool
            </Button>
            <Button
              variant="destructive"
              disabled={cancelBet.isPending}
              onClick={() => cancelBet.mutate({ taskId })}
            >
              {cancelBet.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Refunding…
                </>
              ) : (
                "Cancel & refund"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog — settlement is irreversible */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Declare {winner} the winner?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This pays out the {pot} ZP pot to everyone who bet on{" "}
            <span className="font-medium text-foreground">{winner}</span>, proportional to their
            stake. It can&apos;t be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={settleBet.isPending}
              onClick={() => winner && settleBet.mutate({ taskId, winningChoice: winner })}
            >
              {settleBet.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Paying out…
                </>
              ) : (
                "Pay out pot"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
