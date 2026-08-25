"use server"
// Server Action for user registration (AUTH-01).
// Hashes password with bcrypt (cost 12), creates a USER row, then auto signs-in.
// Pattern 8 from RESEARCH.md.
//
// Security (T-01-05, T-01-08, ASVS V2/V5/V6):
//   - Email format validated before DB query
//   - Password minimum length enforced (ASVS V2: min 8 chars)
//   - bcrypt.hash cost 12 (ASVS V6 — never store plaintext)
//   - Duplicate email returns a typed error result (not an unhandled throw)

import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { signIn } from "@/auth"
import { isEmailApproved, NOT_APPROVED_ERROR } from "@/lib/approved-emails"

// Typed error result so the form component can display validation messages
// without catching opaque thrown errors.
export type SignUpResult =
  | { success: true }
  | { success: false; error: string }

export async function signUp(formData: FormData): Promise<SignUpResult> {
  const name = (formData.get("name") as string | null)?.trim() ?? ""
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? ""
  const password = (formData.get("password") as string | null) ?? ""

  // ASVS V5: validate inputs before touching the database
  if (!name) {
    return { success: false, error: "Name is required." }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "Invalid email address." }
  }
  if (password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." }
  }

  // Signup allowlist — closed registration. Checked before the duplicate lookup so
  // an unapproved address learns nothing about which emails already have accounts.
  if (!(await isEmailApproved(email))) {
    return { success: false, error: NOT_APPROVED_ERROR }
  }

  // Check for duplicate email (409-equivalent logic)
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return { success: false, error: "An account with this email already exists." }
  }

  // ASVS V6 / T-01-08: hash with bcrypt cost 12 — never store plaintext
  const hashed = await bcrypt.hash(password, 12)

  await db.user.create({
    data: {
      email,
      password: hashed,
      name,
      role: "USER",
    },
  })

  // Auto sign-in after successful registration (redirects to /)
  // signIn throws a NEXT_REDIRECT — must NOT be caught by the form's error handler
  await signIn("credentials", { email, password, redirectTo: "/" })

  // This line is unreachable (signIn redirects), but satisfies TypeScript
  return { success: true }
}
