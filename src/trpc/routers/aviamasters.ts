// Aviamasters router — the ENTIRE point of this file is that `play` opens the bet, derives the
// round, and settles it in ONE request. `sweepStale` (bet.ts) auto-cash-outs a stale ACTIVE row
// at `multiplier ?? 0`, and Aviamasters' flight is up to 6.7s of pure spectation — a
// backgrounded tab mid-flight is likely, not exotic, more so than any other single-shot game in
// this repo. There must NEVER be an `aviamasters.settle` procedure — asserted structurally by
// aviamastersRouter exposing exactly one key.
//
// `seed.serverSeed` (from openBet) is a LIVE SECRET — used below to call deriveAviamasters and
// never returned. The response is an explicit object literal, never a spread of openBet's
// result, which carries that secret.
//
// `casino.activeRound` is irrelevant to Aviamasters: a single-shot game has nothing to resume.
//
// `config: {}` is deliberate, not an oversight: Aviamasters is the first and only game with no
// pre-round configuration at all — no risk, no difficulty, no segments, no target (BGaming,
// OFFICIAL). It is also why the verifier needs no `parseAviaConfig` helper.
//
// `.strict()` is why a client-sent `speed`/`autoplay` is REJECTED rather than silently stripped:
// both are cosmetic and must be structurally inexpressible server-side (AVIA-04).

import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { openBet, settleBet } from "@/lib/casino/bet"
import { deriveAviamasters } from "@/lib/casino/aviamasters"
import { MAX_PAYOUT } from "@/lib/casino/limits"

export const aviamastersRouter = createTRPCRouter({
  play: protectedProcedure
    // Bounds enforced by assertWagerInLimits inside openBet — not restated here.
    .input(z.object({ wager: z.number().int() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // config is {} — Aviamasters is the one game with NO pre-round configuration at all.
      const { bet, seed } = await openBet({
        userId,
        game: "AVIAMASTERS",
        wager: input.wager,
        config: {},
      })

      // seed.serverSeed is a live secret, used here only — never forwarded to the client.
      const { steps, landed, multiplier } = await deriveAviamasters(seed)

      const { payout } = await settleBet({
        betId: bet.id,
        userId,
        wager: input.wager,
        multiplier,
        outcome: { steps, landed },
      })

      // Explicit object literal — never a spread of openBet's result, which carries the live
      // serverSeed. `capped` matters here because 250 x MAX_BET(1,000) = 250,000 > MAX_PAYOUT
      // (100,000): a x250 is only payable in full at stakes at or below 400 ZP. Disclose, per the
      // Phase 11 Plinko precedent — do not remove the multiplier and do not raise the cap.
      return {
        betId: bet.id,
        steps,
        landed,
        multiplier,
        payout,
        capped: payout === MAX_PAYOUT && Math.floor(input.wager * multiplier) > MAX_PAYOUT,
      }
    }),
})
