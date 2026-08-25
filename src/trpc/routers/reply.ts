// Reply tRPC router — data layer for Phase 5 threaded replies.
//
// Procedures:
//   createReply — creates a reply on a post or task; authorId always from session (never client input)
//   getReplies  — flat fetch of all replies for a post, oldest-first; client builds tree from parentId
//
// Security:
//   T-05-01 — createReply: authorId = ctx.session.user.id (never from client input / mass-assignment guard)
//   T-05-02 — createReply + getReplies: protectedProcedure — UNAUTHORIZED thrown before any DB access
//   T-05-03 — createReply: NOT_FOUND guard — verifies postId or taskId exists before db.reply.create
//   T-05-04 — getReplies: explicit select — author limited to { id, name, image, username }; never returns email/password
//   T-05-05 — createReplySchema excludes authorId from shape; createReply never reads input.authorId
//   T-6-07  — createReply: parentId must belong to same thread (postId/taskId match) — cross-thread prevention

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { createReplySchema } from "@/lib/validation/reply"

export const replyRouter = createTRPCRouter({
  /**
   * Creates a reply on a post or task (Phase 6 extension: taskId support).
   *
   * Exactly one of postId or taskId must be provided — enforced by the XOR refine on
   * createReplySchema. Server-side guards verify existence of the referenced post or task.
   *
   * Security:
   * - authorId is always sourced from ctx.session.user.id — never from client input (T-05-01)
   * - protectedProcedure throws UNAUTHORIZED before any DB access (T-05-02)
   * - postId/taskId verified to exist before db.reply.create (T-05-03)
   * - parentId must belong to same thread (T-6-07)
   * - createReplySchema excludes authorId (mass-assignment guard — T-05-05)
   */
  createReply: protectedProcedure
    .input(createReplySchema)
    .mutation(async ({ ctx, input }) => {
      const authorId = ctx.session.user.id

      // Verify post exists when postId is provided (T-05-03)
      if (input.postId) {
        const post = await db.post.findUnique({
          where: { id: input.postId },
          select: { id: true },
        })
        if (!post) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Post not found.",
          })
        }
      }

      // Verify task exists when taskId is provided (Phase 6, T-05-03)
      if (input.taskId) {
        const task = await db.task.findUnique({
          where: { id: input.taskId },
          select: { id: true },
        })
        if (!task) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." })
        }
      }

      // Verify parentId exists and belongs to the same thread (T-6-07 — prevents cross-thread parent refs)
      if (input.parentId) {
        const parent = await db.reply.findUnique({
          where: { id: input.parentId },
          select: { postId: true, taskId: true },
        })
        if (
          !parent ||
          parent.postId !== (input.postId ?? null) ||
          parent.taskId !== (input.taskId ?? null)
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Parent reply not found." })
        }
      }

      // Explicit select on create — never return unneeded fields
      return db.reply.create({
        data: {
          postId: input.postId ?? null,   // nullable after Phase 6 schema change (D-02)
          taskId: input.taskId ?? null,   // new field (D-02)
          parentId: input.parentId ?? null,
          authorId,
          content: input.content,
          mediaUrl: input.mediaUrl ?? null,
        },
        select: { id: true, createdAt: true },
      })
    }),

  /**
   * Returns all replies for a post, flat, oldest-first.
   * Client builds the visual tree from parentId references — no nested children include.
   *
   * Security:
   * - protectedProcedure throws UNAUTHORIZED before any DB access (T-05-02)
   * - Explicit Prisma select — author limited to { id, name, image, username }; never returns email (T-05-04)
   */
  getReplies: protectedProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.reply.findMany({
        where: { postId: input.postId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          mediaUrl: true,
          createdAt: true,
          parentId: true,
          author: { select: { id: true, name: true, image: true, username: true, equippedRing: true } },
        },
      })
    }),
})
