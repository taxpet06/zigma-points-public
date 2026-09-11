// MineZweeper tRPC router — the once-per-day Minesweeper board's ZP payout.
//
// Procedures:
//   getStatus — has the caller finished today's board? (drives the hub card + dedup)
//   claim     — verify the finished board server-side, award ZP, record it. Once/day.
//
// Security / correctness (mirrors wordle.ts):
//   - protectedProcedure gates auth; the acting user is always ctx.session.user.id
//   - ZP is DERIVED here by rebuilding the day's board from (day, first) and checking
//     the revealed set is exactly the non-mine set. The client never sends a score, a
//     win flag, or a ZP amount — the only thing it can lie about is which cells it
//     revealed, and lying there just fails verifySolve.
//   - a payload that doesn't verify is NOT an error. That's the normal lose path: the
//     player hit a mine, the client claims anyway, and the row is written with zp 0 so
//     the day is burnt. Throwing here would hand the client a way to skip the burn.
//   - the @@unique([userId, day]) row is the double-claim guard; a second claim (replay
//     after clearing localStorage, or a second device) hits P2002 → no extra ZP.

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { dayKey } from "@/lib/day-key"
import { CELLS, verifySolve } from "@/components/game-hub/minezweeper/board"
import { notifyZpChange } from "@/lib/notifications"
import { MINEZWEEPER_ZP } from "@/lib/game-economy"
import { Prisma } from "../../../prisma/generated/prisma/client"

export const minezweeperRouter = createTRPCRouter({
  /** Whether the caller has finished today's board, and how it went if so. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const existing = await db.minezweeperResult.findUnique({
      where: { userId_day: { userId: ctx.session.user.id, day: dayKey() } },
      select: { won: true, zp: true },
    })
    return { playedToday: existing !== null, result: existing }
  }),

  /**
   * Records a finished board and awards ZP. A full clear pays MINEZWEEPER_ZP; anything
   * else pays 0 and still burns the day. A second claim the same day throws CONFLICT.
   */
  claim: protectedProcedure
    .input(
      z
        .object({
          first: z.number().int().min(0).max(CELLS - 1),
          revealed: z.array(z.number().int().min(0).max(CELLS - 1)).max(CELLS),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const day = dayKey()
      const won = verifySolve(day, input.first, new Set(input.revealed))
      const zp = won ? MINEZWEEPER_ZP : 0

      try {
        await db.$transaction(async (tx) => {
          await tx.minezweeperResult.create({ data: { userId, day, won, zp } })
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
            message: "You've already played today's MineZweeper. Come back tomorrow!",
          })
        }
        throw e
      }

      if (zp > 0) after(() => notifyZpChange(userId))
      return { won, zp }
    }),
})
