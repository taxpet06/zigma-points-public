// Blackjack router — Mines-shaped multi-step consumer with mid-round stake adds
// (double / split / insurance). Settlement always goes through settleInTx inside
// runSerializable — never nested settleBet (12-RESEARCH.md Pitfall 4).
//
// Anti-leak: shoe + hole are derived per request via deriveBlackjackShoe and NEVER
// written into ACTIVE state. Only BlackjackPersistedState (public cards + cursor + phase)
// is stored. casino.activeRound returns state verbatim.

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import type { Prisma } from "../../../prisma/generated/prisma/client"
import { db, runSerializable } from "@/lib/db"
import { openBet, settleInTx } from "@/lib/casino/bet"
import { debitWhere, payoutFor } from "@/lib/casino/limits"
import {
  applyDouble,
  applyHit,
  applyInsure,
  applyNoInsurance,
  applySplit,
  applyStand,
  dealInitial,
  deriveBlackjackShoe,
  insuranceCost,
  settleRound,
  shouldAutoSettleAfterDeal,
  toPublicView,
  type BlackjackPersistedState,
} from "@/lib/casino/blackjack"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"

function parseState(raw: unknown): BlackjackPersistedState {
  if (!raw || typeof raw !== "object") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Corrupt blackjack round." })
  }
  return raw as BlackjackPersistedState
}

function publicResponse(
  betId: string,
  wager: number,
  state: BlackjackPersistedState,
  opts?: {
    settled?: boolean
    dealerCards?: import("@/lib/casino/blackjack").Card[]
    payout?: number
    multiplier?: number | null
  },
) {
  const view = toPublicView(state, {
    settled: opts?.settled,
    dealerCards: opts?.dealerCards ?? null,
  })
  return {
    betId,
    wager,
    settled: Boolean(opts?.settled),
    payout: opts?.payout ?? 0,
    multiplier: opts?.multiplier ?? null,
    ...view,
  }
}

async function settleBlackjack(
  tx: Prisma.TransactionClient,
  opts: {
    betId: string
    userId: string
    wager: number
    state: BlackjackPersistedState
    shoe: Awaited<ReturnType<typeof deriveBlackjackShoe>>
  },
) {
  const settled = settleRound(opts.state, opts.shoe, opts.wager)
  // Multiplier such that payoutFor(wager, mult) reconstitutes the capped gross payout.
  const multiplier = opts.wager > 0 ? settled.payout / opts.wager : 0
  const result = await settleInTx(tx, {
    betId: opts.betId,
    userId: opts.userId,
    wager: opts.wager,
    multiplier,
    outcome: {
      ...opts.state,
      dealerCards: settled.dealerCards,
      hands: settled.hands,
      insurancePayout: settled.insurancePayout,
      settled: true,
    },
  })
  return {
    ...publicResponse(opts.betId, opts.wager, opts.state, {
      settled: true,
      dealerCards: settled.dealerCards,
      payout: result.payout,
      multiplier: result.multiplier,
    }),
  }
}

async function debitExtra(
  tx: Prisma.TransactionClient,
  userId: string,
  betId: string,
  extra: number,
  nextState: BlackjackPersistedState,
): Promise<number> {
  if (extra <= 0) {
    await tx.casinoBet.updateMany({
      where: { id: betId, userId, status: "ACTIVE" },
      data: { state: nextState as unknown as Prisma.InputJsonValue },
    })
    const row = await tx.casinoBet.findUnique({ where: { id: betId }, select: { wager: true } })
    return row?.wager ?? 0
  }

  const { count } = await tx.user.updateMany({
    where: debitWhere(userId, extra),
    data: { zigmaPoints: { decrement: extra } },
  })
  if (count === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not enough ZP." })
  }

  const { count: betCount } = await tx.casinoBet.updateMany({
    where: { id: betId, userId, status: "ACTIVE" },
    data: {
      wager: { increment: extra },
      state: nextState as unknown as Prisma.InputJsonValue,
    },
  })
  if (betCount === 0) {
    // Round vanished under us — refund the extra debit.
    await tx.user.update({
      where: { id: userId },
      data: { zigmaPoints: { increment: extra } },
    })
    throw new TRPCError({ code: "NOT_FOUND", message: "No active round found." })
  }

  const row = await tx.casinoBet.findUnique({ where: { id: betId }, select: { wager: true } })
  return row!.wager
}

export const blackjackRouter = createTRPCRouter({
  open: protectedProcedure
    .input(z.object({ wager: z.number().int() }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const existing = await db.casinoBet.findFirst({
        where: { userId, status: "ACTIVE" },
        select: { id: true },
      })
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a round in progress." })
      }

      const { bet, seed } = await openBet({
        userId,
        game: "BLACKJACK",
        wager: input.wager,
        config: { baseWager: input.wager },
      })

      const shoe = await deriveBlackjackShoe(seed)
      const state = dealInitial(shoe, input.wager)

      if (shouldAutoSettleAfterDeal(state, shoe)) {
        return runSerializable(async (tx) => {
          // Ensure the ACTIVE row still exists (openBet just created it).
          const row = await tx.casinoBet.findFirst({
            where: { id: bet.id, userId, status: "ACTIVE" },
          })
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No active round found." })
          // Persist state briefly for audit trail inside settle outcome.
          await tx.casinoBet.update({
            where: { id: bet.id },
            data: { state: state as unknown as Prisma.InputJsonValue },
          })
          return settleBlackjack(tx, {
            betId: bet.id,
            userId,
            wager: input.wager,
            state,
            shoe,
          })
        })
      }

      await db.casinoBet.update({
        where: { id: bet.id },
        data: { state: state as unknown as Prisma.InputJsonValue },
      })

      return publicResponse(bet.id, input.wager, state)
    }),

  action: protectedProcedure
    .input(
      z
        .object({
          betId: z.string(),
          action: z.enum(["hit", "stand", "double", "split", "insure", "no_insurance"]),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      return runSerializable(async (tx) => {
        const row = await tx.casinoBet.findFirst({
          where: { id: input.betId, userId, game: "BLACKJACK", status: "ACTIVE" },
          include: { seed: true },
        })
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No active round found." })

        const state = parseState(row.state)
        const shoe = await deriveBlackjackShoe(row.seed)
        const baseWager = (row.config as { baseWager?: number }).baseWager ?? row.wager

        let result
        try {
          switch (input.action) {
            case "hit":
              result = applyHit(state, shoe)
              break
            case "stand":
              result = applyStand(state)
              break
            case "double":
              result = applyDouble(state, shoe)
              break
            case "split":
              result = applySplit(state, shoe)
              break
            case "insure":
              result = applyInsure(state, shoe, insuranceCost(baseWager))
              break
            case "no_insurance":
              result = applyNoInsurance(state, shoe)
              break
            default:
              throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown action." })
          }
        } catch (e) {
          if (e instanceof TRPCError) throw e
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: e instanceof Error ? e.message : "Illegal action.",
          })
        }

        const wagerAfter = await debitExtra(tx, userId, row.id, result.extraStake, result.state)

        if (result.kind === "settle") {
          return settleBlackjack(tx, {
            betId: row.id,
            userId,
            wager: wagerAfter,
            state: result.state,
            shoe,
          })
        }

        return publicResponse(row.id, wagerAfter, result.state)
      })
    }),
})

/** Exported for tests — recomputes display payout the shell uses. */
export function blackjackNet(wager: number, payout: number): number {
  return payout - wager
}

export { payoutFor }
