// Term tRPC router.
//
// getCurrent is the only read every signed-in user makes (the header countdown).
// Everything else is admin-only via adminProcedure (DB-role checked, not session-role).

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { createTermSchema, updateTermSchema } from "@/lib/validation/term"

// Clear-all then set-one. Run inside a $transaction so the app is never briefly
// crownless-or-double-crowned. ponytail: two statements beat a settings table.
const crownWrites = (userId: string) => [
  db.user.updateMany({ where: { hasCrown: true, NOT: { id: userId } }, data: { hasCrown: false } }),
  db.user.update({ where: { id: userId }, data: { hasCrown: true } }),
]

export const termRouter = createTRPCRouter({
  /**
   * The current term: the most recent term that has already started. Returns null
   * before the first term begins. A term whose endsAt has passed is still returned —
   * the client renders "Term Ended" for it, which is the point.
   */
  getCurrent: protectedProcedure.query(() =>
    db.term.findFirst({
      where: { startsAt: { lte: new Date() } },
      orderBy: { startsAt: "desc" },
      select: { id: true, name: true, startsAt: true, endsAt: true },
    }),
  ),

  list: adminProcedure.query(() =>
    db.term.findMany({
      orderBy: { startsAt: "desc" },
      include: { winner: { select: { id: true, name: true, username: true } } },
    }),
  ),

  /**
   * Who currently wears the crown, or null. One tiny query the whole app shares —
   * UserAvatar compares ids against it, which is why no other endpoint has to grow a
   * hasCrown field (there are ~25 user selects; there is one crown).
   */
  crownHolder: protectedProcedure.query(() =>
    db.user.findFirst({ where: { hasCrown: true }, select: { id: true, name: true } }),
  ),

  /**
   * Declare (or clear) a term's Zigma Maxxer. Declaring one always hands them the
   * crown — setCrown is right next to it in the admin UI for the rare override.
   */
  setWinner: adminProcedure
    .input(z.object({ termId: z.string().min(1), userId: z.string().min(1).nullable() }))
    .mutation(async ({ input }) => {
      const term = await db.term.findUnique({ where: { id: input.termId }, select: { id: true } })
      if (!term) throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." })
      if (input.userId) {
        const winner = await db.user.findUnique({ where: { id: input.userId }, select: { id: true } })
        if (!winner) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." })
      }
      await db.$transaction([
        db.term.update({ where: { id: input.termId }, data: { winnerId: input.userId } }),
        ...(input.userId ? crownWrites(input.userId) : []),
      ])
      return { winnerId: input.userId }
    }),

  /** Move the crown to a user, or take it off everyone (null). */
  setCrown: adminProcedure
    .input(z.object({ userId: z.string().min(1).nullable() }))
    .mutation(async ({ input }) => {
      if (input.userId) {
        const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true } })
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." })
      }
      await db.$transaction(
        input.userId
          ? crownWrites(input.userId)
          : [db.user.updateMany({ where: { hasCrown: true }, data: { hasCrown: false } })],
      )
      return { userId: input.userId }
    }),

  create: adminProcedure.input(createTermSchema).mutation(({ input }) =>
    db.term.create({ data: input, select: { id: true } }),
  ),

  update: adminProcedure.input(updateTermSchema).mutation(async ({ input }) => {
    const { id, ...data } = input
    const target = await db.term.findUnique({ where: { id }, select: { id: true } })
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." })
    return db.term.update({ where: { id }, data, select: { id: true } })
  }),

  remove: adminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    const target = await db.term.findUnique({ where: { id: input.id }, select: { id: true } })
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." })
    await db.term.delete({ where: { id: input.id } })
    return { removed: true }
  }),
})
