// Wordle tRPC router — the once-per-day word game's ZP payout.
//
// Procedures:
//   getStatus — has the caller finished today's Wordle? (drives the hub card + dedup)
//   claim     — validate the finished game server-side, award ZP, record it. Once/day.
//
// Security / correctness (mirrors dailyReward.ts):
//   - protectedProcedure gates auth; the acting user is always ctx.session.user.id
//   - ZP is DERIVED on the server from the submitted guesses, never taken from the
//     client. A faked "solved in 1" is rejected: every guess must be a real word and
//     only the final guess may equal today's answer. This isn't unbreakable (the word
//     list is public and deterministic), but it stops the trivial cheats.
//   - the WordleResult @@unique([userId, day]) row is the double-claim guard; a second
//     claim (replay after clearing localStorage, two devices) hits P2002 → no extra ZP.

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { dayKey } from "@/lib/day-key"
import { answerForDay, WORD_SET } from "@/components/game-hub/words"
import { notifyZpChange } from "@/lib/notifications"
import { WORDLE_ZP_BY_TRIES } from "@/lib/game-economy"
import { Prisma } from "../../../prisma/generated/prisma/client"

const MAX_TRIES = 6

export const wordleRouter = createTRPCRouter({
  /** Whether the caller has finished today's game, and how it went if so. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const existing = await db.wordleResult.findUnique({
      where: { userId_day: { userId: ctx.session.user.id, day: dayKey() } },
      select: { won: true, tries: true, zp: true },
    })
    return { playedToday: existing !== null, result: existing }
  }),

  /**
   * Records a finished game, awards ZP, and returns the outcome. ZP by speed:
   * 1st-try win = 15, 2nd = 10, 3rd = 8, 4th = 6, 5th = 4, 6th = 2; a loss = 0. A second claim the
   * same day throws CONFLICT (unique-constraint guard) so ZP can't be farmed by replaying.
   */
  claim: protectedProcedure
    .input(z.object({ guesses: z.array(z.string().length(5)).min(1).max(MAX_TRIES) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const day = dayKey()
      const answer = answerForDay()
      const guesses = input.guesses.map((g) => g.toLowerCase())

      if (guesses.some((g) => !WORD_SET.has(g))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Guess isn't a valid word." })
      }
      const solvedAt = guesses.indexOf(answer)
      const won = solvedAt === guesses.length - 1
      // A win must be the LAST guess (no playing on past the answer), and a non-win must
      // be a real loss — all six tries used, answer never found.
      if (solvedAt !== -1 && !won) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Guesses continue past the answer." })
      }
      if (!won && guesses.length < MAX_TRIES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Game isn't finished." })
      }
      const zp = won ? WORDLE_ZP_BY_TRIES[guesses.length - 1] : 0

      try {
        await db.$transaction(async (tx) => {
          await tx.wordleResult.create({ data: { userId, day, won, tries: guesses.length, zp } })
          if (zp > 0) {
            await tx.user.update({
              where: { id: userId },
              data: { zigmaPoints: { increment: zp } },
            })
          }
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You've already played today's Wordle. Come back tomorrow!",
          })
        }
        throw e
      }

      if (zp > 0) after(() => notifyZpChange(userId))
      return { won, zp, tries: guesses.length, answer }
    }),
})
