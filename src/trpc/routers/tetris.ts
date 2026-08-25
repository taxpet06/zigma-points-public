// Tetris (code slug `tetris`, display name "Petris") router — server-authoritative
// scoring via deterministic replay. Mirrors flappy.ts's shape (getStatus/start/end/
// leaderboard, the $transaction daily-cap + stale-sweep, seed issue, ZP increment, crown
// bonus) with one structural difference: there is no per-edible `eat` procedure. The
// client submits ONE input log at `end`, the server replays it against the seed issued
// by `start`, and trusts only the replay's output — the client never sends a score.

import { TRPCError } from "@trpc/server"
import { randomInt } from "crypto"
import { after } from "next/server"
import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import { dayKey } from "@/lib/day-key"
import { notifyZpChange, notifyLeaderboardPrize } from "@/lib/notifications"
import { replay, MAX_INPUT_LOG_LENGTH } from "@/lib/tetris/replay"
import { claimsAllTimeCrown } from "@/lib/daily-prizes"
import {
  FREE_PLAYS_PER_DAY,
  REPLAY_COST,
  ALL_TIME_CROWN_ZP,
  SWEEP_ACTIVE_AFTER_MS,
  TICK_MS,
  REPLAY_TICK_TOLERANCE,
  REPLAY_TICK_GRACE_TICKS,
} from "@/lib/tetris/constants"
import { PLAYED_TETRIS_RUN_WHERE } from "@/lib/game-economy"

export const tetrisRouter = createTRPCRouter({
  /** Drives the hub card: free runs left today, what a replay costs, and whether the
   *  user can start one right now (free run left, or enough ZP to buy a replay). */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = dayKey()
    const [runsToday, me] = await Promise.all([
      db.tetrisRun.count({ where: { userId, day, ...PLAYED_TETRIS_RUN_WHERE } }),
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
   *  after it debits REPLAY_COST and banks none (leaderboard-only). The client fires
   *  this on Start, not on modal open, so opening the dialog never costs anything. */
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const day = dayKey()

    // Serializable + retry: the count-then-insert free-run check below is only
    // race-safe under Serializable — concurrent start()s can't all read runsToday=0
    // and all get a free run (review CR-01). See runSerializable in @/lib/db.
    const created = await runSerializable(async (tx) => {
      // 1. Sweep this user's stale ACTIVE rows.
      await tx.tetrisRun.updateMany({
        where: {
          userId,
          status: "ACTIVE",
          startedAt: { lt: new Date(Date.now() - SWEEP_ACTIVE_AFTER_MS) },
        },
        data: { status: "ABANDONED", endedAt: new Date() },
      })

      // 2. Free run, or a paid replay? Past the free allowance the ZP is debited here —
      // conditional updateMany, so the balance check and the debit can't be separated.
      const runsToday = await tx.tetrisRun.count({ where: { userId, day, ...PLAYED_TETRIS_RUN_WHERE } })
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

      // 3. Insert the run with a fresh seed. Postgres INTEGER is signed 32-bit
      // (max 2^31 - 1); mulberry32 accepts any non-negative 32-bit int.
      const seed = randomInt(0, 2 ** 31)
      const row = await tx.tetrisRun.create({
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

  /** Client submits the whole run's input log. The server is the sole scoring
   *  authority: it replays (seed, inputLog) and trusts ONLY that output — the
   *  input schema has no score/lines field at all. Idempotent: replay is a pure
   *  function of (seed, inputLog), so resubmitting the same log after the run
   *  already ended recomputes the identical summary; the CAS below just gates
   *  the one-time ZP credit + crown check so a resend never double-pays. */
  end: protectedProcedure
    .input(
      z.object({
        runId: z.string(),
        inputLog: z
          .array(
            z.object({
              tick: z.number().int().min(0),
              action: z.enum(["left", "right", "rotate", "soft", "hard", "hold"]),
            }),
          )
          .max(MAX_INPUT_LOG_LENGTH), // router-side cap mirrors replay's own — reject oversized payloads before touching the sim
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const run = await db.tetrisRun.findUnique({
        where: { id: input.runId },
        select: { id: true, userId: true, seed: true, startedAt: true, entryCost: true },
      })
      if (!run || run.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Run not found." })
      }

      // Plausibility bound: the log's last tick can't imply more elapsed time than
      // wall-clock allows for, with headroom for jitter (see constants.ts).
      const elapsedMs = Date.now() - run.startedAt.getTime()
      const maxTicks = Math.ceil((elapsedMs / TICK_MS) * REPLAY_TICK_TOLERANCE) + REPLAY_TICK_GRACE_TICKS
      const result = replay(run.seed, input.inputLog, { maxTicks })
      if (!result.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid input log." })
      }

      // Paid replays bank no ZP — they're leaderboard-only. The daily podium and the
      // all-time crown still pay on them; that's the whole point of buying a run.
      const isPaidReplay = run.entryCost > 0
      const zpWon = isPaidReplay ? 0 : result.linesCleared
      const summary = { score: result.score, linesCleared: result.linesCleared, zpWon, isPaidReplay }

      // Idempotent ACTIVE->ENDED compare-and-set: concurrent/resent end() calls
      // can't both flip the row, so the ZP credit + crown fire at most once.
      // ponytail: REPLAY_COST is what bounds overtake-farming now — the crown pays
      // ALL_TIME_CROWN_ZP but you have to keep buying runs to chase it.
      let credited = false
      let crowned = false
      await db.$transaction(async (tx) => {
        const { count } = await tx.tetrisRun.updateMany({
          where: { id: run.id, status: { not: "ENDED" } },
          data: {
            status: "ENDED",
            endedAt: new Date(),
            score: result.score,
            linesCleared: result.linesCleared,
            zpEarned: zpWon,
          },
        })
        if (count === 0) return // lost the race, or already ended — no re-credit
        credited = true

        if (zpWon > 0) {
          await tx.user.update({ where: { id: userId }, data: { zigmaPoints: { increment: zpWon } } })
        }
        if (result.score <= 0) return

        // Crown check ranks by SCORE (leaderboard metric), not zpEarned.
        const others = await tx.tetrisRun.aggregate({
          _max: { score: true },
          where: { status: "ENDED", score: { gt: 0 }, userId: { not: userId } },
        })
        const mine = await tx.tetrisRun.aggregate({
          _max: { score: true },
          where: { status: "ENDED", score: { gt: 0 }, userId, id: { not: run.id } },
        })
        if (claimsAllTimeCrown(result.score, others._max.score ?? -1, mine._max.score ?? -1)) {
          await tx.user.update({ where: { id: userId }, data: { zigmaPoints: { increment: ALL_TIME_CROWN_ZP } } })
          crowned = true
        }
      })
      if (credited) after(() => notifyZpChange(userId))
      // The crown is leaderboard ZP — say which board and what it paid, not just
      // "your balance changed". Only fires on the transaction that actually credited it.
      if (crowned) {
        after(() => notifyLeaderboardPrize(userId, "Petris", 1, ALL_TIME_CROWN_ZP, "all-time"))
      }
      return summary
    }),

  /** Top-10 leaderboard, deduplicated to each user's single best run in scope.
   *  Only ENDED runs count. Ranked by score (leaderboard points), not zpEarned. */
  leaderboard: protectedProcedure
    .input(z.object({ scope: z.enum(["today", "all-time"]) }))
    .query(async ({ input }) => {
      const scopeWhere = input.scope === "today" ? { day: dayKey() } : {}
      const grouped = await db.tetrisRun.groupBy({
        by: ["userId"],
        where: { status: "ENDED", ...scopeWhere },
        _max: { score: true },
        orderBy: { _max: { score: "desc" } },
        take: 10,
      })
      const scored = grouped.filter((g) => (g._max.score ?? 0) > 0)
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
          score: g._max.score ?? 0,
        }
      })
    }),
})
