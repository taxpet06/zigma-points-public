// Sequence Recall router — economy half plus the round/tier state machine.
// getStatus/start/end/leaderboard are a near-verbatim clone of the shipped
// Znake/Zross contract. beginRound/submitRound are the genuinely new part of this
// phase: no existing game in this codebase has forking, stateful round/tier
// progression — see 21-RESEARCH.md's state-machine sketch and 21-CONTEXT.md's
// locked failure/loop rules (the latter supersedes the former where they disagree).
//
// Anti-cheat model: the server owns the seed, the tier/round state machine, the
// input-window timestamp and the ZP value of a round; it re-derives the expected
// tile sequence itself (targetForRound) and never trusts a client-reported
// correctness flag, elapsed time, or sequence.

import { TRPCError } from "@trpc/server"
import { randomInt } from "crypto"
import { after } from "next/server"
import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import type { Prisma } from "../../../../prisma/generated/prisma/client"
import { dayKey } from "@/lib/day-key"
import { notifyZpChange, notifyLeaderboardPrize } from "@/lib/notifications"
import { claimsAllTimeCrown } from "@/lib/daily-prizes"
import {
  FREE_PLAYS_PER_DAY,
  REPLAY_COST,
  ALL_TIME_CROWN_ZP,
  SWEEP_ACTIVE_AFTER_MS,
  WINDOW_MS,
  CLOCK_SKEW_GRACE_MS,
  MIN_MS_PER_TAP,
  ZP_PER_ROUND,
  TILE_COUNT,
  MAX_TIER,
} from "./constants"
import { targetForRound, maxRoundsInTier, nextTierAfterClear, tapsMatch, sequenceLengthFor } from "./engine"
import { PLAYED_RUN_WHERE } from "@/lib/game-economy"

/** Flips an ACTIVE (or any non-ENDED) run to ENDED and, on that one transition, pays
 *  the all-time crown bonus if it just took sole #1. Takes a transaction client as
 *  its first argument and starts NO transaction of its own — this is the Phase 12-02
 *  `settleInTx` precedent, and it exists so a future `submitRound` failure branch can
 *  settle from inside its own transaction without nesting one. Returns whether the
 *  crown was paid. */
export async function settleEndedRunInTx(
  tx: Prisma.TransactionClient,
  { runId, userId, zpEarned }: { runId: string; userId: string; zpEarned: number },
): Promise<boolean> {
  const { count } = await tx.sequenceRecallRun.updateMany({
    where: { id: runId, status: { not: "ENDED" } },
    data: { status: "ENDED", endedAt: new Date() },
  })
  if (count === 0 || zpEarned <= 0) return false // lost the race, or unscored — no crown

  const others = await tx.sequenceRecallRun.aggregate({
    _max: { zpEarned: true },
    where: { status: "ENDED", zpEarned: { gt: 0 }, userId: { not: userId } },
  })
  const mine = await tx.sequenceRecallRun.aggregate({
    _max: { zpEarned: true },
    where: { status: "ENDED", zpEarned: { gt: 0 }, userId, id: { not: runId } },
  })
  if (!claimsAllTimeCrown(zpEarned, others._max.zpEarned ?? -1, mine._max.zpEarned ?? -1)) {
    return false
  }
  await tx.user.update({
    where: { id: userId },
    data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } },
  })
  return true
}

export const sequenceRecallRouter = createTRPCRouter({
  /** Drives the hub card: free runs left today, what a replay costs, and whether the
   *  user can start one right now (free run left, or enough ZP to buy a replay). */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = dayKey()
    const [runsToday, me] = await Promise.all([
      db.sequenceRecallRun.count({ where: { userId, day, ...PLAYED_RUN_WHERE } }),
      db.user.findUnique({ where: { id: userId }, select: { zigmaPoints: true } }),
    ])
    const runsRemaining = Math.max(0, FREE_PLAYS_PER_DAY - runsToday)
    const canAffordReplay = (me?.zigmaPoints ?? 0) >= REPLAY_COST
    return {
      day,
      runsToday,
      runsRemaining,
      replayCost: REPLAY_COST,
      canAffordReplay,
      canPlay: runsRemaining > 0 || canAffordReplay,
    }
  }),

  /** Issues a run token + seed. The day's first run is free and banks ZP; every run
   *  after it debits REPLAY_COST and banks none (leaderboard-only). tier/round start
   *  at the Prisma row defaults (1/1) and are returned so the client never has to
   *  assume the starting state. */
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = dayKey()

    // Serializable + retry: the count-then-insert free-run check below is only
    // race-safe under Serializable — concurrent start()s can't all read runsToday=0
    // and all get a free run. See runSerializable in @/lib/db.
    const created = await runSerializable(async (tx) => {
      // 1. Sweep this user's stale ACTIVE rows.
      await tx.sequenceRecallRun.updateMany({
        where: {
          userId,
          status: "ACTIVE",
          startedAt: { lt: new Date(Date.now() - SWEEP_ACTIVE_AFTER_MS) },
        },
        data: { status: "ABANDONED", endedAt: new Date() },
      })

      // 2. Free run, or a paid replay? Past the free allowance the ZP is debited here —
      // conditional updateMany, so the balance check and the debit can't be separated.
      const runsToday = await tx.sequenceRecallRun.count({ where: { userId, day, ...PLAYED_RUN_WHERE } })
      const entryCost = runsToday < FREE_PLAYS_PER_DAY ? 0 : REPLAY_COST
      if (entryCost > 0) {
        const { count } = await tx.user.updateMany({
          where: { id: userId, zigmaPoints: { gte: entryCost } },
          data: { zigmaPoints: { decrement: entryCost } },
        })
        if (count === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You need ${entryCost} ZP to replay. Your free run resets at midnight.`,
          })
        }
      }

      // 3. Insert the run with a fresh seed. Postgres INTEGER is signed 32-bit,
      // so cap at 2^31 — mulberry32 takes any non-negative 32-bit int.
      const seed = randomInt(0, 2 ** 31)
      const row = await tx.sequenceRecallRun.create({
        data: { userId, day, seed, entryCost, status: "ACTIVE" },
        select: { id: true, seed: true, tier: true, round: true },
      })
      return { row, entryCost, runsToday: runsToday + 1 }
    })

    return {
      runId: created.row.id,
      seed: created.row.seed,
      entryCost: created.entryCost,
      tier: created.row.tier,
      round: created.row.round,
      runsRemaining: Math.max(0, FREE_PLAYS_PER_DAY - created.runsToday),
    }
  }),

  /** Arms the current round's fixed 5-second input window with a SERVER timestamp,
   *  fired by the client exactly when blink playback finishes — not on run.startedAt
   *  and not implicitly on the previous round's response (21-RESEARCH.md Pattern 2:
   *  the reveal's variable playback time must never eat into the fixed response
   *  window). Idempotent, but NOT the sibling games' "harmless no-op" idempotency: a
   *  retried request must never buy the player extra time, so a round that is already
   *  armed returns the EXISTING timestamp unchanged and performs no write. */
  beginRound: protectedProcedure
    .input(
      z.object({ runId: z.string(), tier: z.number().int().min(1).max(MAX_TIER), round: z.number().int().min(1).max(TILE_COUNT) }).strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      return db.$transaction(async (tx) => {
        const run = await tx.sequenceRecallRun.findUnique({
          where: { id: input.runId },
          select: { id: true, userId: true, status: true, seed: true, tier: true, round: true, roundInputStartedAt: true },
        })
        if (!run || run.userId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Run not found." })
        }
        if (run.status !== "ACTIVE") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Run is not active." })
        }
        // A round beyond the tier's cap is not a reachable state and must never be
        // armed — same 25-tile ceiling that gives maxRoundsInTier its meaning.
        if (input.round > maxRoundsInTier(input.tier)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Round exceeds this tier's cap." })
        }
        // Stale-request guard — the same stale-request contract submitRound uses.
        if (input.tier !== run.tier || input.round !== run.round) {
          throw new TRPCError({ code: "CONFLICT", message: "Round already resolved." })
        }

        let roundInputStartedAt = run.roundInputStartedAt
        if (!roundInputStartedAt) {
          // First arm for this (tier, round) only, enforced as an atomic null->value
          // compare-and-set — the same idiom prizes.ts uses for daily-prize idempotency.
          //
          // The read above is NOT sufficient on its own: Prisma's interactive
          // transaction runs at the database default (READ COMMITTED), so two
          // CONCURRENT beginRound calls could both observe null and the second would
          // overwrite the first's timestamp, sliding the window's start later. Putting
          // `roundInputStartedAt: null` in the WHERE makes the row's own state the
          // arbiter: exactly one caller can ever flip it, and a loser re-reads the
          // winner's timestamp rather than stamping its own. A retried OR raced
          // beginRound therefore never buys the player extra time (21-RESEARCH.md
          // Pattern 2).
          const stamp = new Date()
          const { count } = await tx.sequenceRecallRun.updateMany({
            where: { id: run.id, roundInputStartedAt: null },
            data: { roundInputStartedAt: stamp },
          })
          if (count === 1) {
            roundInputStartedAt = stamp
          } else {
            // Lost the arm race. The winner has committed, so re-read and adopt ITS
            // timestamp — never our own, which is by definition the later one.
            const armed = await tx.sequenceRecallRun.findUnique({
              where: { id: run.id },
              select: { roundInputStartedAt: true },
            })
            roundInputStartedAt = armed?.roundInputStartedAt ?? stamp
          }
        }

        return {
          tier: run.tier,
          round: run.round,
          // Informational only. Computed from the pure per-round formula (identical to
          // targetForRound(...).length for any reachable round, since maxRoundsInTier
          // already guarantees tier*round <= TILE_COUNT), so it never doubles as a value
          // the server would later accept back — it is safe to expose but the client
          // does NOT currently read it, deriving its own length from the same seed.
          // Kept as a debugging/parity aid and covered by the router test; wire a real
          // client-side mismatch assertion here if seed drift ever needs detecting.
          sequenceLength: sequenceLengthFor(run.tier, run.round),
          windowMs: WINDOW_MS,
          roundInputStartedAt,
        }
      })
    }),

  /** Resolves one round: re-derives the expected tile sequence from the run's own
   *  seed and re-times elapsedMs against the run's own server-stamped
   *  roundInputStartedAt — never a client-supplied sequence, correctness flag, or
   *  elapsed time. Banks a flat ZP_PER_ROUND on success and advances or loops the
   *  tier; on ANY failure (wrong tile, wrong order, or the window elapsing) the run
   *  is terminally settled inside this same transaction, so a client can never dodge
   *  the loss by skipping `end` and re-arming the same round via `beginRound`
   *  (21-CONTEXT.md "Failure behavior" supersedes 21-RESEARCH.md's older
   *  failure-escalates-the-tier sketch; loop-at-tier-25 supersedes its
   *  run-ends-at-tier-25 sketch). */
  submitRound: protectedProcedure
    .input(
      z
        .object({
          runId: z.string(),
          tier: z.number().int().min(1).max(MAX_TIER),
          round: z.number().int().min(1).max(TILE_COUNT),
          taps: z.array(z.number().int().min(0).max(TILE_COUNT - 1)).max(TILE_COUNT),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const result = await db.$transaction(async (tx) => {
        const run = await tx.sequenceRecallRun.findUnique({
          where: { id: input.runId },
          select: {
            id: true,
            userId: true,
            status: true,
            seed: true,
            tier: true,
            round: true,
            zpEarned: true,
            entryCost: true,
            roundInputStartedAt: true,
          },
        })
        if (!run || run.userId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Run not found." })
        }
        if (run.status !== "ACTIVE") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Run is not active." })
        }
        // Stale/replayed submission — the round already advanced past this one.
        // Unlike the sibling games' index claims, this is NOT a safe silent no-op:
        // the round is a forking state machine, so a replayed submission must be
        // rejected rather than absorbed (21-RESEARCH.md Pitfall 2). Client contract:
        // treat this CONFLICT as "re-sync via getStatus, do not show an error."
        if (input.tier !== run.tier || input.round !== run.round) {
          throw new TRPCError({ code: "CONFLICT", message: "Round already resolved." })
        }
        if (!run.roundInputStartedAt) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Round not started." })
        }

        // Both derived exclusively from server-owned state — never a client-supplied
        // sequence or elapsed time.
        const expected = targetForRound(run.seed, run.tier, run.round)
        const elapsedMs = Date.now() - run.roundInputStartedAt.getTime()

        let reason: "wrong" | "timeout" | "tooFast" | null = null
        if (elapsedMs > WINDOW_MS + CLOCK_SKEW_GRACE_MS) {
          reason = "timeout"
        } else if (elapsedMs < expected.length * MIN_MS_PER_TAP) {
          // Human floor per tap, not per-round — same rate-ceiling philosophy as the
          // sibling games' MIN_MS_PER_APPLE/MIN_MS_PER_EDIBLE.
          reason = "tooFast"
        } else {
          const verdict = tapsMatch(input.taps, expected)
          if (verdict === "prefix") {
            // A correct-but-incomplete answer means the player ran out of time before
            // finishing — classifying this as "wrong" would show the wrong copy.
            reason = "timeout"
          } else if (verdict === "wrong") {
            reason = "wrong"
          }
        }

        if (reason === null) {
          // Success — the run NEVER ends here. Clearing a tier's last round advances
          // to the next tier with no re-entry cost; clearing tier 25 loops back to
          // tier 1 via nextTierAfterClear and the run stays ACTIVE (21-CONTEXT.md
          // "Tier-25 ceiling behavior").
          const points = ZP_PER_ROUND
          const zpDelta = run.entryCost > 0 ? 0 : points
          const isLastRound = run.round === maxRoundsInTier(run.tier)
          const nextTier = isLastRound ? nextTierAfterClear(run.tier) : run.tier
          const nextRound = isLastRound ? 1 : run.round + 1

          const updated = await tx.sequenceRecallRun.update({
            where: { id: run.id },
            data: {
              tier: nextTier,
              round: nextRound,
              zpEarned: { increment: points },
              roundInputStartedAt: null,
            },
            select: { zpEarned: true },
          })
          if (zpDelta > 0) {
            await tx.user.update({
              where: { id: userId },
              data: { zigmaPoints: { increment: zpDelta } },
            })
          }
          return {
            correct: true as const,
            reason: null,
            tier: nextTier,
            round: nextRound,
            zpEarned: updated.zpEarned,
            tierCleared: isLastRound,
            runEnded: false as const,
            crowned: false,
          }
        }

        // Failure — leave tier/round untouched so the summary reports where the
        // player actually died: no escalation, no reset-in-place. The settle MUST
        // happen here, inside this same transaction, and not be left to the client's
        // `end` call: without a server-side terminal flip a client could simply never
        // call `end`, re-arm the same round via `beginRound`, and retry a failed
        // round for free — which would break the locked "failure ends the run" rule.
        await tx.sequenceRecallRun.update({
          where: { id: run.id },
          data: { roundInputStartedAt: null },
        })
        const crowned = await settleEndedRunInTx(tx, { runId: run.id, userId, zpEarned: run.zpEarned })
        return {
          correct: false as const,
          reason,
          tier: run.tier,
          round: run.round,
          zpEarned: run.zpEarned,
          tierCleared: false,
          runEnded: true as const,
          crowned,
        }
      })

      // `end` early-returns on an already-ENDED run and would otherwise send neither
      // notification, so the failure branch sends both itself here — the same two
      // notifications `end` sends on every other game's run-ending path.
      if (result.runEnded) {
        after(() => notifyZpChange(userId))
        if (result.crowned) {
          after(() => notifyLeaderboardPrize(userId, "Monkey Test", 1, ALL_TIME_CROWN_ZP, "all-time"))
        }
      }
      const { crowned: _crowned, ...response } = result
      return response
    }),

  /** Client tells server "the run is over." Idempotent — a second call returns the
   *  same summary and is a no-op on the DB. This is also the path taken after a
   *  submitRound failure branch has already settled a failed run. */
  end: protectedProcedure
    // .strict() to match beginRound/submitRound — every input on this router rejects
    // unknown keys outright rather than silently stripping them, so a client sending
    // an unexpected field gets an error instead of a quietly-ignored payload.
    .input(z.object({ runId: z.string() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const run = await db.sequenceRecallRun.findUnique({
        where: { id: input.runId },
        select: { id: true, userId: true, status: true, zpEarned: true, tier: true, round: true, entryCost: true },
      })
      if (!run || run.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Run not found." })
      }
      const isPaidReplay = run.entryCost > 0
      const summary = {
        zpEarned: run.zpEarned,
        tier: run.tier,
        round: run.round,
        zpWon: isPaidReplay ? 0 : run.zpEarned,
        isPaidReplay,
      }
      if (run.status === "ENDED") {
        return summary
      }

      const crowned = await db.$transaction((tx) =>
        settleEndedRunInTx(tx, { runId: run.id, userId, zpEarned: run.zpEarned }),
      )
      after(() => notifyZpChange(userId))
      // The crown is leaderboard ZP — name the board and the payout, not just "balance changed".
      if (crowned) {
        after(() => notifyLeaderboardPrize(userId, "Monkey Test", 1, ALL_TIME_CROWN_ZP, "all-time"))
      }
      return summary
    }),

  /** Top-10 leaderboard, deduplicated to each user's single best run in scope.
   *  Only ENDED runs count (in-flight games shouldn't leak progress). */
  leaderboard: protectedProcedure
    .input(z.object({ scope: z.enum(["today", "all-time"]) }))
    .query(async ({ input }) => {
      const scopeWhere = input.scope === "today" ? { day: dayKey() } : {}
      const grouped = await db.sequenceRecallRun.groupBy({
        by: ["userId"],
        where: { status: "ENDED", ...scopeWhere },
        _max: { zpEarned: true },
        orderBy: { _max: { zpEarned: "desc" } },
        take: 10,
      })
      const scored = grouped.filter((g) => (g._max.zpEarned ?? 0) > 0)
      if (scored.length === 0) return []
      const users = await db.user.findMany({
        where: { id: { in: scored.map((g) => g.userId) } },
        select: { id: true, name: true, username: true, image: true },
      })
      const userById = new Map(users.map((u) => [u.id, u]))
      return scored.map((g, i) => {
        const u = userById.get(g.userId)
        return {
          rank: i + 1,
          userId: g.userId,
          name: u?.name ?? null,
          username: u?.username ?? null,
          image: u?.image ?? null,
          score: g._max.zpEarned ?? 0,
        }
      })
    }),
})
