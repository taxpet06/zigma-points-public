// Task tRPC router — data layer for Phase 6 Task Posts.
//
// Procedures:
//   createTask     — creates a new Task Post; admin-only; adminId from session (never input)
//   getTasks       — returns all tasks ordered by recency; any authenticated user
//   getTask        — returns a single task by id; any authenticated user
//   getTaskReplies — returns all replies for a task with nested completion status
//   completeTask   — marks a task reply as complete and awards ZP; admin-only; atomic $transaction
//
// Security:
//   T-6-01 — every admin-only procedure (updateTask, completeTask, and createTask for
//             STANDARD) verifies role against the DATABASE, not the JWT claim, so a
//             demoted admin's still-valid token cannot mint ZP or edit a live pool.
//             NEVER use requireAdmin() inside tRPC (Pitfall 3 — calls redirect())
//   T-6-02 — completeTask: idempotency guard — existing AWARDED status → BAD_REQUEST (Pitfall 2)
//   T-6-03 — completeTask: db.$transaction wraps upsert + increment (atomicity, Pattern 2)
//   T-6-04 — createTask: adminId = ctx.session.user.id (never from input — mass-assignment guard)
//   T-6-06 — all procedures: protectedProcedure throws UNAUTHORIZED before DB access

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure, adminProcedure, isDbAdmin } from "@/trpc/init"
import { db } from "@/lib/db"
import { createTaskSchema, updateTaskSchema, completeTaskSchema } from "@/lib/validation/task"
import { notifyZpChange, notifyNewTask } from "@/lib/notifications"

export const taskRouter = createTRPCRouter({
  /**
   * Creates a new Task Post.
   * STANDARD is admin-only — it promises ZP out of thin air (zpReward), so only an
   * admin may mint one. BET is open to every user: a pool pays out only what its
   * bettors staked, and the money-moving half of it (declaring the outcome, or
   * cancelling and refunding) stays admin-only in bet.settleBet / bet.cancelBet.
   * adminId is the creator, always from ctx.session.user.id — never client input.
   *
   * Security:
   * - FORBIDDEN thrown for non-admin sessions creating a STANDARD task (T-6-01)
   * - adminId = ctx.session.user.id (mass-assignment guard, T-6-04)
   */
  createTask: protectedProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const isBet = input.kind === "BET"
      // Role from the DB, not the JWT claim — same authority adminProcedure uses.
      // Can't be a procedure-level gate: the requirement depends on the input's kind.
      if (!isBet && !(await isDbAdmin(ctx.session.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
      }
      const adminId = ctx.session.user.id // never from client input (T-6-04)
      // Trim + dedupe choices server-side (schema tolerates blank rows from the form).
      const choices = isBet
        ? [...new Set((input.choices ?? []).map((c) => c.trim()).filter(Boolean))]
        : []
      const task = await db.task.create({
        data: {
          adminId,
          title: input.title,
          description: input.description,
          kind: input.kind,
          // BET tasks don't use zpReward (pot is user-funded) — store 0 (column is non-null).
          zpReward: isBet ? 0 : (input.zpReward ?? 1),
          minBet: isBet ? input.minBet : null,
          betsCloseAt: isBet ? (input.betsCloseAt ?? null) : null,
          choices,
          mediaUrl: input.mediaUrl ?? null,
          images: input.images ?? [],
        },
        select: { id: true, createdAt: true },
      })
      // BET tasks pass null reward so the email uses the generic "earn ZP" copy.
      after(() => notifyNewTask(task.id, input.title, isBet ? null : (input.zpReward ?? null)))
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
          ...(isBet
            ? {
                ...(input.minBet != null ? { minBet: input.minBet } : {}),
                ...(input.betsCloseAt !== undefined ? { betsCloseAt: input.betsCloseAt } : {}),
              }
            : input.zpReward != null
            ? { zpReward: input.zpReward }
            : {}),
        },
      })
      return { updated: true }
    }),

  /**
   * Returns tasks, ordered by recency (newest first).
   * Any authenticated user can view tasks (TASK-01).
   *
   * `kind` narrows the list. The home Activities tab passes STANDARD because betting
   * pools now live in the Posts feed instead (post.getFeed merges them in); the admin
   * panel omits it and still sees every task, pools included, to edit and settle them.
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
   * Completion status is fetched via author.taskCompletions filtered to this task (Pattern 5).
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
              taskCompletions: {
                where: { taskId: input.taskId },
                select: { status: true, awardedZp: true },
              },
            },
          },
        },
      })
    }),

  /**
   * Marks a task reply as complete and awards ZP to the reply author.
   * Admin-only. Atomic: upserts TaskCompletion + increments zigmaPoints in an interactive
   * $transaction so the idempotency check and the balance increment are serialized under
   * the same DB transaction, preventing TOCTOU double-awards from concurrent admin sessions.
   *
   * Security:
   * - FORBIDDEN thrown for non-admin sessions (T-6-01)
   * - Idempotency guard inside the transaction — existing AWARDED status → return false (T-6-02, Pitfall 2)
   * - db.$transaction(async tx => …) ensures atomicity + cross-request isolation (T-6-03, CR-03)
   * - userId derived from reply.authorId (fetched from DB), never from client input
   */
  completeTask: adminProcedure
    .input(completeTaskSchema)
    .mutation(async ({ input }) => {
      const task = await db.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, zpReward: true },
      })
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." })
      }
      if (task.zpReward == null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Task has no ZP reward." })
      }

      const reply = await db.reply.findUnique({
        where: { id: input.replyId },
        select: { id: true, authorId: true, taskId: true },
      })
      if (!reply || reply.taskId !== input.taskId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reply not found." })
      }

      // Interactive transaction: idempotency check + upsert + increment are all atomic.
      // Concurrent admin sessions both pass a check-outside-transaction scenario (TOCTOU, CR-03);
      // moving the guard inside the transaction and relying on the unique(taskId, userId)
      // constraint serializes concurrent creates correctly (T-6-03).
      const awarded = await db.$transaction(async (tx) => {
        const existing = await tx.taskCompletion.findUnique({
          where: { taskId_userId: { taskId: input.taskId, userId: reply.authorId } },
          select: { status: true },
        })
        if (existing?.status === "AWARDED") {
          return false // already done — caller throws BAD_REQUEST
        }

        await tx.taskCompletion.upsert({
          where: { taskId_userId: { taskId: input.taskId, userId: reply.authorId } },
          update: { status: "AWARDED", awardedZp: task.zpReward },
          create: {
            taskId: input.taskId,
            userId: reply.authorId,
            status: "AWARDED",
            awardedZp: task.zpReward,
          },
        })
        await tx.user.update({
          where: { id: reply.authorId },
          data: { zigmaPoints: { increment: task.zpReward } },
          select: { id: true, zigmaPoints: true },
        })
        return true
      })

      if (!awarded) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already awarded." })
      }

      // Non-blocking: notify the awarded user after the response is sent (T-x04-02).
      // Only fires on the real-award path (awarded === true); not on idempotent re-award.
      after(() => notifyZpChange(reply.authorId))

      return { awarded: true }
    }),
})
