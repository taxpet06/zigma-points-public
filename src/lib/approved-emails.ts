// Signup allowlist lookup — the single gate both registration paths call.
//
// Scope: REGISTRATION ONLY. Removing someone from the allowlist does not delete,
// disable, or sign out their account; sign-in and password reset never consult it.
// See the ApprovedEmail model in prisma/schema.prisma.
//
// Emails are stored trimmed + lowercased. normalizeEmail() is the one place that
// rule lives, so writers (admin add) and readers (signup check) cannot disagree —
// a mismatch here would silently let an unapproved address register.

import { db } from "@/lib/db"

/** Canonical storage/compare form for an email. Use for every read AND write. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** True if this email is allowed to register an account. */
export async function isEmailApproved(email: string): Promise<boolean> {
  const row = await db.approvedEmail.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true },
  })
  return row !== null
}

/** Shown to a rejected signup. Deliberately does not hint at who IS on the list. */
export const NOT_APPROVED_ERROR =
  "This email isn't approved for sign-up. Contact an admin to request access."
