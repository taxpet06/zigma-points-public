// Shared Zod schema for createReply input validation.
// Single source of truth used by tRPC server-side input validation and client-side state.
//
// Server-only fields excluded (mass-assignment guard): authorId.
// authorId is set server-side in the createReply procedure — never from client input.
//
// Phase 6 extension (D-02): postId is now optional; taskId added (also optional).
// Exactly one of postId or taskId must be provided (XOR refine).

import { z } from "zod"

export const createReplySchema = z
  .object({
    postId: z.string().min(1).optional(), // was required — now optional for task replies (D-02)
    taskId: z.string().min(1).optional(), // new field (D-02)
    parentId: z.string().min(1).optional(),
    content: z
      .string()
      .trim()
      .min(1, "Reply cannot be empty")
      .max(1000, "Reply must be 1000 characters or fewer"),
    mediaUrl: z.string().url().optional(),
  })
  .refine(
    (data) => !!data.postId !== !!data.taskId, // XOR: exactly one must be set
    { message: "Exactly one of postId or taskId must be provided." }
  )
