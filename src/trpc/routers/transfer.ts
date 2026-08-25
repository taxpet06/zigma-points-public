// Transfer tRPC router — peer-to-peer ZP movement (Phase: Transfer tab).
//
// NOTHING moves ZP without the counterparty's consent. Both directions create a PENDING
// Transfer that lands in the other party's Pending tab; only `respond` moves money:
//
//   send        — offer ZP to another user; PENDING, approved by the RECIPIENT
//   request     — ask another user for ZP; PENDING, approved by the PAYER
//   tradeOffer  — offer one owned collectible copy for a ZP price; PENDING, approved by
//                 the named recipient — a Transfer row with a non-null cosmeticPurchaseId,
//                 direction-mapped exactly like a Request (see cosmeticPurchaseId below)
//   listPending — every PENDING transfer the caller is party to, BOTH directions (the
//                 "Pending" tab) — awaiting the caller's answer AND awaiting the other
//                 party's answer to something the caller started (cancelable from there)
//   listLoans   — live loans on either side of the caller (the "Loans" tab)
//   respond     — the approver accepts (money moves, and a trade's copy moves) or rejects
//                 a PENDING transfer (and releases a trade's escrowed copy)
//   cancel      — the INITIATOR withdraws their own still-PENDING row, releasing any
//                 escrowed copy; reuses TransferStatus.REJECTED (no new enum value — see
//                 the status comment on the cancel procedure below)
//
// The approver is ALWAYS the party who did not create the row (initiatedById). That is
// the whole point: a sender can no longer push a loan with punitive interest onto someone
// who had no say — the recipient sees the terms and the repayment figure before accepting.
// A trade offer follows the identical rule: the offerer (who owns the copy) creates the
// row and therefore never approves it — only the named recipient can.
//
// A loan is an ordinary Transfer carrying dueAt + interestPct; /api/cron/settle collects
// principal + interest from the borrower (always toUser) at the deadline. The sweep only
// looks at APPROVED rows, so a pending offer owes nothing.
//
// Security / correctness mirrors bet.ts / listing.ts:
//   - protectedProcedure gates auth (UNAUTHORIZED before any DB access)
//   - the acting user is always ctx.session.user.id (never client input — IDOR guard)
//   - respond and cancel run under runSerializable (one isolation level for the whole
//     function, not branched by row type — Pitfall 4) so status is re-read inside the
//     transaction for idempotency (no double-spend / double-pay / double-release)
//   - the payer's balance is checked at APPROVAL time, whichever side the payer is on:
//     a pending send reserves nothing, so the sender may have spent the ZP meanwhile
//   - a trade offer's escrow claim is a conditional updateMany (where: { ..., userId,
//     escrowed: false }) inside the SAME transaction that creates the Transfer row —
//     count === 0 rolls the row back, same shape as listing.ts's create (T-20-05-02)

import { TRPCError } from "@trpc/server"
import { after } from "next/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import {
  sendZpSchema,
  requestZpSchema,
  respondTransferSchema,
  tradeOfferSchema,
  cancelTransferSchema,
  repayment,
} from "@/lib/validation/transfer"
import { notifyZpChange, notifyTransferRequest, notifyTradeOffer } from "@/lib/notifications"
import { getCosmetic } from "@/lib/cosmetics"

export const transferRouter = createTRPCRouter({
  /**
   * Offers ZP from the caller to one or more members. Creates one PENDING Transfer per
   * recipient (fromUser = the caller/payer, toUser = the recipient). NO money moves until
   * each recipient approves it from their Pending tab — a send loan's interest and
   * payback date are terms they accept, never terms imposed on them. Cannot send to yourself.
   */
  send: protectedProcedure
    .input(sendZpSchema)
    .mutation(async ({ ctx, input }) => {
      const fromUserId = ctx.session.user.id
      const toUserIds = [...new Set(input.toUserIds)]
      if (toUserIds.includes(fromUserId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't send ZP to yourself." })
      }

      const recipients = await db.user.findMany({
        where: { id: { in: toUserIds } },
        select: { id: true },
      })
      if (recipients.length !== toUserIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "A recipient was not found." })
      }

      // Fast-fail so the form can't offer ZP that plainly isn't there. This is a courtesy
      // check, NOT the guarantee: nothing is reserved, and the balance that actually
      // decides is re-checked inside respond() when the recipient approves.
      const total = input.amount * toUserIds.length
      const me = await db.user.findUnique({
        where: { id: fromUserId },
        select: { zigmaPoints: true },
      })
      if (!me || me.zigmaPoints < total) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You don't have enough ZP." })
      }

      await db.transfer.createMany({
        data: toUserIds.map((toUserId) => ({
          fromUserId,
          toUserId,
          amount: input.amount,
          note: input.note,
          status: "PENDING" as const,
          initiatedById: fromUserId, // the recipient approves
          // Dormant until approval — the sweep only collects APPROVED loans.
          interestPct: input.interestPct ?? null,
          dueAt: input.dueAt ?? null,
        })),
      })

      const senderName = ctx.session.user.name ?? "Someone"
      after(() =>
        Promise.all(
          toUserIds.map((id) => notifyTransferRequest(id, senderName, input.amount, "send")),
        ),
      )
      return { sent: true }
    }),

  /**
   * Requests ZP FROM one or more members. Creates one PENDING Transfer per payer
   * (fromUser = the payer, toUser = the caller). No money moves until each payer
   * approves. Cannot request from yourself.
   */
  request: protectedProcedure
    .input(requestZpSchema)
    .mutation(async ({ ctx, input }) => {
      const toUserId = ctx.session.user.id
      const fromUserIds = [...new Set(input.fromUserIds)]
      if (fromUserIds.includes(toUserId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't request ZP from yourself." })
      }

      const payers = await db.user.findMany({
        where: { id: { in: fromUserIds } },
        select: { id: true },
      })
      if (payers.length !== fromUserIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "A user was not found." })
      }

      await db.transfer.createMany({
        data: fromUserIds.map((fromUserId) => ({
          fromUserId,
          toUserId,
          amount: input.amount,
          note: input.note,
          status: "PENDING" as const,
          initiatedById: toUserId, // the payer approves
          // Loan terms ride along on the PENDING row but stay dormant: the sweep only
          // looks at APPROVED rows, so nothing is owed until the payer approves.
          interestPct: input.interestPct ?? null,
          dueAt: input.dueAt ?? null,
        })),
      })

      const requesterName = ctx.session.user.name ?? "Someone"
      after(() =>
        Promise.all(
          fromUserIds.map((id) => notifyTransferRequest(id, requesterName, input.amount)),
        ),
      )
      return { requested: true }
    }),

  /**
   * Offers one collectible copy the caller owns to one named member for a ZP price,
   * escrowing the copy the moment the offer is created. Direction-mapped exactly like
   * `request` (see the Transfer.cosmeticPurchaseId schema comment): the offerer (who
   * owns the copy and wants ZP) is toUserId/initiatedById; the recipient (who pays ZP
   * and receives the copy) is fromUserId. `respond` moves or releases the copy; nothing
   * here does more than escrow it and create the row.
   */
  tradeOffer: protectedProcedure
    .input(tradeOfferSchema)
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id // never client input — IDOR guard
      if (input.recipientId === me) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't offer a collectible to yourself.",
        })
      }

      const recipient = await db.user.findUnique({
        where: { id: input.recipientId },
        select: { id: true },
      })
      if (!recipient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That user was not found." })
      }

      const copy = await db.cosmeticPurchase.findUnique({
        where: { id: input.cosmeticPurchaseId },
        select: { userId: true, slug: true, escrowed: true },
      })
      if (!copy || copy.userId !== me) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own that." })
      }
      if (copy.escrowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That item is already listed or offered.",
        })
      }

      // Equipped-block is the STRICT rule (20-CONTEXT.md addendum, matches listing.ts's
      // create): ALL copies of an equipped slug are blocked, not just the last free one.
      // All three equipped slots (background/ring/title) are checked — a future fourth
      // kind is an obvious edit site here, not a silent omission.
      const user = await db.user.findUnique({
        where: { id: me },
        select: { equippedBackground: true, equippedRing: true, equippedTitle: true },
      })
      if (
        user?.equippedBackground === copy.slug ||
        user?.equippedRing === copy.slug ||
        user?.equippedTitle === copy.slug
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unequip this item before offering it.",
        })
      }

      await db.$transaction(async (tx) => {
        // The direction mapping, restated at the write site so a future reader cannot
        // invert it: the offerer (me, who owns the copy) is toUserId/initiatedById; the
        // recipient (who pays ZP and receives the copy) is fromUserId.
        await tx.transfer.create({
          data: {
            fromUserId: input.recipientId,
            toUserId: me,
            initiatedById: me,
            amount: input.price,
            cosmeticPurchaseId: input.cosmeticPurchaseId,
            status: "PENDING" as const,
          },
        })
        // The escrow claim — count === 0 means someone else claimed this copy (a
        // concurrent listing/offer) since the read above; the throw rolls the
        // just-created row back with it. Never a standalone write.
        const claimed = await tx.cosmeticPurchase.updateMany({
          where: { id: input.cosmeticPurchaseId, userId: me, escrowed: false },
          data: { escrowed: true },
        })
        if (claimed.count === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That item isn't available to offer right now.",
          })
        }
      })

      const offererName = ctx.session.user.name ?? "Someone"
      const itemName = getCosmetic(copy.slug)?.name ?? copy.slug
      after(() => notifyTradeOffer(input.recipientId, offererName, itemName, input.price))
      return { offered: true }
    }),

  /**
   * The INITIATOR withdraws their own still-PENDING row (send, request, or trade offer),
   * releasing any escrowed copy. Only the party who created the row may cancel it, and
   * only while it's PENDING — mirrors respond()'s status re-read, under the same
   * runSerializable isolation. Reuses TransferStatus.REJECTED rather than a new enum
   * value (no transfer-history surface exists in this app today to need the
   * distinction — see the Transfer model's cosmeticPurchaseId comment; an accepted,
   * documented limitation per 20-RESEARCH.md Pitfall 5).
   */
  cancel: protectedProcedure
    .input(cancelTransferSchema)
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id // never client input — IDOR guard

      await runSerializable(async (tx) => {
        const transfer = await tx.transfer.findUnique({
          where: { id: input.transferId },
          select: { id: true, initiatedById: true, status: true, cosmeticPurchaseId: true },
        })
        if (!transfer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found." })
        }
        if (transfer.initiatedById !== me) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can't cancel a transfer you didn't start.",
          })
        }
        if (transfer.status !== "PENDING") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This transfer was already answered." })
        }

        await tx.transfer.update({
          where: { id: transfer.id },
          data: { status: "REJECTED", respondedAt: new Date() },
        })
        if (transfer.cosmeticPurchaseId) {
          await tx.cosmeticPurchase.update({
            where: { id: transfer.cosmeticPurchaseId },
            data: { escrowed: false },
          })
        }
      })

      return { cancelled: true }
    }),

  /**
   * Every PENDING transfer the caller is party to, BOTH directions — the "Pending" tab.
   * Awaiting the caller's answer (waitingOnMe: true) AND rows the caller initiated that
   * await the other party (waitingOnMe: false, cancelable from here). iAmPayer and
   * counterparty are derived here rather than in the client, so the direction rule lives
   * in one place — same shape as listLoans. Trade rows (non-null cosmeticPurchaseId)
   * additionally carry an `item` block with the copy's live circulation.
   */
  listPending: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id
    const rows = await db.transfer.findMany({
      where: {
        status: "PENDING",
        OR: [{ fromUserId: me }, { toUserId: me }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        note: true,
        createdAt: true,
        interestPct: true, // so the approver sees the loan terms before committing
        dueAt: true,
        fromUserId: true,
        initiatedById: true,
        cosmeticPurchaseId: true,
        copy: { select: { slug: true, mintNumber: true, kind: true } },
        fromUser: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
            equippedRing: true,
            equippedTitle: true,
          },
        },
        toUser: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
            equippedRing: true,
            equippedTitle: true,
          },
        },
      },
    })

    // Batch circulation lookup for any trade rows present — unfiltered by
    // escrowed/userId/status on purpose (MKT-04/Pitfall 6): rows move, they are never
    // created or deleted, so circulation must never look smaller while a copy is escrowed.
    const slugs = [...new Set(rows.map((r) => r.copy?.slug).filter((s): s is string => !!s))]
    const totals = slugs.length
      ? await db.cosmeticPurchase.groupBy({
          by: ["slug"],
          where: { slug: { in: slugs } },
          _count: { _all: true },
        })
      : []
    const circulation = new Map(totals.map((t) => [t.slug, t._count._all]))

    return rows.map((r) => {
      const iAmPayer = r.fromUserId === me // a request for my ZP; otherwise a send to me
      const waitingOnMe = r.initiatedById !== me // the flip side of the old approver-only filter
      const cosmetic = r.copy ? getCosmetic(r.copy.slug) : undefined
      return {
        id: r.id,
        amount: r.amount,
        note: r.note,
        createdAt: r.createdAt,
        interestPct: r.interestPct,
        dueAt: r.dueAt,
        iAmPayer,
        waitingOnMe,
        counterparty: iAmPayer ? r.toUser : r.fromUser,
        item: r.copy
          ? {
              slug: r.copy.slug,
              mintNumber: r.copy.mintNumber,
              kind: r.copy.kind,
              name: cosmetic?.name ?? r.copy.slug,
              rarity: cosmetic?.rarity,
              circulation: circulation.get(r.copy.slug) ?? 0,
            }
          : null,
      }
    })
  }),

  /**
   * Live loans the caller is party to, either side — the "Loans" tab.
   * The borrower/lender split is derived here via repayment() rather than in the client,
   * so the direction rule lives in exactly one place.
   */
  listLoans: protectedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id
    const rows = await db.transfer.findMany({
      where: {
        status: "APPROVED",
        dueAt: { not: null },
        repaidAt: null,
        OR: [{ fromUserId: me }, { toUserId: me }],
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        amount: true,
        interestPct: true,
        dueAt: true,
        note: true,
        fromUserId: true,
        toUserId: true,
        fromUser: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
            equippedRing: true,
            equippedTitle: true,
          },
        },
        toUser: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
            equippedRing: true,
            equippedTitle: true,
          },
        },
      },
    })

    return rows.map((r) => {
      const { borrowerId, owed } = repayment(r)
      const iAmBorrower = borrowerId === me
      return {
        id: r.id,
        dueAt: r.dueAt,
        note: r.note,
        owed,
        amount: r.amount,
        interestPct: r.interestPct,
        iAmBorrower,
        counterparty: iAmBorrower ? r.fromUser : r.toUser,
      }
    })
  }),

  /**
   * The approver accepts (ZP moves, and a trade's copy moves to them) or rejects (a
   * trade's escrowed copy returns) a PENDING transfer. The approver is the party who did
   * NOT create the row: the payer on a request, the recipient on a send, the named
   * recipient on a trade offer. Runs under runSerializable (promoted from a plain
   * db.$transaction for ALL row types, not branched by row type — Pitfall 4) so status
   * is re-read inside the transaction for idempotency: a double-click or concurrent
   * request can't pay out twice, move a copy twice, or release escrow twice.
   */
  respond: protectedProcedure
    .input(respondTransferSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const notifyId = await runSerializable(async (tx) => {
        const transfer = await tx.transfer.findUnique({
          where: { id: input.transferId },
          select: {
            id: true,
            fromUserId: true,
            toUserId: true,
            amount: true,
            status: true,
            dueAt: true,
            initiatedById: true,
            cosmeticPurchaseId: true,
          },
        })
        if (!transfer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found." })
        }
        // Whoever didn't create it answers it. Legacy rows (initiatedById null) predate
        // approvable sends and are always requests, so the payer answers those.
        const approverId =
          transfer.initiatedById === transfer.fromUserId ? transfer.toUserId : transfer.fromUserId
        if (approverId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This transfer isn't yours to answer." })
        }
        if (transfer.status !== "PENDING") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This transfer was already answered." })
        }

        if (input.action === "REJECT") {
          await tx.transfer.update({
            where: { id: transfer.id },
            data: { status: "REJECTED", respondedAt: new Date() },
          })
          // A denied trade offer releases the copy back to the offerer — no ownership
          // change, just clear the escrow flag (V-03).
          if (transfer.cosmeticPurchaseId) {
            await tx.cosmeticPurchase.update({
              where: { id: transfer.cosmeticPurchaseId },
              data: { escrowed: false },
            })
          }
          return null
        }

        // A loan approved after its own deadline would be collected by the very next
        // sweep — reject instead of handing out ZP that's instantly clawed back.
        if (transfer.dueAt != null && transfer.dueAt <= new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This loan's payback date has already passed.",
          })
        }

        // APPROVE — the PAYER must still have the ZP, and the payer is fromUser whichever
        // side approved. On a send that's the sender, who may have spent it since offering
        // (a pending offer reserves nothing).
        const payer = await tx.user.findUnique({
          where: { id: transfer.fromUserId },
          select: { zigmaPoints: true },
        })
        if (!payer || payer.zigmaPoints < transfer.amount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              transfer.fromUserId === userId
                ? "You don't have enough ZP to approve this."
                : "The sender no longer has enough ZP to cover this.",
          })
        }
        await tx.user.update({
          where: { id: transfer.fromUserId },
          data: { zigmaPoints: { decrement: transfer.amount } },
        })
        await tx.user.update({
          where: { id: transfer.toUserId },
          data: { zigmaPoints: { increment: transfer.amount } },
        })
        await tx.transfer.update({
          where: { id: transfer.id },
          data: { status: "APPROVED", respondedAt: new Date() },
        })
        // An approved trade offer moves the copy to the acceptor — fromUserId is the
        // payer, i.e. the one who just paid the ZP and now receives the item (V-01: this
        // is a move, never a create/delete, so circulation stays invariant).
        if (transfer.cosmeticPurchaseId) {
          await tx.cosmeticPurchase.update({
            where: { id: transfer.cosmeticPurchaseId },
            data: { userId: transfer.fromUserId, escrowed: false },
          })
        }
        // Tell the OTHER party — their balance moved without them clicking anything.
        return transfer.fromUserId === userId ? transfer.toUserId : transfer.fromUserId
      })

      if (notifyId) after(() => notifyZpChange(notifyId))
      return { ok: true }
    }),
})
