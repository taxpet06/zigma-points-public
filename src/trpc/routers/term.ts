// Term tRPC router.
//
// getCurrent is the only read every signed-in user makes (the header countdown).
// Everything else is admin-only via adminProcedure (DB-role checked, not session-role).

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { createTermSchema, updateTermSchema } from "@/lib/validation/term"
import { currentTerm, latestStartedTerm, poopHolderIds } from "@/lib/terms"
import { scoreTerm } from "@/lib/scoring-run"

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
  // latestStartedTerm, NOT currentTerm: this drives the header countdown, and between
  // terms currentTerm() has already moved to the next one — which would render a live
  // countdown for a term that has not begun. The header should say "26X — Term Ended".
  getCurrent: protectedProcedure.query(() => latestStartedTerm()),

  /**
   * Every term that has already started, newest first, plus which one is current —
   * the payload behind <TermSelect>. Unstarted terms are withheld: an admin can queue
   * next term's window months ahead, and a dropdown that offers an empty future board
   * (or a lootbox nobody can open yet) is a leak, not a feature.
   *
   * protectedProcedure, not adminProcedure: `list` above is the admin panel's read
   * (it joins the winner); this one is the whole app's, and returns nothing a user
   * can't already see in the header countdown.
   */
  listStarted: protectedProcedure.query(async () => {
    // buyableTermId is currentTerm()'s id — the SAME value shop.openBox gates on, handed
    // to the client so the shop cannot disagree with the server about what it will
    // allow. Between terms it is the next term (which is absent from the list below), so
    // it matches nothing and the whole shop reads as browse-only, which is correct.
    // Deriving it client-side from currentTermId got this wrong: that is the latest
    // STARTED term, so during a break the shop offered live Open buttons on last term's
    // boxes and every click failed with FORBIDDEN.
    const buyable = await currentTerm()
    const terms = await db.term.findMany({
      where: { startsAt: { lte: new Date() } },
      orderBy: { startsAt: "desc" },
      select: { id: true, name: true, startsAt: true, endsAt: true },
    })
    // Current = the most recent started term, i.e. the first row of this ordering. That
    // is latestStartedTerm's rule, not currentTerm's: between terms the two diverge on
    // purpose (see lib/terms.ts), and the picker must offer a term you can actually look
    // at rather than an unstarted one that is absent from this very list.
    return { terms, currentTermId: terms[0]?.id ?? null, buyableTermId: buyable?.id ?? null }
  }),

  list: adminProcedure.query(() =>
    db.term.findMany({
      orderBy: { startsAt: "desc" },
      include: { winner: { select: { id: true, name: true, username: true } } },
    }),
  ),

  /**
   * A term's Podium: every scored user in rank order, rank 1 being that term's Zigma
   * Maxxer. Empty until the settle cron scores the term, which it does on its first
   * tick after endsAt — so the CURRENT term always renders the empty state, on purpose.
   *
   * Rank, name and total only. The per-pillar breakdown is admin-only (podiumDetail):
   * those columns expose each member's gambling volume, ZP and posting record to the
   * whole club, which is a different decision from publishing a leaderboard.
   */
  podium: protectedProcedure
    .input(z.object({ termId: z.string().min(1).nullish() }))
    .query(async ({ input }) => {
      // latestStartedTerm: between terms currentTerm() is the NEXT term, which has no
      // board, so defaulting to it would blank the podium the instant a term ended.
      const termId = input.termId ?? (await latestStartedTerm())?.id
      if (!termId) return { termId: null, rows: [] }

      // A term that has not ended publishes NOTHING, whatever rows exist.
      //
      // The cron only scores ended terms, but runScoring lets an admin preview a running
      // one, and that preview writes real term_scores rows. Without this guard a single
      // click on "Run scoring" at 5pm would publish the whole standings to every member
      // before the term closed — with hours left to play, which is exactly the
      // information nobody should have. The admin board (podiumDetail) is unguarded on
      // purpose: previewing is its job.
      const term = await db.term.findUnique({ where: { id: termId }, select: { endsAt: true } })
      if (!term || term.endsAt > new Date()) return { termId, rows: [] }

      const [rows, poopers] = await Promise.all([
        db.termScore.findMany({
          where: { termId },
          orderBy: { rank: "asc" },
          select: {
            rank: true,
            total: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
                // equippedRing only — the Podium deliberately shows no title chip, so
                // selecting equippedTitle would ship a field nothing renders.
                equippedRing: true,
              },
            },
          },
        }),
        db.termPooper.findMany({ where: { termId }, select: { userId: true } }),
      ])
      const dq = new Set(poopers.map((p) => p.userId))
      // Disqualified users keep their rank and stay on the board — the Podium greys
      // them out rather than hiding them.
      return { termId, rows: rows.map((r) => ({ ...r, isDisqualified: dq.has(r.user.id) })) }
    }),

  /** The same board with every pillar subtotal and both tiebreak inputs — what makes a
   *  placing contestable. Admin-only; see podium above for why. */
  podiumDetail: adminProcedure
    .input(z.object({ termId: z.string().min(1).nullish() }))
    .query(async ({ input }) => {
      const termId = input.termId ?? (await latestStartedTerm())?.id
      if (!termId) return { termId: null, rows: [] }

      const [rows, poopers] = await Promise.all([
        db.termScore.findMany({
          where: { termId },
          orderBy: { rank: "asc" },
          include: { user: { select: { id: true, name: true, username: true, role: true } } },
        }),
        db.termPooper.findMany({ where: { termId }, select: { userId: true } }),
      ])
      const dq = new Set(poopers.map((p) => p.userId))
      return { termId, rows: rows.map((r) => ({ ...r, isDisqualified: dq.has(r.user.id) })) }
    }),

  /**
   * Score (or re-score) a term on demand. The cron scores each ended term exactly once
   * on its own; this is the override for re-running after a correction.
   *
   * Deliberately allowed on a term that has NOT ended yet — an admin asking for a
   * mid-term standings preview is a reasonable thing to want, and the cron will not
   * re-score it afterwards because rows now exist. Re-run it after the term closes to
   * get the real board. scoreTerm replaces the whole board atomically either way.
   */
  runScoring: adminProcedure
    .input(z.object({ termId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const term = await db.term.findUnique({ where: { id: input.termId }, select: { id: true } })
      if (!term) throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." })
      return scoreTerm(input.termId)
    }),

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
        // A Zigma Pooper can never be that term's Maxxer. Enforced here as well as in
        // scoring's winnerOf(), so the rule holds on the manual path too.
        const pooped = await db.termPooper.findUnique({
          where: { termId_userId: { termId: input.termId, userId: input.userId } },
          select: { id: true },
        })
        if (pooped) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That user is a Zigma Pooper for this term and cannot be the Maxxer.",
          })
        }
      }
      await db.$transaction([
        db.term.update({ where: { id: input.termId }, data: { winnerId: input.userId } }),
        ...(input.userId ? crownWrites(input.userId) : []),
      ])
      return { winnerId: input.userId }
    }),

  /** Every Zigma Pooper of a term, for the admin picker. */
  poopers: adminProcedure
    .input(z.object({ termId: z.string().min(1) }))
    .query(({ input }) =>
      db.termPooper.findMany({
        where: { termId: input.termId },
        select: { userId: true },
      }),
    ),

  /**
   * Who is wearing a poop right now, as a flat list of ids. The mirror of crownHolder
   * above: one tiny cached query the whole page shares, so no avatar payload has to grow
   * a field. See poopHolderIds for which term's Poopers these are.
   */
  poopHolders: protectedProcedure.query(() => poopHolderIds()),

  /**
   * Replace a term's whole Pooper list in one transaction — the same replace-don't-patch
   * shape scoreTerm uses, so the list is never half-applied and the mutation is
   * idempotent under a double-click.
   *
   * Disqualifying the term's current Maxxer clears that winner (and their crown) in the
   * SAME transaction, because the two states cannot both be true. Doing it here rather
   * than refusing the write means an admin never has to unpick the order themselves.
   */
  setPoopers: adminProcedure
    .input(z.object({ termId: z.string().min(1), userIds: z.array(z.string().min(1)).max(200) }))
    .mutation(async ({ input }) => {
      const term = await db.term.findUnique({
        where: { id: input.termId },
        select: { id: true, winnerId: true },
      })
      if (!term) throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." })

      const userIds = [...new Set(input.userIds)]
      if (userIds.length > 0) {
        const found = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })
        if (found.length !== userIds.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "One or more users were not found." })
        }
      }

      const winnerNowPooped = term.winnerId !== null && userIds.includes(term.winnerId)

      await db.$transaction([
        db.termPooper.deleteMany({ where: { termId: input.termId } }),
        ...(userIds.length > 0
          ? [db.termPooper.createMany({ data: userIds.map((userId) => ({ termId: input.termId, userId })) })]
          : []),
        ...(winnerNowPooped
          ? [
              db.term.update({ where: { id: input.termId }, data: { winnerId: null } }),
              db.user.updateMany({ where: { id: term.winnerId! }, data: { hasCrown: false } }),
            ]
          : []),
      ])
      return { count: userIds.length, clearedWinner: winnerNowPooped }
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
