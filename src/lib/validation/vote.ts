// Shared Zod schemas and helpers for vote input validation.
// Single source of truth used by tRPC server-side input validation.
//
// castVoteSchema: postId + VoteType (AGREE | DISAGREE) — server-only fields excluded
// retractVoteSchema: postId only — no type needed to delete a vote
// deriveVoteState: pure helper that converts a userVote row to a UI state string

import { z } from "zod"

export const castVoteSchema = z.object({
  postId: z.string().min(1),
  type: z.enum(["AGREE", "DISAGREE"]),
})

export const retractVoteSchema = z.object({
  postId: z.string().min(1),
})

/**
 * Converts a userVote row (or null) to a UI state string.
 * Pure function — no side effects.
 */
export function deriveVoteState(
  userVote: { type: "AGREE" | "DISAGREE" } | null
): "agree" | "disagree" | "none" {
  if (!userVote) return "none"
  return userVote.type === "AGREE" ? "agree" : "disagree"
}
