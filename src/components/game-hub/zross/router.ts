// Zross router — server-authoritative ZP debits/credits + anti-cheat validation.
// Cloned from the Znake router (same start/collect/end/leaderboard contract, same
// free-run-then-paid-replay economy); the differences are called out inline.
//
// Anti-cheat model: gameplay is client-side (there is no server sim), so the
// server owns three things and trusts nothing else — (1) the claim counter, so a
// pickup can only be claimed once and only in order, (2) the claim RATE, so a
// script can't out-run what the simulation could physically produce, and (3) the
// ZP value of a pickup, which is a constant the client never supplies. Unlike
// Flappy there is no seeded layout to validate against: pickup placement depends
// on where the frog happens to be, which the server doesn't track. The counter
// plus the rate ceiling is what bounds the exploit, and it bounds it the same way.

import { TRPCError } from "@trpc/server"
import { randomInt } from "crypto"
import { after } from "next/server"
import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import { dayKey } from "@/lib/day-key"
import { notifyZpChange, notifyLeaderboardPrize } from "@/lib/notifications"
import { claimsAllTimeCrown } from "@/lib/daily-prizes"
import {
  FREE_PLAYS_PER_DAY,
  REPLAY_COST,
  ALL_TIME_CROWN_ZP,
  SWEEP_ACTIVE_AFTER_MS,
  MIN_MS_PER_PICKUP,
  ZP_PER_PICKUP,
} from "./constants"
import { PLAYED_RUN_WHERE } from "@/lib/game-economy"

export const zrossRouter = createTRPCRouter({
  /** Drives the hub card: free runs left today, what a replay costs, and whether the
   *  user can start one right now (free run left, or enough ZP to buy a replay). */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = dayKey()
    const [runsToday, me] = await Promise.all([
      db.zrossRun.count({ where: { userId, day, ...PLAYED_RUN_WHERE } }),
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
   *  after it debits REPLAY_COST and banks none (leaderboard-only). */
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = dayKey()

    // Serializable + retry: the count-then-insert free-run check below is only
    // race-safe under Serializable — concurrent start()s can't all read runsToday=0
    // and all get a free run. See runSerializable in @/lib/db.
    const created = await runSerializable(async (tx) => {
      // 1. Sweep this user's stale ACTIVE rows.
      await tx.zrossRun.updateMany({
        where: {
          userId,
          status: "ACTIVE",
          startedAt: { lt: new Date(Date.now() - SWEEP_ACTIVE_AFTER_MS) },
        },
        data: { status: "ABANDONED", endedAt: new Date() },
      })

      // 2. Free run, or a paid replay? Past the free allowance the ZP is debited here —
      // conditional updateMany, so the balance check and the debit can't be separated.
      const runsToday = await tx.zrossRun.count({ where: { userId, day, ...PLAYED_RUN_WHERE } })
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
      const row = await tx.zrossRun.create({
        data: { userId, day, seed, entryCost, status: "ACTIVE" },
        select: { id: true, seed: true },
      })
      return { row, entryCost, runsToday: runsToday + 1 }
    })

    return {
      runId: created.row.id,
      seed: created.row.seed,
      entryCost: created.entryCost,
      runsRemaining: Math.max(0, FREE_PLAYS_PER_DAY - created.runsToday),
    }
  }),

  /** Claim one collected pickup. Hot path — must be cheap. Anti-cheat is the point. */
  collect: protectedProcedure
    .input(z.object({ runId: z.string(), pickupIndex: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      return db.$transaction(async (tx) => {
        const run = await tx.zrossRun.findUnique({
          where: { id: input.runId },
          select: {
            id: true,
            userId: true,
            status: true,
            startedAt: true,
            pickupsClaimed: true,
            zpEarned: true,
            entryCost: true,
          },
        })
        if (!run || run.userId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Run not found." })
        }
        if (run.status !== "ACTIVE") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Run is not active." })
        }

        // Pickups are placed one at a time and pickupIndex is the client's running
        // count, so "index N collected" means "N+1 pickups so far" — the claim is a
        // TOTAL, not a delta. An index below what's already banked is a duplicate (a
        // retried request) and is rejected outright.
        if (input.pickupIndex < run.pickupsClaimed) {
          throw new TRPCError({ code: "CONFLICT", message: "Pickup already claimed." })
        }
        // A GAP is not rejected, it is absorbed: claiming index 7 with 5 banked pays
        // the 2 that went missing. Requiring exact sequence looked stricter but was
        // worse — one dropped request on a phone network desynced the rest of the run,
        // silently scoring nothing while the player kept collecting. The rate ceiling
        // below is what actually bounds a forged jump, and it bounds a big one harder.
        const claimed = input.pickupIndex + 1
        const gained = claimed - run.pickupsClaimed

        // Rate limit: the run's AVERAGE seconds-per-pickup, measured against the total
        // being claimed. Skipped for the very first pickup, which can legitimately spawn
        // one hop ahead of the frog. A rejection here is recoverable — the next pickup
        // re-claims the same ground with more elapsed time behind it.
        const elapsedMs = Date.now() - run.startedAt.getTime()
        if (claimed > 1 && elapsedMs / claimed < MIN_MS_PER_PICKUP) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Collecting too fast." })
        }

        // zpEarned is the run's SCORE — it drives the HUD and leaderboard. On a FREE
        // run every point also pays out to the balance. A PAID replay credits nothing
        // at all — it still scores, it just doesn't bank.
        const points = gained * ZP_PER_PICKUP
        const zpDelta = run.entryCost > 0 ? 0 : points
        const updated = await tx.zrossRun.update({
          where: { id: run.id },
          data: {
            pickupsClaimed: claimed,
            zpEarned: { increment: points },
          },
          select: { zpEarned: true },
        })
        if (zpDelta > 0) {
          await tx.user.update({
            where: { id: userId },
            data: { zigmaPoints: { increment: zpDelta } },
          })
        }
        // Deliberately no notifyZpChange — would spam email/push. `end` sends one summary.
        return { score: updated.zpEarned, zpDelta }
      })
    }),

  /** Client tells server "the run is over." Idempotent — a second call returns
   *  the same summary and is a no-op on the DB. */
  end: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const run = await db.zrossRun.findUnique({
        where: { id: input.runId },
        select: { id: true, userId: true, status: true, zpEarned: true, pickupsClaimed: true, entryCost: true },
      })
      if (!run || run.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Run not found." })
      }
      const isPaidReplay = run.entryCost > 0
      const summary = {
        score: run.zpEarned,
        pickups: run.pickupsClaimed,
        zpWon: isPaidReplay ? 0 : run.zpEarned,
        isPaidReplay,
      }
      if (run.status === "ENDED") {
        return summary
      }

      // Flip to ENDED and, on that one transition, pay the crown bonus if this run just
      // took sole #1 on the all-time leaderboard. The updateMany is a compare-and-set:
      // concurrent end() calls can't both flip ACTIVE→ENDED, so the crown fires at most
      // once. The crown pays on paid replays too — chasing it is what you buy runs for.
      let crowned = false
      await db.$transaction(async (tx) => {
        const { count } = await tx.zrossRun.updateMany({
          where: { id: run.id, status: { not: "ENDED" } },
          data: { status: "ENDED", endedAt: new Date() },
        })
        if (count === 0 || run.zpEarned <= 0) return // lost the race, or unscored — no crown

        const others = await tx.zrossRun.aggregate({
          _max: { zpEarned: true },
          where: { status: "ENDED", zpEarned: { gt: 0 }, userId: { not: userId } },
        })
        const mine = await tx.zrossRun.aggregate({
          _max: { zpEarned: true },
          where: { status: "ENDED", zpEarned: { gt: 0 }, userId, id: { not: run.id } },
        })
        if (claimsAllTimeCrown(run.zpEarned, others._max.zpEarned ?? -1, mine._max.zpEarned ?? -1)) {
          await tx.user.update({
            where: { id: userId },
            data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } },
          })
          crowned = true
        }
      })
      after(() => notifyZpChange(userId))
      // The crown is leaderboard ZP — name the board and the payout, not just "balance changed".
      if (crowned) {
        after(() => notifyLeaderboardPrize(userId, "Zross", 1, ALL_TIME_CROWN_ZP, "all-time"))
      }
      return summary
    }),

  /** Top-10 leaderboard, deduplicated to each user's single best run in scope.
   *  Only ENDED runs count (in-flight games shouldn't leak progress). */
  leaderboard: protectedProcedure
    .input(z.object({ scope: z.enum(["today", "all-time"]) }))
    .query(async ({ input }) => {
      const scopeWhere = input.scope === "today" ? { day: dayKey() } : {}
      const grouped = await db.zrossRun.groupBy({
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
