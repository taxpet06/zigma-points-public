// User tRPC router — profile data layer for Phase 2.
//
// Procedures:
//   getMe         — returns the current user's full profile (including username for nav)
//   claimUsername — validates + claims a unique username; P2002 → CONFLICT
//   updateProfile — updates name/bio/image; mass-assignment guarded (no role/zigmaPoints/userId)
//   getProfile    — returns a user's public fields by username; never password or email
//   getPostHistory — cursor-based paginated post history, tab=sent|received
//
// Security:
//   T-01-12 — getMe excludes password field (Information Disclosure)
//   T-02-02 — updateProfile input only accepts name/bio/image (Elevation of Privilege / mass-assign)
//   T-02-03 — claimUsername uses usernameSchema regex (Tampering)
//   T-02-04 — getProfile select is explicit — never password or email (Information Disclosure)
//   T-02-05 — @unique + P2002 catch is the race-safe duplicate prevention (Tampering)

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { usernameSchema } from "@/lib/validation/username"
import { Prisma } from "../../../prisma/generated/prisma/client"

export const userRouter = createTRPCRouter({
  /**
   * Returns the current signed-in user's profile from the database.
   * Requires a valid session (protectedProcedure — T-01-10).
   * Password is excluded from the select (T-01-12).
   * username included for nav avatar link (Pitfall 6 fix).
   */
  getMe: protectedProcedure.query(async ({ ctx }) => {
    const user = await db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        zigmaPoints: true,
        image: true,
        bio: true,
        username: true,
        equippedRing: true,
        equippedBackground: true,
        equippedTitle: true,
        emailNotifications: true,
      },
    })
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User record not found." })
    return user
  }),

  /**
   * Claims a unique username for the current user.
   * Validates format via usernameSchema (T-02-03).
   * P2002 unique constraint error → CONFLICT (race-safe, T-02-05).
   */
  claimUsername: protectedProcedure
    .input(z.object({ username: usernameSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { username: true },
      })
      if (existing?.username) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Username already claimed.",
        })
      }
      try {
        return await db.user.update({
          where: { id: ctx.session.user.id },
          data: { username: input.username },
          select: { username: true },
        })
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That username is already taken.",
          })
        }
        throw e
      }
    }),

  /**
   * Updates the current user's display name, bio, and/or avatar image.
   * Input schema deliberately omits role, zigmaPoints, and userId (T-02-02 mass-assignment guard).
   * User ID is sourced from the session — never from client input (IDOR prevention).
   * name/bio/image are all optional (partial updates allowed), but when provided, name must be non-empty.
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(50).optional(),
        bio: z.string().max(160, "Bio cannot exceed 160 characters").optional(),
        image: z.string().url().optional(),
        emailNotifications: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.user.update({
        where: { id: ctx.session.user.id },
        data: input,
        select: { name: true, bio: true, image: true, emailNotifications: true },
      })
    }),

  /**
   * Returns all users with public-safe fields for the People directory.
   * Requires a valid session — community members only, not public.
   * Excludes email, password, role, and auth relations.
   * Ordered by name ascending for stable alphabetical browsing.
   */
  getAll: protectedProcedure.query(async () => {
    return db.user.findMany({
      orderBy: [{ zigmaPoints: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        username: true,
        image: true,
        bio: true,
        zigmaPoints: true,
        equippedRing: true,
        equippedBackground: true,
        equippedTitle: true,
        // Zigma Maxxer win count — every card that renders the full cosmetic set
        // (background + ring + title) shows the trophy tally too. One aggregate,
        // cheaper than a second round trip per grid.
        _count: { select: { termsWon: true } },
      },
    })
  }),

  /**
   * Returns cursor-based paginated post history for a user.
   * Requires a valid session — user data is community-members-only, never public.
   * Callable for any userId (any signed-in member may view any profile's history).
   * If private posts are introduced in a future phase, add a visibility filter here.
   * tab="sent"     → posts where authorId = userId
   * tab="received" → posts where userId is one of the post's targets (M-01)
   * Returns { items, nextCursor } for TanStack Query infiniteQueryOptions.
   */
  getPostHistory: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        tab: z.enum(["sent", "received"]),
        cursor: z.string().nullish(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const { userId, tab, cursor, limit } = input
      const where =
        tab === "sent"
          ? { authorId: userId }
          : { targets: { some: { userId } } }

      const items = await db.post.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          title: true,
          explanation: true,
          zpAmount: true,
          outcome: true,
          settled: true,
          votingEndsAt: true,
          createdAt: true,
          author: {
            select: { id: true, name: true, image: true, equippedRing: true, equippedTitle: true },
          },
          targets: { select: { user: { select: { id: true, name: true, image: true, equippedRing: true } } } },
          votes: { select: { type: true } },
          _count: { select: { replies: true } },
        },
      })

      let nextCursor: string | undefined
      if (items.length > limit) {
        const nextItem = items.pop()!
        nextCursor = nextItem.id
      }

      const mappedItems = items.map(({ votes, targets, _count, ...rest }) => ({
        ...rest,
        targets: targets.map((t) => t.user),
        agreeCount: votes.filter((v) => v.type === "AGREE").length,
        disagreeCount: votes.filter((v) => v.type === "DISAGREE").length,
        replyCount: _count.replies,
      }))

      return { items: mappedItems, nextCursor }
    }),
})
