// Mines router — casino.ts holds no game logic; each casino game gets its own router file
// (mirrors plinko.ts, flappy.ts, tetris.ts). Mines is the FIRST consumer of the multi-step
// machinery Phase 10 built and Phase 11 never touched: an ACTIVE row that lives across
// requests, casino.activeRound as the resume surface, sweepStale's auto-cash-out.
//
// Three rulings a future editor must not undo:
//
// 1. Mine positions are derived per request via deriveMines and NEVER persisted. casino.ts's
//    activeRound returns `state` and `config` verbatim to the browser (casino.ts:205), so a
//    mine array in either column is a one-query total leak of the round's answer. Deriving on
//    demand makes the safe-projection contract hold by construction — there is no field to
//    forget to redact.
// 2. Settlement from inside this router's own runSerializable transaction goes through
//    settleInTx(tx, ...) and never the single-shot settle helper Plinko uses — that helper
//    opens its own db.$transaction, and nesting that inside an already-open transaction
//    self-deadlocks on the row lock until Vercel's 10s function timeout kills the request
//    (12-RESEARCH.md Pitfall 4).
// 3. Every safe reveal writes `multiplier` in the SAME `data` object as `state.revealed`.
//    sweepStale (bet.ts) auto-cash-outs an abandoned round at the `multiplier` column; a
//    reveal that appends the tile but leaves that column stale pays the player nothing for
//    banked value on abandonment. Left null at k = 0 — never initialised to 1.0, which would
//    refund the stake on every abandoned never-played round.

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { db, runSerializable } from "@/lib/db"
import { openBet, settleInTx } from "@/lib/casino/bet"
import { payoutFor } from "@/lib/casino/limits"
import { deriveMines, minesMultiplier, MINES_MIN, MINES_MAX, MINES_TILES } from "@/lib/casino/mines"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"

export const minesRouter = createTRPCRouter({
  open: protectedProcedure
    .input(
      z
        .object({
          // Wager bounds enforced by assertWagerInLimits inside openBet — not restated here,
          // or the two schemas could drift.
          wager: z.number().int(),
          mines: z.number().int().min(MINES_MIN).max(MINES_MAX),
        })
        // .strict(): zod's default .object() silently STRIPS unknown keys. A client-sent
        // `tile`/`multiplier`/mine-position array must be structurally inexpressible.
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // One-active-round pre-check (bet.ts explicitly delegates this to multi-step games'
      // own router). CROSS-GAME as of Phase 15: this where now matches casino.activeRound's
      // exactly ({ userId, status: "ACTIVE" }, no game filter), making that query's documented
      // "single in-flight round" contract true by construction rather than by luck. Before this
      // fix, Mines and Chicken Cross (Phase 15's second multi-step game) could each hold their
      // own ACTIVE row at once — activeRound returns only the newest, so the older round's
      // adoption effect never fires and it silently disappears from every UI surface for 24h
      // until sweepStale pays it out. This is a deliberate cross-phase edit (15-RESEARCH.md
      // § The Cross-Game Active Round Bug): patching only the new game would leave this sibling
      // caller broken. src/private-games/chicken/router.ts's own pre-check must stay identical — no
      // game filter there either. Best-effort: the residual same-millisecond race is benign —
      // both rounds would be individually correct and settleable, and sweepStale eventually
      // cashes out whichever the UI abandons.
      const existing = await db.casinoBet.findFirst({
        where: { userId, status: "ACTIVE" },
        select: { id: true },
      })
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a round in progress." })
      }

      const { bet } = await openBet({
        userId,
        game: "MINES",
        wager: input.wager,
        config: { mines: input.mines },
      })

      // Multiplier stays null at k = 0 — never 1.0, or an abandoned never-played round would
      // refund the stake via sweepStale.
      await db.casinoBet.update({
        where: { id: bet.id },
        data: { state: { revealed: [] } },
      })

      // Explicit object literal — never a spread of openBet's result, which carries the live
      // serverSeed.
      return {
        betId: bet.id,
        mineCount: input.mines,
        revealed: [] as number[],
        multiplier: null as number | null,
        nextMultiplier: minesMultiplier(input.mines, 1),
      }
    }),

  reveal: protectedProcedure
    .input(z.object({ betId: z.string(), tile: z.number().int().min(0).max(MINES_TILES - 1) }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      return runSerializable(async (tx) => {
        // userId in this where is the IDOR control — a stolen betId alone reveals and
        // settles nothing.
        const row = await tx.casinoBet.findFirst({
          where: { id: input.betId, userId, game: "MINES", status: "ACTIVE" },
          include: { seed: true },
        })
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No active round found." })

        const mineCount = (row.config as { mines: number }).mines
        const revealed: number[] = (row.state as { revealed: number[] } | null)?.revealed ?? []

        // Server-local const, referenced only by the membership check below and by
        // end-of-round responses. Never written to a column, never placed in a safe-path
        // response.
        const mines = await deriveMines(row.seed, mineCount)

        // (1) Double-tap guard — falls out of set semantics, needs no request id.
        if (revealed.includes(input.tile)) {
          const k = revealed.length
          return {
            betId: row.id,
            tile: input.tile,
            safe: true,
            settled: false,
            revealed,
            k,
            multiplier: k > 0 ? minesMultiplier(mineCount, k) : null,
            nextMultiplier: k < MINES_TILES - mineCount ? minesMultiplier(mineCount, k + 1) : null,
            payout: k > 0 ? payoutFor(row.wager, minesMultiplier(mineCount, k)) : 0,
          }
        }

        // (2) Bust — the round is over, so the mine set is no longer a secret.
        if (mines.includes(input.tile)) {
          const outcome = { revealed, hit: input.tile, mines }
          const settled = await settleInTx(tx, {
            betId: row.id,
            userId,
            wager: row.wager,
            multiplier: 0,
            outcome,
          })
          return {
            betId: row.id,
            tile: input.tile,
            safe: false,
            settled: true,
            revealed,
            mines,
            k: revealed.length,
            multiplier: 0,
            nextMultiplier: null,
            payout: settled.payout,
          }
        }

        const nextRevealed = [...revealed, input.tile]
        const k = nextRevealed.length

        // (3) Safe, and the last gem — auto-cash-out at the max multiplier.
        if (k === MINES_TILES - mineCount) {
          const multiplier = minesMultiplier(mineCount, k)
          const outcome = { revealed: nextRevealed, cleared: true, mines }
          const settled = await settleInTx(tx, { betId: row.id, userId, wager: row.wager, multiplier, outcome })
          return {
            betId: row.id,
            tile: input.tile,
            safe: true,
            settled: true,
            revealed: nextRevealed,
            mines,
            k,
            multiplier,
            nextMultiplier: null,
            payout: settled.payout,
          }
        }

        // (4) Safe otherwise — a single updateMany. `status: "ACTIVE"` in the where is the
        // cash-out race guard: a concurrent cash-out or bust that already settled this row
        // makes this update match zero rows.
        const multiplier = minesMultiplier(mineCount, k)
        const { count } = await tx.casinoBet.updateMany({
          where: { id: row.id, userId, status: "ACTIVE" },
          data: {
            state: { revealed: nextRevealed },
            multiplier, // sweepStale's auto-cash-out reads this column — same statement, always.
          },
        })

        if (count === 0) {
          // A concurrent cash-out or bust already settled the round — read back and return
          // the settled outcome rather than throwing.
          const stored = await tx.casinoBet.findUnique({ where: { id: row.id } })
          const storedState = stored?.state as { revealed?: number[] } | null
          return {
            betId: row.id,
            tile: input.tile,
            safe: true,
            settled: true,
            revealed: storedState?.revealed ?? nextRevealed,
            mines,
            k: storedState?.revealed?.length ?? k,
            multiplier: stored?.multiplier ?? 0,
            nextMultiplier: null,
            payout: stored?.payout ?? 0,
          }
        }

        return {
          betId: row.id,
          tile: input.tile,
          safe: true,
          settled: false,
          revealed: nextRevealed,
          k,
          multiplier,
          nextMultiplier: minesMultiplier(mineCount, k + 1),
          payout: payoutFor(row.wager, multiplier),
        }
      })
    }),

  cashout: protectedProcedure
    .input(z.object({ betId: z.string() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      return runSerializable(async (tx) => {
        const row = await tx.casinoBet.findFirst({
          where: { id: input.betId, userId, game: "MINES", status: "ACTIVE" },
          include: { seed: true },
        })
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No active round found." })

        const revealed: number[] = (row.state as { revealed: number[] } | null)?.revealed ?? []
        if (revealed.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a tile before cashing out." })
        }

        const mineCount = (row.config as { mines: number }).mines
        const mines = await deriveMines(row.seed, mineCount)

        // Settle at the row's STORED multiplier column value — never a recomputed one and
        // never a client-supplied one.
        const settled = await settleInTx(tx, {
          betId: row.id,
          userId,
          wager: row.wager,
          multiplier: row.multiplier ?? 0,
          outcome: { revealed, cashedOut: true, mines },
        })

        return {
          betId: row.id,
          revealed,
          mines,
          multiplier: settled.multiplier,
          payout: settled.payout,
        }
      })
    }),
})
