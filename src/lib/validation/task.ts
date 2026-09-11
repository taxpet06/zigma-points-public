// Shared Zod schemas for Task-related input validation.
// Single source of truth used by tRPC server-side input validation and client-side forms.
//
// Important: numeric fields use z.coerce.number() — HTML <input type="number"> delivers
// strings to react-hook-form; coerce handles string-to-number conversion on the client.
// Server-side (superjson over tRPC wire), the value arrives as a number — coerce is a no-op.
//
// Server-only fields excluded (mass-assignment guard):
//   createTaskSchema: adminId is set server-side from ctx.session.user.id — never from client input.
//   updateBalanceSchema: no reason/note field — D-06 (no audit trail model).

import { z } from "zod"

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().min(1, "Description is required").max(2000),
    // BET is the only kind creatable — Activities (STANDARD tasks) were removed. The
    // enum keeps its single member rather than dropping the field, so an old client
    // still posting kind:"STANDARD" is REJECTED by validation rather than silently
    // creating a betting pool with no choices.
    kind: z.literal("BET").default("BET"),
    minBet: z.coerce.number().int().min(1, "Minimum bet must be at least 1").optional(),
    // Betting cutoff — optional; empty <input type="datetime-local"> submits "" (→ undefined).
    betsCloseAt: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.date().optional()
    ),
    choices: z.array(z.string().max(60)).optional(), // empty rows tolerated; trimmed/filtered server-side
    mediaUrl: z.string().url().optional(),
    images: z.array(z.string().url()).max(10, "At most 10 images").optional(),
    // adminId excluded — sourced from ctx.session.user.id server-side (mass-assignment guard)
  })
  .superRefine((val, ctx) => {
    const distinct = new Set((val.choices ?? []).map((c) => c.trim()).filter(Boolean))
    if (distinct.size < 2) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "Add at least 2 distinct choices" })
    }
    if (val.minBet == null) {
      ctx.addIssue({ code: "custom", path: ["minBet"], message: "Minimum bet is required" })
    }
    if (val.betsCloseAt != null && val.betsCloseAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["betsCloseAt"],
        message: "Betting close time must be in the future",
      })
    }
  })

// Admin edit of an existing task. kind and choices are immutable — placed bets
// reference choice strings, so renaming/removing a choice would orphan them.
// betsCloseAt: undefined = leave unchanged; null (or "" from an emptied
// datetime-local) = clear the cutoff. The locked/settled guard lives server-side.
export const updateTaskSchema = z
  .object({
    taskId: z.string().min(1),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().min(1, "Description is required").max(2000),
    minBet: z.coerce.number().int().min(1, "Minimum bet must be at least 1").optional(),
    // union keeps null out of z.coerce.date() — new Date(null) is 1970, not "no cutoff"
    betsCloseAt: z
      .preprocess((v) => (v === "" ? null : v), z.union([z.null(), z.coerce.date()]))
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.betsCloseAt != null && val.betsCloseAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["betsCloseAt"],
        message: "Betting close time must be in the future",
      })
    }
  })

export const placeBetSchema = z.object({
  taskId: z.string().min(1),
  choice: z.string().min(1),
  amount: z.coerce.number().int().min(1, "Bet must be at least 1 ZP"),
})

export const settleBetSchema = z.object({
  taskId: z.string().min(1),
  winningChoice: z.string().min(1),
})

export const updateBalanceSchema = z.object({
  userId: z.string().min(1),
  // Negative values allowed — settlement.ts already permits negative balances
  // via increment/decrement, so the admin path is consistent with that behavior.
  newBalance: z.number().int(),
  // No reason field — D-06 (no audit trail)
})

