// Admin tRPC router — user management procedures for Phase 6.
//
// Procedures:
//   getAllUsers   — returns all users with explicit select (no password); admin-only
//   updateBalance — sets a user's zigmaPoints to a new value; admin-only
//
// Security:
//   T-6-01 — All procedures: ctx.session.user.role !== "ADMIN" → TRPCError FORBIDDEN
//             NEVER use requireAdmin() inside tRPC (it calls redirect() → crashes tRPC, Pitfall 3)
//   T-6-05 — getAllUsers explicit select excludes password/accounts/sessions (Information Disclosure guard)

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { updateBalanceSchema } from "@/lib/validation/task"
import { approvedEmailSchema } from "@/lib/validation/approved-email"
import { normalizeEmail } from "@/lib/approved-emails"
import { notifyZpChange } from "@/lib/notifications"

export const adminRouter = createTRPCRouter({
  /**
   * Returns all users with public fields — no password or auth relations.
   * Admin-only. Ordered by createdAt asc.
   *
   * Security:
   * - FORBIDDEN thrown for non-admin sessions (T-6-01)
   * - Explicit select excludes password, accounts, sessions (T-6-05 / D-05)
   */
  getAllUsers: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.user.role !== "ADMIN") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
    }
    return db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        zigmaPoints: true,
        role: true,
        createdAt: true,
        // password excluded — D-05 + Information Disclosure guard (T-6-05)
        // accounts, sessions excluded — T-6-05
      },
    })
  }),

  /**
   * Sets a user's zigmaPoints to a new value.
   * Admin-only. No reason field (D-06 — no audit trail model).
   *
   * Security:
   * - FORBIDDEN thrown for non-admin sessions (T-6-01)
   * - Target user existence verified before update (NOT_FOUND guard)
   */
  updateBalance: protectedProcedure
    .input(updateBalanceSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
      }
      // Verify target user exists
      const target = await db.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      })
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." })
      }
      const result = await db.user.update({
        where: { id: input.userId },
        data: { zigmaPoints: input.newBalance },
        select: { id: true, zigmaPoints: true },
      })

      // Non-blocking: notify the affected user after the response is sent (T-x04-02)
      after(() => notifyZpChange(input.userId))

      return result
    }),

  /**
   * Permanently deletes a user and all their associated data.
   * Admin-only. Cannot delete yourself.
   *
   * Cascade order (schema has no User-level cascade on most relations):
   * 1. TaskCompletions by user
   * 2. Votes by user
   * 3. Re-parent nested replies whose parent was authored by user, then delete user's replies
   * 4. Delete posts where user is author or target (votes cascade via Post → Vote)
   *    — first null out all intra-post parentId refs, then delete post replies, then posts
   * 5. Delete tasks created by user (TaskCompletions cascade via Task → TaskCompletion)
   *    — same reply-cleanup pattern
   * 6. Delete user (Account + Session cascade automatically)
   */
  deleteUser: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
      }
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account." })
      }

      await db.$transaction(async (tx) => {
        // 1. Delete this user's task completions + bets (bets on OTHER admins' tasks
        //    have no User-level cascade; bets on this user's own tasks cascade in step 5).
        await tx.taskCompletion.deleteMany({ where: { userId: input.userId } })
        await tx.taskBet.deleteMany({ where: { userId: input.userId } })

        // 2. Delete this user's votes
        await tx.vote.deleteMany({ where: { userId: input.userId } })

        // 3. Handle user's own replies (on other people's posts/tasks)
        const userReplies = await tx.reply.findMany({
          where: { authorId: input.userId },
          select: { id: true },
        })
        const userReplyIds = userReplies.map((r) => r.id)
        if (userReplyIds.length > 0) {
          // Re-parent direct children so the NoAction constraint doesn't block deletion
          await tx.reply.updateMany({
            where: { parentId: { in: userReplyIds } },
            data: { parentId: null },
          })
          await tx.reply.deleteMany({ where: { authorId: input.userId } })
        }

        // 4. Delete posts where user is author or one of the targets (M-01).
        // post_targets rows cascade when their parent post is deleted, so deleting
        // these posts also clears the user's PostTarget rows (no RESTRICT violation).
        const affectedPosts = await tx.post.findMany({
          where: {
            OR: [
              { authorId: input.userId },
              { targets: { some: { userId: input.userId } } },
            ],
          },
          select: { id: true },
        })
        const postIds = affectedPosts.map((p) => p.id)
        if (postIds.length > 0) {
          // Null all intra-post reply parentId refs before deletion
          await tx.reply.updateMany({
            where: { postId: { in: postIds }, parentId: { not: null } },
            data: { parentId: null },
          })
          await tx.reply.deleteMany({ where: { postId: { in: postIds } } })
          // Votes cascade via Post onDelete:Cascade
          await tx.post.deleteMany({ where: { id: { in: postIds } } })
        }

        // 5. Delete tasks created by user
        const affectedTasks = await tx.task.findMany({
          where: { adminId: input.userId },
          select: { id: true },
        })
        const taskIds = affectedTasks.map((t) => t.id)
        if (taskIds.length > 0) {
          await tx.reply.updateMany({
            where: { taskId: { in: taskIds }, parentId: { not: null } },
            data: { parentId: null },
          })
          await tx.reply.deleteMany({ where: { taskId: { in: taskIds } } })
          // TaskCompletions cascade via Task onDelete:Cascade
          await tx.task.deleteMany({ where: { id: { in: taskIds } } })
        }

        // 6. Delete user (Account + Session cascade automatically)
        await tx.user.delete({ where: { id: input.userId } })
      })

      return { deleted: true }
    }),

  /**
   * Signup allowlist management. Admin-only (T-6-01).
   *
   * These procedures gate REGISTRATION ONLY — removing an email never touches the
   * account that already registered with it. Use deleteUser for that.
   */
  listApprovedEmails: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.user.role !== "ADMIN") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
    }
    const [approved, users] = await Promise.all([
      db.approvedEmail.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, createdAt: true },
      }),
      db.user.findMany({ where: { email: { not: null } }, select: { email: true } }),
    ])
    // `registered` drives the UI badge that explains why removing an approved email
    // leaves the account standing — without it the distinction is invisible to admins.
    const registered = new Set(users.map((u) => u.email!.toLowerCase()))
    return approved.map((a) => ({ ...a, registered: registered.has(a.email) }))
  }),

  addApprovedEmail: protectedProcedure
    .input(approvedEmailSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
      }
      const email = normalizeEmail(input.email)
      const existing = await db.approvedEmail.findUnique({
        where: { email },
        select: { id: true },
      })
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "That email is already approved." })
      }
      return db.approvedEmail.create({ data: { email }, select: { id: true, email: true } })
    }),

  removeApprovedEmail: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
      }
      const target = await db.approvedEmail.findUnique({
        where: { id: input.id },
        select: { id: true },
      })
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Approved email not found." })
      }
      // Deletes the allowlist row ONLY — any account already registered with this
      // address keeps working, by design.
      await db.approvedEmail.delete({ where: { id: input.id } })
      return { removed: true }
    }),
})
