// Dice router — casino.ts deliberately holds no game logic; each casino game gets its own
// router file, mirroring how plinko.ts and mines.ts already coexist.
//
// The ENTIRE point of this file is that `play` opens the bet, derives the outcome, and settles
// it in ONE request. `sweepStale` (bet.ts) auto-cash-outs a stale ACTIVE row at
// `multiplier ?? 0` — correct for Mines/Chicken where that column holds a safely-banked
// multiplier, but for a single-shot game an ACTIVE row's multiplier is always null. A
// client-triggered settle would let a browser crash between "the roll happened" and "tell the
// server" turn a 9900x win into a total loss. There must NEVER be a `dice.settle` procedure —
// asserted structurally by `diceRouter` exposing exactly one key.
//
// `seed.serverSeed` (from openBet) is a LIVE SECRET — used below to call deriveDice and never
// returned. The response is an explicit object literal, never a spread of openBet's result, so
// a future field added to that result can't leak here by accident.
//
// `casino.activeRound` is irrelevant to Dice: a single-shot game has nothing to resume, and
// the UI must ignore it entirely — there is no "resumed" phase for a roll that already landed.

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { openBet, settleBet } from "@/lib/casino/bet"
import { deriveDice, chanceHFor, CHANCE_H_MIN, CHANCE_H_MAX, DICE_MODES } from "@/lib/casino/dice"

export const diceRouter = createTRPCRouter({
  play: protectedProcedure
    .input(
      z
        .object({
          // Bounds enforced by assertWagerInLimits inside openBet — not restated here, so the
          // two can never drift apart.
          wager: z.number().int(),
          targetH: z.number().int().min(1).max(9999),
          mode: z.enum(DICE_MODES),
        })
        // .strict(): zod's default .object() silently STRIPS unknown keys rather than
        // rejecting them. A client-sent `roll`/`win`/`multiplier` must be structurally
        // inexpressible, not merely ignored — .strict() is what makes that a rejection.
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // The per-mode chance bound is the server's whole validation, checked BEFORE openBet so
      // a malformed target never debits.
      const chanceH = chanceHFor(input.targetH, input.mode)
      if (chanceH < CHANCE_H_MIN || chanceH > CHANCE_H_MAX) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Win chance must be between 0.01% and 98%." })
      }

      // config is captured before any float is read, so the player can never pick a
      // favourable target after seeing the outcome.
      const { bet, seed } = await openBet({
        userId,
        game: "DICE",
        wager: input.wager,
        config: { targetH: input.targetH, mode: input.mode },
      })

      // seed.serverSeed is a live secret, used here only — never forwarded to the client.
      const { rollH, roll, win, multiplier } = await deriveDice(seed, input.targetH, input.mode)

      const { payout } = await settleBet({
        betId: bet.id,
        userId,
        wager: input.wager,
        // Loss settles at 0 — mines.ts precedent, makes CasinoShell's 0.00x secondary line
        // correct.
        multiplier: win ? multiplier : 0,
        // The outcome goes in the bet's `state` at settle; `config` stays the bet, never the
        // outcome.
        outcome: { rollH, win, multiplier },
      })

      // Explicit object literal — never a spread of openBet's result, which carries the live
      // serverSeed. No targetH/mode echo: the client already holds them.
      return { betId: bet.id, roll, win, multiplier: win ? multiplier : 0, payout }
    }),
})
