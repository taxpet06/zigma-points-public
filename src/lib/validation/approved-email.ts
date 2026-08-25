// Signup allowlist input validation (admin.addApprovedEmail).
// Shared by the tRPC procedure and the admin form so both reject the same input.

import { z } from "zod"

export const approvedEmailSchema = z.object({
  // Normalization to lowercase happens in normalizeEmail() at the write, not here —
  // one place owns that rule (see lib/approved-emails.ts).
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
})

export type ApprovedEmailInput = z.infer<typeof approvedEmailSchema>
