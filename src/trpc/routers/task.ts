// Task tRPC router — data layer for Phase 6 Task Posts.
//
// Procedures:
//   createTask     — creates a new Task Post; admin-only; adminId from session (never input)
//   getTasks       — returns all tasks ordered by recency; any authenticated user
//   getTask        — returns a single task by id; any authenticated user
//   getTaskReplies — returns all replies for a task with nested completion status
//
// Security:
//   T-6-01 — every admin-only procedure (updateTask, and createTask for
//             STANDARD) verifies role against the DATABASE, not the JWT claim, so a
//             demoted admin's still-valid token cannot mint ZP or edit a live pool.
//             NEVER use requireAdmin() inside tRPC (Pitfall 3 — calls redirect())
//   T-6-04 — createTask: adminId = ctx.session.user.id (never from input — mass-assignment guard)
//   T-6-06 — all procedures: protectedProcedure throws UNAUTHORIZED before DB access

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { createTaskSchema, updateTaskSchema } from "@/lib/validation/task"
import { notifyNewTask } from "@/lib/notifications"
import { stampTermId, requireActiveTerm } from "@/lib/terms"

export const taskRouter = createTRPCRouter({
  /**
   * Creates a new Task Post.
   * STANDARD is admin-only — it promises ZP out of thin air (zpReward), so only an
   * admin may mint one. BET is open to every user: a pool pays out only what its
   * bettors staked, and the money-moving half of it (declaring the outcome, or
   * cancelling and refunding) stays admin-only in bet.settleBet / bet.cancelBet.
   * adminId is the creator, always from ctx.session.user.id — never client input.
   *
   * Any signed-in user may open a pool — that has always been true of BET tasks, and
   * with Activities (STANDARD) removed it is now the only kind, so the old
   * admin-gate-by-input-kind branch is gone with it.
   *
   * Security:
   * - adminId = ctx.session.user.id (mass-assignment guard, T-6-04)
   */
  createTask: protectedProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      // Same rule as createPost: bet.placeBet gates on isCurrentTerm, so a pool opened
      // with no term running could never take a bet.
      await requireActiveTerm()

      const adminId = ctx.session.user.id // never from client input (T-6-04)
      // Trim + dedupe choices server-side (schema tolerates blank rows from the form).
      const choices = [...new Set((input.choices ?? []).map((c) => c.trim()).filter(Boolean))]
      const task = await db.task.create({
        data: {
          adminId,
          // Betting pools share the Posts feed with posts, so they carry the same
          // term stamp — otherwise a term filter would hide the posts and leave the
          // pools behind. See lib/terms.ts.
          termId: await stampTermId(),
          title: input.title,
          description: input.description,
          kind: "BET",
          // A pool's pot is user-funded, so it has no zpReward — the column is
          // non-null and every BET row has always stored 0 here.
          zpReward: 0,
          minBet: input.minBet,
          betsCloseAt: input.betsCloseAt ?? null,
          choices,
          mediaUrl: input.mediaUrl ?? null,
          images: input.images ?? [],
        },
        select: { id: true, createdAt: true },
      })
      // null reward — the email uses the generic "earn ZP" copy for pools.
      after(() => notifyNewTask(task.id, input.title, null))
      return task
    }),

  /**
   * Edits an existing task. Admin-only.
   * STANDARD tasks: editable any time (title, description, zpReward).
   * BET tasks: editable only while the pool is open — a locked or settled pool is
   * immutable, so a cutoff can never be moved/cleared after it fires (no reopening).
   * kind and choices are immutable (see updateTaskSchema).
   */
  updateTask: adminProcedure
    .input(updateTaskSchema)
    .mutation(async ({ input }) => {
      const task = await db.task.findUnique({
        where: { id: input.taskId },
        select: { kind: true, betsCloseAt: true, betSettledAt: true },
      })
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." })
      }
      const isBet = task.kind === "BET"
      if (isBet && task.betSettledAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Settled pools can't be edited." })
      }
      if (isBet && task.betsCloseAt && task.betsCloseAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Locked pools can't be edited." })
      }
      await db.task.update({
        where: { id: input.taskId },
        data: {
          title: input.title,
          description: input.description,
          // BET is the only editable kind left; a legacy STANDARD row still in the DB
          // has no UI to reach this from, and its zpReward is frozen where it is.
          ...(isBet
            ? {
                ...(input.minBet != null ? { minBet: input.minBet } : {}),
                ...(input.betsCloseAt !== undefined ? { betsCloseAt: input.betsCloseAt } : {}),
              }
            : {}),
        },
      })
      return { updated: true }
    }),

  /**
   * Returns tasks, ordered by recency (newest first).
   * Any authenticated user can view tasks (TASK-01).
   *
   * `kind` narrows the list. Kept after the Activities removal because edit-task-modal
   * invalidates this query key on save; pools themselves are read through the Posts
   * feed (post.getFeed merges them in), not from here.
   */
  getTasks: protectedProcedure
    .input(z.object({ kind: z.enum(["STANDARD", "BET"]).optional() }).optional())
    .query(async ({ input }) => {
    return db.task.findMany({
      where: input?.kind ? { kind: input.kind } : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        zpReward: true,
        kind: true,
        minBet: true,
        betsCloseAt: true,
        winningChoice: true,
        betSettledAt: true,
        mediaUrl: true,
        images: true,
        createdAt: true,
        admin: { select: { id: true, name: true, image: true } },
        _count: { select: { replies: true } },
      },
    })
  }),

  /**
   * Returns a single task by id.
   * Any authenticated user can view tasks.
   */
  getTask: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const task = await db.task.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          title: true,
          description: true,
          zpReward: true,
          mediaUrl: true,
          images: true,
          createdAt: true,
          admin: { select: { id: true, name: true, image: true } },
        },
      })
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." })
      }
      return task
    }),

  /**
   * Returns all replies for a task, oldest-first, with nested completion status.
   * TaskCompletion is keyed on (taskId, userId) — not (taskId, replyId) — so status is per user per task.
   *
   * Security:
   * - protectedProcedure throws UNAUTHORIZED before any DB access (T-6-06)
   */
  getTaskReplies: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.reply.findMany({
        where: { taskId: input.taskId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          mediaUrl: true,
          createdAt: true,
          parentId: true,
          taskId: true,
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              username: true,
              equippedRing: true,
            },
          },
        },
      })
    }),

})
