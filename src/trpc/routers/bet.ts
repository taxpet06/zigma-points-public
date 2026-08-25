// Bet tRPC router — pari-mutuel prediction pools on BET-kind Tasks.
//
// Procedures:
//   getBetState — pool snapshot for the BetPanel (pot, per-choice tally, my bet, my balance)
//   placeBet    — stakes ZP on a choice; deducts balance atomically; one bet per user per task
//   lockBets    — admin closes betting early
//   settleBet   — admin declares the winning choice and pays out the pot (idempotent)
//   cancelBet   — admin voids the pool and refunds every stake (idempotent)
//
// Security:
//   - protectedProcedure gates auth (UNAUTHORIZED before any DB access)
//   - anyone may OPEN a pool (task.createTask) and bet in one, but every procedure that
//     decides where the pot goes — lock, settle, cancel — is adminProcedure, which
//     re-reads role from the DB. The session role is a JWT snapshot: a demoted admin
//     still carries a token claiming ADMIN, and that token must not be able to pay a
//     pot out. (Never requireAdmin() in tRPC — Pitfall 3, it calls redirect().)
//   - userId always from ctx.session.user.id (never client input — mass-assignment guard)
//   - money mutations run in db.$transaction so the balance check + write are serialized

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure, adminProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { placeBetSchema, settleBetSchema } from "@/lib/validation/task"
import { settleBets } from "@/lib/bet-payout"
import { notifyZpChange } from "@/lib/notifications"

export const betRouter = createTRPCRouter({
  /**
   * Returns the live pool snapshot for a BET task.
   * Any authenticated user; only aggregate totals + the caller's own bet are exposed
   * (no per-user stake disclosure).
   */
  getBetState: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const task = await db.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          kind: true,
          choices: true,
          minBet: true,
          betsCloseAt: true,
          winningChoice: true,
          betSettledAt: true,
        },
      })
      if (!task || task.kind !== "BET") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found." })
      }

      const [bets, me] = await Promise.all([
        db.taskBet.findMany({
          where: { taskId: input.taskId },
          select: { userId: true, choice: true, amount: true, payout: true },
        }),
        db.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { zigmaPoints: true },
        }),
      ])

      const pot = bets.reduce((s, b) => s + b.amount, 0)
      const tally = task.choices.map((choice) => {
        const forChoice = bets.filter((b) => b.choice === choice)
        return {
          choice,
          total: forChoice.reduce((s, b) => s + b.amount, 0),
          count: forChoice.length,
        }
      })
      const mine = bets.find((b) => b.userId === ctx.session.user.id) ?? null

      return {
        taskId: task.id,
        choices: task.choices,
        minBet: task.minBet ?? 1,
        betsCloseAt: task.betsCloseAt,
        // Server clock is authoritative — the client only uses this to render state.
        locked: task.betsCloseAt !== null && task.betsCloseAt.getTime() <= Date.now(),
        settled: task.betSettledAt !== null,
        winningChoice: task.winningChoice,
        pot,
        tally,
        bettorCount: bets.length,
        myBalance: me?.zigmaPoints ?? 0,
        myBet: mine ? { choice: mine.choice, amount: mine.amount, payout: mine.payout } : null,
      }
    }),

  /**
   * Stakes ZP on a choice. Deducts the stake from the caller's balance immediately.
   * One bet per user per task (enforced by unique(taskId,userId) + the pre-check).
   *
   * Atomicity: the existence check, balance check, decrement and bet insert all run in
   * one interactive transaction so concurrent requests can't double-spend or double-bet.
   */
  placeBet: protectedProcedure
    .input(placeBetSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const task = await db.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, kind: true, choices: true, minBet: true, betsCloseAt: true, betSettledAt: true },
      })
      if (!task || task.kind !== "BET") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found." })
      }
      if (task.betSettledAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Betting is closed on this task." })
      }
      if (task.betsCloseAt && task.betsCloseAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Betting is locked — the cutoff has passed." })
      }
      if (!task.choices.includes(input.choice)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That choice is not on this bet." })
      }
      if (task.minBet != null && input.amount < task.minBet) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Minimum bet is ${task.minBet} ZP.` })
      }

      await db.$transaction(async (tx) => {
        const existing = await tx.taskBet.findUnique({
          where: { taskId_userId: { taskId: input.taskId, userId } },
          select: { id: true },
        })
        if (existing) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You already placed a bet." })
        }
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { zigmaPoints: true },
        })
        if (!user || user.zigmaPoints < input.amount) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You don't have enough ZP for that bet." })
        }
        await tx.user.update({
          where: { id: userId },
          data: { zigmaPoints: { decrement: input.amount } },
        })
        await tx.taskBet.create({
          data: { taskId: input.taskId, userId, choice: input.choice, amount: input.amount },
        })
      })

      return { placed: true }
    }),

  /**
   * Admin locks betting immediately. Sets betsCloseAt to the server's now — the
   * client never supplies the timestamp (clock skew would let a skewed clock set a
   * future cutoff and leave the pool open). Irreversible: updateTask rejects all
   * edits on a locked pool, so there is no reopen path.
   */
  lockBets: adminProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const task = await db.task.findUnique({
        where: { id: input.taskId },
        select: { kind: true, betsCloseAt: true, betSettledAt: true },
      })
      if (!task || task.kind !== "BET") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found." })
      }
      if (task.betSettledAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This bet is already settled." })
      }
      if (task.betsCloseAt && task.betsCloseAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Betting is already locked." })
      }
      await db.task.update({
        where: { id: input.taskId },
        data: { betsCloseAt: new Date() },
      })
      return { locked: true }
    }),

  /**
   * Admin declares the winning choice and pays out the pot proportionally.
   * Idempotent: the betSettledAt guard is re-read inside the transaction so a second
   * click (or concurrent admin) can't pay out twice.
   */
  settleBet: adminProcedure
    .input(settleBetSchema)
    .mutation(async ({ input }) => {
      const task = await db.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, kind: true, choices: true, betSettledAt: true },
      })
      if (!task || task.kind !== "BET") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found." })
      }
      if (!task.choices.includes(input.winningChoice)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That choice is not on this bet." })
      }

      const paidUserIds = await db.$transaction(async (tx) => {
        const fresh = await tx.task.findUnique({
          where: { id: input.taskId },
          select: { betSettledAt: true },
        })
        if (fresh?.betSettledAt) return null // already settled — no-op

        const bets = await tx.taskBet.findMany({
          where: { taskId: input.taskId },
          select: { id: true, userId: true, choice: true, amount: true },
        })

        const { payoutByBetId } = settleBets(bets, input.winningChoice)

        const winners: string[] = []
        for (const bet of bets) {
          const payout = payoutByBetId.get(bet.id) ?? 0
          await tx.taskBet.update({ where: { id: bet.id }, data: { payout } })
          if (payout > 0) {
            await tx.user.update({
              where: { id: bet.userId },
              data: { zigmaPoints: { increment: payout } },
            })
            winners.push(bet.userId)
          }
        }

        await tx.task.update({
          where: { id: input.taskId },
          data: { winningChoice: input.winningChoice, betSettledAt: new Date() },
        })

        return winners
      })

      if (paidUserIds === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This bet is already settled." })
      }

      // Non-blocking: tell each paid-out user their balance changed (mirrors admin.updateBalance).
      after(() => Promise.all(paidUserIds.map((id) => notifyZpChange(id))))

      return { settled: true }
    }),

  /**
   * Admin cancels a pool — every stake is refunded and the pool becomes terminal,
   * the bet-side equivalent of post.cancelPost (nothing is won, nothing is lost).
   *
   * Cancelled is modelled as "settled with no winning choice" — betSettledAt set,
   * winningChoice left null — rather than a new column, because every existing guard
   * already keys off betSettledAt: placeBet rejects it, updateTask rejects it, and
   * settleBet's in-transaction re-read treats it as already settled, so a cancelled
   * pool can never be settled afterwards. settleBetSchema requires a non-empty
   * winningChoice, so a real settlement can never be mistaken for a cancellation.
   *
   * Security:
   * - adminProcedure re-reads role from the DB — a stale ADMIN JWT cannot cancel
   * - the betSettledAt check and the refunds share one transaction, so a concurrent
   *   settle/cancel can't pay the pot out twice
   * - no un-cancel procedure exists — the transition is one-way
   */
  cancelBet: adminProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const outcome = await db.$transaction(async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: input.taskId },
          select: { kind: true, betSettledAt: true },
        })
        if (!task || task.kind !== "BET") return "missing" as const
        if (task.betSettledAt) return "closed" as const

        const bets = await tx.taskBet.findMany({
          where: { taskId: input.taskId },
          select: { id: true, userId: true, amount: true },
        })
        for (const bet of bets) {
          // payout === amount is the refund marker the panel already reads.
          await tx.taskBet.update({ where: { id: bet.id }, data: { payout: bet.amount } })
          await tx.user.update({
            where: { id: bet.userId },
            data: { zigmaPoints: { increment: bet.amount } },
          })
        }
        await tx.task.update({
          where: { id: input.taskId },
          data: { betSettledAt: new Date() }, // winningChoice stays null — that IS "cancelled"
        })
        return bets.map((b) => b.userId)
      })

      if (outcome === "missing") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found." })
      }
      if (outcome === "closed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This bet is already settled." })
      }

      after(() => Promise.all(outcome.map((id) => notifyZpChange(id))))

      return { cancelled: true }
    }),
})
