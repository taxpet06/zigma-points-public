// Shared Zod schemas for peer ZP transfer input.
// Single source of truth for tRPC server-side validation and client forms.
//
// amount uses z.coerce.number() — HTML <input type="number"> delivers strings on
// the client; over the wire (superjson) it arrives a number and coerce is a no-op.
// The acting user is always ctx.session.user.id server-side — never a client field
// (mass-assignment / IDOR guard), so only the counterparty ids are accepted here.
//
// Counterparties are a list to mirror the post-targeting picker (M-01): a Send fans
// out `amount` ZP to EACH recipient; a Request creates one pending row per payer.
//
// Phase 20 — tradeOfferSchema/cancelTransferSchema: a trade offer is a single copy -> a
// single ZP amount -> a single person (never a fan-out list like sendZpSchema). The field
// is `recipientId`, NOT `toUserId` — in the resulting Transfer row the offerer (who owns the
// copy) is toUserId/initiatedById and the recipient (who pays ZP and gets the copy) is
// fromUserId (see the Transfer model's cosmeticPurchaseId comment); naming the input after
// the row column would invite a direction bug. Price reuses zpPriceSchema from ./listing —
// one shared bound for both listing prices and trade-offer prices, not two.

import { z } from "zod"

import { zpPriceSchema } from "./listing"

const userIds = z.array(z.string().min(1)).min(1, "Pick at least one person")

// Loan terms — optional on both forms. A transfer is a LOAN iff dueAt is set; the two
// fields are all-or-nothing. Empty <input type="datetime-local"> submits "" (→ undefined),
// same preprocess/coerce.date pattern as createTaskSchema's betsCloseAt.
const loanShape = {
  interestPct: z.coerce.number().int().min(0).max(1000).optional(),
  dueAt: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.date().optional()
  ),
}

function loanRefine(
  val: { interestPct?: number; dueAt?: Date },
  ctx: z.RefinementCtx
) {
  if ((val.interestPct == null) !== (val.dueAt == null)) {
    ctx.addIssue({
      code: "custom",
      path: [val.dueAt == null ? "dueAt" : "interestPct"],
      message: "Interest and payback date are required together",
    })
  }
  if (val.dueAt != null && val.dueAt.getTime() <= Date.now()) {
    ctx.addIssue({ code: "custom", path: ["dueAt"], message: "Payback date must be in the future" })
  }
}

// Offer ZP to one or more members (pending until each recipient approves). toUserIds = the payees.
export const sendZpSchema = z
  .object({
    toUserIds: userIds,
    amount: z.coerce.number().int().min(1, "Amount must be at least 1 ZP"),
    note: z.string().trim().max(160, "Note cannot exceed 160 characters").optional(),
    ...loanShape,
  })
  .superRefine(loanRefine)

// Request ZP from one or more members (creates pending requests). fromUserIds = the payers.
export const requestZpSchema = z
  .object({
    fromUserIds: userIds,
    amount: z.coerce.number().int().min(1, "Amount must be at least 1 ZP"),
    note: z.string().trim().max(160, "Note cannot exceed 160 characters").optional(),
    ...loanShape,
  })
  .superRefine(loanRefine)

/**
 * Total a borrower owes at the deadline: principal + one-time interest, rounded UP.
 * The ONLY place this math lives — router, cron sweep and the form preview all call it.
 */
export function owedAmount(amount: number, interestPct: number): number {
  return amount + Math.ceil((amount * interestPct) / 100)
}

/**
 * Who repays whom, and how much. The direction rule (see the Transfer model comment):
 * ZP always flows fromUser → toUser, so on a loan the BORROWER is always toUserId and the
 * LENDER always fromUserId — identical for a Send loan and an approved Request loan.
 * Repayment is the exact reverse of the original flow; there is no per-origination branch.
 */
export function repayment(loan: {
  fromUserId: string
  toUserId: string
  amount: number
  interestPct: number | null
}) {
  return {
    borrowerId: loan.toUserId,
    lenderId: loan.fromUserId,
    owed: owedAmount(loan.amount, loan.interestPct ?? 0),
  }
}

// Payer answers a pending request.
export const respondTransferSchema = z.object({
  transferId: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT"]),
})

// Offer one copy you own to one member for a ZP amount you set.
export const tradeOfferSchema = z
  .object({
    recipientId: z.string().min(1),
    cosmeticPurchaseId: z.string().min(1),
    price: zpPriceSchema,
  })
  .strict()

// Cancel a transfer you initiated (send/request/trade offer) while still PENDING.
export const cancelTransferSchema = z
  .object({
    transferId: z.string().min(1),
  })
  .strict()
