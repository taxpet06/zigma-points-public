// Shared Zod schema for createPost input validation.
// Single source of truth used by tRPC server-side input validation and client-side RHF validation.
//
// Important: zpAmount uses z.coerce.number() — HTML <input type="number"> delivers strings to
// react-hook-form; coerce handles string-to-number conversion on the client.
// Server-side (superjson over tRPC wire), the value arrives as a number — coerce is a no-op.
//
// Server-only fields excluded (mass-assignment guard): settled, outcome, votingEndsAt, authorId.
// These are set server-side in the createPost procedure and must never appear in client input.

import { z } from "zod"

// REGULAR posts (title + optional description + optional images, no targets, no ZP, no vote)
// share this schema rather than getting one of their own: the create form is a single
// react-hook-form instance whose flat value type would become a union under
// z.discriminatedUnion, for no validation benefit. Instead the fields only a point request
// needs are optional at the base and required back in the superRefine below, keyed on `type`.
// The REGULAR branch of createPost normalises whatever the form left behind in the hidden
// fields — the schema's job here is to stop *rejecting* a valid Regular post, not to police
// values the server is about to overwrite anyway.
export const createPostSchema = z
  .object({
    type: z.enum(["AWARD", "DEDUCT", "REGULAR"]),
    // One or more target users (M-01). Each target receives zpAmount individually on
    // settlement. Always empty for REGULAR — enforced server-side, not here.
    targetUserIds: z
      .array(z.string().min(1))
      .max(20, "A post can target at most 20 users")
      .default([]),
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(100, "Title must be 100 characters or fewer"),
    explanation: z
      .string()
      .trim()
      .max(1000, "Explanation must be 1000 characters or fewer")
      .optional(),
    zpAmount: z
      .coerce
      .number()
      .int("ZP amount must be a whole number")
      .min(1, "ZP amount must be at least 1")
      .optional(),
    mediaUrl: z.string().url().optional(),
    images: z.array(z.string().url()).max(10, "At most 10 images").optional(),
  })
  .superRefine((val, ctx) => {
    // A Regular post is title-only by definition — nothing further to require.
    if (val.type === "REGULAR") return
    if (val.targetUserIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["targetUserIds"], message: "Select at least one target user" })
    }
    if (!val.explanation) {
      ctx.addIssue({ code: "custom", path: ["explanation"], message: "Explanation is required" })
    }
    if (val.zpAmount == null) {
      ctx.addIssue({ code: "custom", path: ["zpAmount"], message: "ZP amount is required" })
    }
  })
