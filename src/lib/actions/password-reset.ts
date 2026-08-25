"use server"
// Password reset flow (AUTH-05).
//
// Reuses the existing VerificationToken table (identifier = email, token = SHA-256
// hash of the raw token, expires = +1h) so no schema migration is needed. The raw
// token travels only in the emailed link; only its hash is stored, so a DB leak
// can't be replayed into a reset.
//
// Security:
//   - No user enumeration: requestPasswordReset always returns { success: true },
//     whether or not the email maps to an account.
//   - 32 bytes of CSPRNG entropy → SHA-256 is sufficient (no bcrypt needed for a
//     high-entropy, single-use, short-lived token).
//   - Requesting a reset invalidates any prior outstanding token for that email.
//   - bcrypt cost 12 for the new password (matches signUp).

import crypto from "crypto"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { sendEmail } from "@/lib/email"

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export async function requestPasswordReset(
  formData: FormData,
): Promise<{ success: true }> {
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? ""

  // Validate format, but never reveal whether the account exists.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const user = await db.user.findUnique({ where: { email } })
    if (user) {
      // Invalidate any prior outstanding reset token for this email.
      await db.verificationToken.deleteMany({ where: { identifier: email } })

      const rawToken = crypto.randomBytes(32).toString("hex")
      await db.verificationToken.create({
        data: {
          identifier: email,
          token: hashToken(rawToken),
          expires: new Date(Date.now() + TOKEN_TTL_MS),
        },
      })

      const url = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}`
      await sendEmail({
        to: email,
        subject: "Reset your Zigma Points password",
        text: `Reset your password using this link (valid for 1 hour):\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Reset your password using the link below (valid for 1 hour):</p><p><a href="${url}">Reset password</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
      })
    }
  }

  return { success: true }
}

export type ResetPasswordResult =
  | { success: true }
  | { success: false; error: string }

export async function resetPassword(
  token: string,
  password: string,
): Promise<ResetPasswordResult> {
  if (password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." }
  }

  const record = await db.verificationToken.findFirst({
    where: { token: hashToken(token) },
  })

  if (!record || record.expires < new Date()) {
    return { success: false, error: "This reset link is invalid or has expired." }
  }

  const hashed = await bcrypt.hash(password, 12)
  await db.user.update({
    where: { email: record.identifier },
    data: { password: hashed },
  })

  // Single-use: consume the token so the link can't be replayed.
  await db.verificationToken.deleteMany({ where: { identifier: record.identifier } })

  return { success: true }
}
