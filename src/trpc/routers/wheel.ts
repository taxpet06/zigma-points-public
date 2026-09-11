// Wheel router — the ENTIRE point of this file is that `play` opens the bet, derives the
// segment, and settles it in ONE request. `sweepStale` (bet.ts) auto-cash-outs a stale ACTIVE
// row at `multiplier ?? 0` — for a single-shot game an ACTIVE row's multiplier is always null,
// so a client-triggered settle would let a browser crash between "the wheel landed" and "tell
// the server" turn a 49.5x win into a total loss. There must NEVER be a `wheel.settle`
// procedure — asserted structurally by wheelRouter exposing exactly one key.
//
// `seed.serverSeed` (from openBet) is a LIVE SECRET — used below to call deriveWheel and never
// returned. The response is an explicit object literal, never a spread of openBet's result.
//
// `casino.activeRound` is irrelevant to Wheel: a single-shot game has nothing to resume.
//
// No `win ? multiplier : 0` branch (unlike Dice) — a 0x segment IS the table value, so the
// settled multiplier is always the table multiplier. No `capped` computation either: the
// largest wheel multiplier is 49.5x and MAX_BET is 1,000, so 1,000 * 49.5 = 49,500 < MAX_PAYOUT
// 100,000 — the cap cannot bind on Wheel at any legal wager.

import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { openBet, settleBet } from "@/lib/casino/bet"
import { WHEEL_RISKS, WHEEL_SEGMENTS, deriveWheel } from "@/lib/casino/wheel"

export const wheelRouter = createTRPCRouter({
  play: protectedProcedure
    .input(
      z
        .object({
          // Bounds enforced by assertWagerInLimits inside openBet — not restated here.
          wager: z.number().int(),
          segments: z
            .number()
            .int()
            .refine((n): n is (typeof WHEEL_SEGMENTS)[number] =>
              (WHEEL_SEGMENTS as readonly number[]).includes(n),
            ),
          risk: z.enum(WHEEL_RISKS),
        })
        // .strict(): zod's default .object() silently STRIPS unknown keys rather than
        // rejecting them. A client-sent `index`/`multiplier` must be structurally
        // inexpressible, not merely ignored.
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // config is captured before any float is read, so the player can never pick a
      // configuration after seeing the outcome.
      const { bet, seed } = await openBet({
        userId,
        game: "WHEEL",
        wager: input.wager,
        config: { segments: input.segments, risk: input.risk },
      })

      // seed.serverSeed is a live secret, used here only — never forwarded to the client.
      const { index, multiplier } = await deriveWheel(seed, input.segments, input.risk)

      const { payout } = await settleBet({
        betId: bet.id,
        userId,
        wager: input.wager,
        multiplier,
        outcome: { index, multiplier },
      })

      // Explicit object literal — never a spread of openBet's result, which carries the live
      // serverSeed.
      return { betId: bet.id, index, multiplier, payout }
    }),
})
