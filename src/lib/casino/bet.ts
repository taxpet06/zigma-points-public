// Casino betting spine — the ONE place every casino game debits a wager and credits a
// payout. Mirrors the shipped tetris.start()/tetris.end() shape (sweep, conditional
// updateMany debit, ACTIVE->SETTLED compare-and-set) so this phase adds no new
// concurrency pattern, only generalises the one already proven in production.
//
// Games call openBet()/settleBet() and derive their outcome from fairness.ts's floats().
// None of them reimplement the debit, the nonce allocation, or the settle CAS.

import { TRPCError } from "@trpc/server"
import type { Prisma, CasinoGame } from "../../../prisma/generated/prisma/client"
import { db, runSerializable } from "@/lib/db"
import { newServerSeed, hashServerSeed } from "@/lib/casino/fairness"
import { assertWagerInLimits, debitWhere, payoutFor, SWEEP_ACTIVE_AFTER_MS } from "@/lib/casino/limits"

type Tx = Prisma.TransactionClient

/** Idempotent ACTIVE->SETTLED compare-and-set, shared by settleBet() and the stale sweep
 *  inside openBet() — one settle implementation, not two (Pitfall 5). `where` may be
 *  narrowed further (the sweep adds a `createdAt` bound) but always includes id + userId +
 *  status: "ACTIVE" — the userId is the IDOR control (T-10-14): a stolen betId alone can
 *  never settle someone else's bet.
 *
 *  Exported for multi-step games (Mines, Chicken — Phase 12+): they settle from inside their
 *  own runSerializable callback, and settleBet() below opens its OWN db.$transaction — nesting
 *  that inside an already-open transaction blocks on the row lock the outer transaction holds,
 *  a self-deadlock that ties up a connection until Vercel's 10s function timeout kills the
 *  request, leaving the row ACTIVE (12-RESEARCH.md Pitfall 4). settleBet stays exactly as-is
 *  for single-shot games (Plinko); a caller already inside a transaction must call
 *  settleInTx(tx, ...) directly instead. */
export async function settleInTx(
  tx: Tx,
  opts: {
    betId: string
    userId: string
    wager: number
    multiplier: number
    outcome: unknown
    extraWhere?: Prisma.CasinoBetWhereInput
  },
): Promise<{ payout: number; multiplier: number; credited: boolean }> {
  const payout = payoutFor(opts.wager, opts.multiplier)

  const { count } = await tx.casinoBet.updateMany({
    where: { id: opts.betId, userId: opts.userId, status: "ACTIVE", ...opts.extraWhere },
    data: {
      status: "SETTLED",
      settledAt: new Date(),
      multiplier: opts.multiplier,
      payout,
      state: opts.outcome as Prisma.InputJsonValue,
    },
  })

  if (count === 0) {
    // Already settled (or the CAS predicate didn't match) — read back and credit nothing.
    // The read and the write are never separable in the winning path above, so this branch
    // can only be reached after someone else's write already won; recomputing from the
    // resent multiplier here would double-pay on a replay.
    const stored = await tx.casinoBet.findUnique({ where: { id: opts.betId } })
    return { payout: stored?.payout ?? 0, multiplier: stored?.multiplier ?? 0, credited: false }
  }

  if (payout > 0) {
    await tx.user.update({ where: { id: opts.userId }, data: { zigmaPoints: { increment: payout } } })
  }
  return { payout, multiplier: opts.multiplier, credited: true }
}

/** Sweeps this user's abandoned in-flight rounds before a new bet opens. Per
 *  10-CONTEXT.md § Abandoned rounds this is an auto-cash-out, never a void: the row's
 *  `multiplier` column carries the multiplier already safely earned during ACTIVE play
 *  (multi-step games update it on every safe step/lane), defaulting to 0 when nothing was
 *  earned yet, which settles as a plain loss. There is no cron budget (Vercel Hobby allows
 *  2, both used by settlement + daily reset) so this lazy per-user sweep is the design, not
 *  a workaround — see SWEEP_ACTIVE_AFTER_MS in limits.ts. */
async function sweepStale(tx: Tx, userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - SWEEP_ACTIVE_AFTER_MS)
  const stale = await tx.casinoBet.findMany({
    where: { userId, status: "ACTIVE", createdAt: { lt: cutoff } },
    select: { id: true, wager: true, multiplier: true },
  })
  for (const bet of stale) {
    await settleInTx(tx, {
      betId: bet.id,
      userId,
      wager: bet.wager,
      multiplier: bet.multiplier ?? 0,
      outcome: { swept: true, reason: "abandoned round auto-cashed-out" },
      extraWhere: { createdAt: { lt: cutoff } },
    })
  }
}

/** Lazily creates this user's active seed pair (the row with `revealedAt: null`). A
 *  read-then-insert — one of the two reasons openBet() needs Serializable, not just the
 *  debit. Exported so casino.ts's getSeed reuses this exact creation path instead of a
 *  second one (10-05-PLAN.md Task 1). */
export async function getOrCreateActiveSeed(tx: Tx, userId: string) {
  const existing = await tx.casinoSeed.findFirst({ where: { userId, revealedAt: null } })
  if (existing) return existing
  const serverSeed = newServerSeed()
  const serverSeedHash = await hashServerSeed(serverSeed)
  return tx.casinoSeed.create({
    data: {
      userId,
      serverSeed,
      serverSeedHash,
      clientSeed: newServerSeed().slice(0, 16),
      nonce: 0,
    },
  })
}

/** The single entry point for staking ZP (CASN-01). Every game calls this; none
 *  reimplements the debit.
 *
 *  ponytail: the debit itself (step 2 below) does NOT need Serializable — `updateMany`
 *  with the balance predicate in its WHERE is a single statement, and Postgres re-checks
 *  that predicate after taking the row lock, so the check and the write can't be raced
 *  apart no matter the isolation level (this is NOT the v1.0 CR-01 bug, which was a
 *  count-then-insert — a different shape). `openBet` still wraps everything in
 *  runSerializable because the stale sweep and the seed lookup-or-create ARE
 *  read-then-write sections, and one Serializable transaction for six games is worth more
 *  than shaving an isolation level off the debit alone. Do not "fix" this asymmetry by
 *  downgrading the whole transaction, or by adding Serializable just around the debit.
 *
 *  ponytail: no "one ACTIVE round per user" constraint here (no partial unique index, no
 *  app-level mutex) — Plinko needs multiple in-flight bets at once. Multi-step games
 *  (Mines, Chicken) enforce their own one-active-round check inside their own
 *  runSerializable call in their own phase. */
export async function openBet(opts: { userId: string; game: CasinoGame; wager: number; config: unknown }) {
  assertWagerInLimits(opts.wager) // outside the transaction — a rejected wager never opens one

  return runSerializable(async (tx) => {
    // 1. Cash out anything this user abandoned before touching their balance again.
    await sweepStale(tx, opts.userId)

    // 2. The debit. This WHERE clause IS the balance check — reading the balance then
    //    writing it is the CR-01 race in a costlier form. Never do that instead.
    const { count } = await tx.user.updateMany({
      where: debitWhere(opts.userId, opts.wager),
      data: { zigmaPoints: { decrement: opts.wager } },
    })
    if (count === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Not enough ZP." })

    // 3. Find-or-create this user's active seed pair.
    const seed = await getOrCreateActiveSeed(tx, opts.userId)

    // 4. Allocate the nonce by atomic increment, inside this same transaction as the
    //    insert below — never derive it by reading the last bet's stored value and
    //    adding one. @@unique([seedId, nonce]) is the unraceable backstop.
    const { nonce } = await tx.casinoSeed.update({
      where: { id: seed.id },
      data: { nonce: { increment: 1 } },
      select: { nonce: true },
    })

    const bet = await tx.casinoBet.create({
      data: {
        userId: opts.userId,
        game: opts.game,
        seedId: seed.id,
        nonce,
        wager: opts.wager,
        config: opts.config as Prisma.InputJsonValue,
        status: "ACTIVE",
      },
    })

    // seed.serverSeed below is a live, SECRET value — server-side only. The caller (a
    // game's router) uses it to derive the outcome; it must never be forwarded into a
    // tRPC response (Pitfall 2 / T-10-17).
    return { bet, seed: { serverSeed: seed.serverSeed, clientSeed: seed.clientSeed, nonce } }
  })
}

/** Idempotent ACTIVE->SETTLED credit (CASN-02). A resent settle (network retry, double
 *  tap) credits nothing twice and returns the stored result — see settleInTx above.
 *
 *  Deliberately sends no push notification on settle, unlike tetris.end(). 10-CONTEXT.md
 *  § Notifications locks this: a push per spin is spam — Dice alone could fire dozens a
 *  minute — and flappy.eat already set the precedent of skipping it for the same reason.
 *  The balance updates live in the UI via trpc.user.getMe invalidation instead. Copying
 *  tetris.end() verbatim here (which fires that notification helper after a credit)
 *  would silently reintroduce the spam. */
export async function settleBet(opts: {
  betId: string
  userId: string
  wager: number
  multiplier: number
  outcome: unknown
}): Promise<{ payout: number; multiplier: number; credited: boolean }> {
  return db.$transaction((tx) => settleInTx(tx, opts))
}
