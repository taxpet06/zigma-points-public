// Plinko router — casino.ts deliberately holds no game logic; each casino game gets its own
// router file, mirroring how flappy.ts and tetris.ts already coexist.
//
// The ENTIRE point of this file is that `play` opens the bet, derives the outcome, and settles
// it in ONE request. `sweepStale` (bet.ts) auto-cash-outs a stale ACTIVE row at
// `multiplier ?? 0` — correct for Mines/Chicken where that column holds a safely-banked
// multiplier, but for a single-shot game an ACTIVE row's multiplier is always null. A
// client-triggered settle would let a browser crash between "the ball landed" and "tell the
// server" turn a 1000x win into a total loss. There must NEVER be a `plinko.settle` procedure —
// asserted structurally by `plinkoRouter` exposing exactly one key.
//
// `seed.serverSeed` (from openBet) is a LIVE SECRET — used below to call derivePlinko and never
// returned. The response is an explicit object literal, never a spread of openBet's result,
// so a future field added to that result can't leak here by accident.
//
// `casino.activeRound` is irrelevant to Plinko: a single-shot game has nothing to resume, and
// the UI must ignore it entirely — there is no "resumed" phase for a ball that already landed.

import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { openBet, settleBet } from "@/lib/casino/bet"
import { derivePlinko, PLINKO_RISKS } from "@/lib/casino/plinko"

export const plinkoRouter = createTRPCRouter({
  play: protectedProcedure
    .input(
      z
        .object({
          // Bounds enforced by assertWagerInLimits inside openBet — not restated here, so the
          // two can never drift apart.
          wager: z.number().int(),
          rows: z.number().int().min(8).max(16),
          // No "RAIN" tier — the enum IS the guard (11-CONTEXT.md, locked).
          risk: z.enum(PLINKO_RISKS),
        })
        // .strict(): zod's default .object() silently STRIPS unknown keys rather than
        // rejecting them. A client-sent `bucket`/`multiplier`/`path` must be structurally
        // inexpressible, not merely ignored — .strict() is what makes that a rejection.
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // config is captured before any float is read, so the player can never pick a
      // favourable table after seeing the outcome.
      const { bet, seed } = await openBet({
        userId,
        game: "PLINKO",
        wager: input.wager,
        config: { rows: input.rows, risk: input.risk },
      })

      // seed.serverSeed is a live secret, used here only — never forwarded to the client.
      const { path, bucket, multiplier } = await derivePlinko(seed, input.rows, input.risk)

      const { payout } = await settleBet({
        betId: bet.id,
        userId,
        wager: input.wager,
        multiplier,
        // The outcome goes in the bet's `state` at settle; `config` stays the bet, never
        // the outcome.
        outcome: { path, bucket, multiplier },
      })

      // Explicit object literal — never a spread of openBet's result, which carries the
      // live serverSeed.
      return { betId: bet.id, bucket, path, multiplier, payout }
    }),
})
