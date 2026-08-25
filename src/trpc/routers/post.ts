// Post tRPC router — data layer for Phase 3.
//
// Procedures:
//   createPost    — creates an AWARD or DEDUCT post; authorId always from session (never client input)
//   getFeed       — cursor-based paginated feed of AWARD + DEDUCT + REGULAR posts AND
//                   betting pools (BET tasks), merged and ordered by createdAt desc
//   searchUsers   — debounced autocomplete search; excludes self; searches name and username
//
// Security:
//   T-03-01 — createPost: authorId = ctx.session.user.id (never from client input)
//   T-03-02 — createPost: self-nomination guard (targetUserId === authorId → BAD_REQUEST)
//   T-03-03 — createPost: every target user verified to exist before db.post.create
//   T-03-04 — createPost: votingEndsAt set server-side (Date.now() + 24h); absent from input schema
//   T-03-05 — getFeed / searchUsers: protectedProcedure — UNAUTHORIZED before any DB access
//   T-03-06 — searchUsers: excludes self (id: { not: callerId })

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { createPostSchema } from "@/lib/validation/post"
import { castVoteSchema, retractVoteSchema } from "@/lib/validation/vote"
import { notifyTaggedInPost, notifyNewPost } from "@/lib/notifications"

// The feed cursor is "<createdAt ISO>|<id>", a keyset over (createdAt desc, id desc)
// rather than a Prisma row cursor: the feed merges two tables (posts and BET tasks)
// whose ids share no ordering, so the next page has to be expressed as "older than
// this instant" and applied to both. The id half only breaks same-millisecond ties.
function feedCursorWhere(cursor: string | null | undefined) {
  if (!cursor) return {}
  const sep = cursor.lastIndexOf("|")
  const createdAt = new Date(cursor.slice(0, sep))
  const id = cursor.slice(sep + 1)
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }
}

export const postRouter = createTRPCRouter({
  /**
   * Creates an AWARD, DEDUCT or REGULAR post.
   *
   * Security:
   * - authorId is always sourced from ctx.session.user.id — never from client input (T-03-01)
   * - Self-nomination is blocked server-side before any DB write (T-03-02)
   * - Every target user must exist (T-03-03); a claimed username is not required
   * - votingEndsAt is computed server-side as Date.now() + 24h (T-03-04)
   * - createPostSchema excludes settled, outcome, votingEndsAt, authorId (mass-assignment guard)
   *
   * REGULAR is the no-op variant: no targets, no ZP, no voting window, settled on arrival. It
   * is normalised HERE rather than trusted from the client, because the create form keeps its
   * hidden zpAmount/targetUserIds values in state when you switch post type — and because a
   * client that could talk a REGULAR post into carrying targets and a live voting window would
   * have talked it into moving ZP.
   */
  createPost: protectedProcedure
    .input(createPostSchema)
    .mutation(async ({ ctx, input }) => {
      const authorId = ctx.session.user.id
      const isRegular = input.type === "REGULAR"

      // Dedupe target ids — the UI shouldn't submit duplicates, but guard anyway
      // so the @@unique([postId, userId]) constraint can never reject the create.
      const targetIds = isRegular ? [] : [...new Set(input.targetUserIds)]

      // Server-side self-nomination block (T-03-02 / D-09) — applies to every target.
      if (targetIds.includes(authorId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot nominate yourself.",
        })
      }

      // Verify EVERY target user exists (T-03-03). A claimed username is NOT
      // required — searchUsers surfaces usernameless users (they appear by display
      // name), so they must be valid targets too, else createPost would reject any
      // selection the autocomplete itself offered.
      const targetUsers = await db.user.findMany({
        where: { id: { in: targetIds } },
        select: { id: true },
      })
      if (targetUsers.length !== targetIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more target users were not found.",
        })
      }

      // votingEndsAt is server-set — never from client input (T-03-04 / D-11). REGULAR gets
      // `now` plus settled:true: the column is non-null, and `settled` is the single flag every
      // existing guard already keys off — the settlement cron selects `settled: false`, castVote
      // and cancelPost both reject a settled post — so one field neutralises voting and
      // settlement at once without a new "is this votable" concept spreading through the code.
      const votingEndsAt = isRegular ? new Date() : new Date(Date.now() + 24 * 60 * 60 * 1000)

      const post = await db.post.create({
        data: {
          authorId,
          type: input.type,
          title: input.title,
          // The column is non-null; an omitted Regular description is stored as "" and every
          // read site already renders explanation conditionally, so no nullable migration.
          explanation: input.explanation ?? "",
          zpAmount: isRegular ? 0 : (input.zpAmount ?? 0),
          mediaUrl: input.mediaUrl ?? null,
          images: input.images ?? [],
          votingEndsAt,
          settled: isRegular,
          targets: { create: targetIds.map((userId) => ({ userId })) },
        },
        // Explicit select — never return sensitive fields (T-03-01 guard)
        select: { id: true, createdAt: true },
      })

      // Non-blocking: notify tagged users after the response is sent (T-x04-02)
      after(() => notifyTaggedInPost(targetIds, post.id))
      // Non-blocking: broadcast the new post to every registered user (260710-iak).
      // A REGULAR post has nothing to vote on, so it must not tell everyone to go vote.
      after(() => notifyNewPost(post.id, input.title, authorId, !isRegular))

      return post
    }),

  /**
   * Returns cursor-based paginated feed of AWARD, DEDUCT and REGULAR posts by createdAt desc.
   * Mirrors the getPostHistory cursor pattern from user.ts (take: limit+1, pop for nextCursor).
   * TASK posts are excluded from the feed (handled separately in Phase 6).
   * explanation included in select for PostCard preview — zero-cost, avoids a future schema change.
   */
  getFeed: protectedProcedure
    .input(
      z.object({
        cursor: z.string().nullish(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const callerId = ctx.session.user.id
      const { cursor, limit } = input

      // Two tables, one chronological feed: posts and betting pools (BET tasks).
      // Each is fetched limit+1 deep past the same keyset, merged, and truncated —
      // so a page is always the globally newest `limit` rows across both.
      const keyset = feedCursorWhere(cursor)
      const [posts, pools] = await Promise.all([
        db.post.findMany({
          where: { type: { in: ["AWARD", "DEDUCT", "REGULAR"] }, ...keyset },
          take: limit + 1,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            type: true,
            title: true,
            explanation: true,
            zpAmount: true,
            mediaUrl: true,
            images: true,
            outcome: true,
            settled: true,
            votingEndsAt: true,
            createdAt: true,
            author: {
              select: {
                id: true,
                name: true,
                image: true,
                username: true,
                equippedRing: true,
              },
            },
            targets: { select: { user: { select: { id: true, name: true, image: true, username: true, equippedRing: true } } } },
            votes: { select: { type: true, userId: true } },
            _count: { select: { replies: true } },
          },
        }),
        db.task.findMany({
          where: { kind: "BET", ...keyset },
          take: limit + 1,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            title: true,
            description: true,
            mediaUrl: true,
            images: true,
            createdAt: true,
            minBet: true,
            betsCloseAt: true,
            winningChoice: true,
            betSettledAt: true,
            admin: {
              select: {
                id: true,
                name: true,
                image: true,
                username: true,
                equippedRing: true,
              },
            },
            _count: { select: { replies: true } },
          },
        }),
      ])

      // Compute vote counts and current-user vote state JS-side.
      // Raw votes array is stripped from the return — only agreeCount, disagreeCount,
      // and userVote (the caller's own vote row or null) are exposed to clients.
      // This prevents leaking the full voter list (Information Disclosure — threat model).
      // targets is flattened from [{ user }] to [user] so PostCard consumes a plain user list.
      const mappedPosts = posts.map((post) => {
        const { votes, targets, ...rest } = post
        return {
          ...rest,
          targets: targets.map((t) => t.user),
          agreeCount: votes.filter((v) => v.type === "AGREE").length,
          disagreeCount: votes.filter((v) => v.type === "DISAGREE").length,
          userVote: votes.find((v) => v.userId === callerId) ?? null,
          // Bet-only fields, null on a post: both branches return ONE shape, so the
          // feed stays a single item type and every existing consumer (the optimistic
          // vote/cancel patches in FeedList) keeps working untouched.
          minBet: null as number | null,
          betsCloseAt: null as Date | null,
          winningChoice: null as string | null,
          betSettled: false,
        }
      })

      // A pool has no votes and no targets — it is settled by an admin declaring the
      // winning choice, not by the voting cron, so it carries settled/outcome as read-only
      // display state and TaskCard (not PostCard) renders it.
      const mappedPools = pools.map((pool) => ({
        id: pool.id,
        type: "BET" as const,
        title: pool.title,
        explanation: pool.description,
        zpAmount: 0,
        mediaUrl: pool.mediaUrl,
        images: pool.images,
        outcome: null as string | null,
        settled: pool.betSettledAt !== null,
        votingEndsAt: pool.betsCloseAt ?? pool.createdAt,
        createdAt: pool.createdAt,
        author: pool.admin,
        targets: [] as (typeof mappedPosts)[number]["targets"],
        agreeCount: 0,
        disagreeCount: 0,
        userVote: null as (typeof mappedPosts)[number]["userVote"],
        minBet: pool.minBet,
        betsCloseAt: pool.betsCloseAt,
        winningChoice: pool.winningChoice,
        betSettled: pool.betSettledAt !== null,
        _count: pool._count,
      }))

      const merged = [...mappedPosts, ...mappedPools].sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )

      // More rows than a page means at least one source still has rows past the cut;
      // fewer means both sources were exhausted (each would have returned limit+1).
      let nextCursor: string | undefined
      if (merged.length > limit) {
        merged.length = limit
        const last = merged[limit - 1]
        nextCursor = `${last.createdAt.toISOString()}|${last.id}`
      }

      return { items: merged, nextCursor }
    }),

  /**
   * Returns cursor-based paginated feed of posts where the caller is one of the target users.
   * Same shape as getFeed so PostCard can be reused without modification.
   */
  getTaggedFeed: protectedProcedure
    .input(
      z.object({
        cursor: z.string().nullish(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const callerId = ctx.session.user.id
      const { cursor, limit } = input

      const items = await db.post.findMany({
        where: { targets: { some: { userId: callerId } }, type: { in: ["AWARD", "DEDUCT"] } },
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          title: true,
          explanation: true,
          zpAmount: true,
          mediaUrl: true,
          images: true,
          outcome: true,
          settled: true,
          votingEndsAt: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              username: true,
              equippedRing: true,
            },
          },
          targets: { select: { user: { select: { id: true, name: true, image: true, username: true, equippedRing: true } } } },
          votes: { select: { type: true, userId: true } },
          _count: { select: { replies: true } },
        },
      })

      let nextCursor: string | undefined
      if (items.length > limit) {
        const nextItem = items.pop()!
        nextCursor = nextItem.id
      }

      const mapped = items.map((post) => {
        const { votes, targets, ...rest } = post
        return {
          ...rest,
          targets: targets.map((t) => t.user),
          agreeCount: votes.filter((v) => v.type === "AGREE").length,
          disagreeCount: votes.filter((v) => v.type === "DISAGREE").length,
          userVote: votes.find((v) => v.userId === callerId) ?? null,
        }
      })

      return { items: mapped, nextCursor }
    }),

  /**
   * Returns autocomplete results for target user selection.
   * Excludes the calling user (T-03-06 / D-09). Searches by display name and username
   * (case-insensitive LIKE query). Users without a claimed username are included — they
   * appear by display name only. Capped at 8 results for autocomplete dropdown performance.
   *
   * Performance note: `contains: mode: "insensitive"` generates ILIKE '%query%'. At MVP scale
   * (hundreds of users) this is acceptable. If the user base grows to tens of thousands, add
   * a @@index([name, username]) or switch to Postgres full-text search.
   */
  searchUsers: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const callerId = ctx.session.user.id

      return db.user.findMany({
        where: {
          AND: [
            { id: { not: callerId } }, // exclude self (T-03-06 / D-09)
            {
              OR: [
                { name: { contains: input.query, mode: "insensitive" } },
                { username: { contains: input.query, mode: "insensitive" } },
              ],
            },
          ],
        },
        take: 8, // cap results for autocomplete dropdown
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
        },
        orderBy: { name: "asc" },
      })
    }),

  /**
   * One post by id, in the SAME shape as a getFeed item — so /post/[id] can render
   * PostCard with live vote counts and the caller's own vote, and wire up voting
   * exactly like the feed does.
   *
   * Security: mirrors getFeed — explicit select (never password/email), and the raw
   * `votes` array is stripped from the return so the voter list can't leak
   * (Information Disclosure). NOT_FOUND on an unknown id.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const callerId = ctx.session.user.id
      const post = await db.post.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          type: true,
          title: true,
          explanation: true,
          zpAmount: true,
          mediaUrl: true,
          images: true,
          outcome: true,
          settled: true,
          votingEndsAt: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              username: true,
              equippedRing: true,
            },
          },
          targets: { select: { user: { select: { id: true, name: true, image: true, username: true, equippedRing: true } } } },
          votes: { select: { type: true, userId: true } },
        },
      })
      if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." })

      const { votes, targets, ...rest } = post
      return {
        ...rest,
        targets: targets.map((t) => t.user),
        agreeCount: votes.filter((v) => v.type === "AGREE").length,
        disagreeCount: votes.filter((v) => v.type === "DISAGREE").length,
        userVote: votes.find((v) => v.userId === callerId) ?? null,
      }
    }),

  /**
   * Casts or flips an agree/disagree vote on a post.
   *
   * Security:
   * - userId always from ctx.session.user.id — never from client input (Spoofing)
   * - Self-vote blocked server-side (Elevation of Privilege)
   * - Voting window enforced server-side (Tampering)
   * - Upsert on @@unique([postId, userId]) prevents duplicate votes (Tampering)
   * - castVoteSchema excludes settled, outcome, votingEndsAt (mass-assignment guard)
   */
  castVote: protectedProcedure
    .input(castVoteSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const post = await db.post.findUnique({
        where: { id: input.postId },
        select: { authorId: true, votingEndsAt: true, settled: true },
      })

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." })
      }

      if (post.settled || post.votingEndsAt <= new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Voting is closed for this post." })
      }

      if (post.authorId === userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot vote on your own post." })
      }

      return db.vote.upsert({
        where: { postId_userId: { postId: input.postId, userId } },
        update: { type: input.type },
        create: { postId: input.postId, userId, type: input.type },
      })
    }),

  /**
   * Retracts a user's vote on a post.
   *
   * Security:
   * - userId always from ctx.session.user.id — never from client input
   * - Voting window enforced server-side (Tampering)
   * - Uses deleteMany (not delete) — silently no-ops if vote row doesn't exist (Integrity)
   */
  retractVote: protectedProcedure
    .input(retractVoteSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // Atomic: fold the settlement guard into the WHERE predicate so the
      // settled-check and the delete cannot be separated by the settlement cron.
      const result = await db.vote.deleteMany({
        where: {
          postId: input.postId,
          userId,
          post: { settled: false, votingEndsAt: { gt: new Date() } },
        },
      })

      if (result.count === 0) {
        // Distinguish "voting closed" from "no vote existed" so the client
        // gets the right error code.
        const post = await db.post.findUnique({
          where: { id: input.postId },
          select: { settled: true, votingEndsAt: true },
        })
        if (!post) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." })
        }
        if (post.settled || post.votingEndsAt <= new Date()) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Voting is closed for this post." })
        }
        // count=0 but voting is open — user had no vote to retract; silent no-op.
      }

      return { success: true }
    }),

  /**
   * Cancels an open post. Admin-only. A cancelled post still renders (greyed out),
   * awards/deducts nothing, and can never be voted on again.
   *
   * Cancellation is modelled as a terminal settlement — `settled: true` with
   * `outcome: "Cancelled"` — rather than a new column, because every existing
   * guard already keys off `settled`:
   *   - the settlement cron selects `settled: false`, so it skips the post entirely
   *     → no ZP ever moves for a cancelled post
   *   - castVote rejects `post.settled` → FORBIDDEN
   *   - retractVote's WHERE predicate requires `settled: false` → no-op
   * There is no code path that reads outcome and moves ZP, so an unknown outcome
   * string is inert by construction.
   *
   * Security:
   * - adminProcedure re-reads role from the DB — a stale ADMIN JWT cannot cancel
   * - Input is `{ postId }` only; settled/outcome/zpAmount are never client-supplied
   *   (mass-assignment guard)
   * - The updateMany WHERE is a compare-and-set on "post is still open", and it is
   *   the ONLY thing standing between an admin and a decided post. Cancel is for a
   *   post still taking votes — never for one whose outcome is already determined,
   *   whose ZP may already have moved, and which cancelling would silently void.
   * - No un-cancel procedure exists — the transition is one-way.
   */
  cancelPost: adminProcedure
    .input(z.object({ postId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      // Atomic CAS — the open-check and the write cannot be separated by the
      // settlement cron or by a concurrent second cancel.
      //
      // The predicate is the SAME "post is still open" test retractVote uses, and it
      // needs both halves. `settled: false` alone is not enough: settlement is an
      // external cron, so a post whose voting window closed hours ago still reads
      // settled:false until that cron runs. Cancelling in that gap would void an
      // outcome the community had already decided, purely because the cron was late.
      const result = await db.post.updateMany({
        where: { id: input.postId, settled: false, votingEndsAt: { gt: new Date() } },
        data: { settled: true, outcome: "Cancelled" },
      })

      if (result.count === 0) {
        // Unknown id or already settled — one error for both. A settled post is not
        // cancellable at all (its ZP has moved), so there is nothing to tell an admin
        // apart from "this didn't happen".
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Post not found, or it has already settled.",
        })
      }

      return { cancelled: true }
    }),
})
