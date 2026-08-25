// IMPORTANT: This module MUST only be imported from Node.js-runtime contexts
// (tRPC mutations and the cron Route Handler). nodemailer is NOT edge-compatible
// and will fail if imported in middleware or edge routes.

import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"

// Lazily memoized transport — created on first use, reused on all subsequent calls.
let _transport: Transporter | null = null

function getTransport(): Transporter {
  if (_transport) return _transport
  _transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
  return _transport
}

/**
 * Fail-soft email sender.
 *
 * - Returns immediately (with a console.warn) if GMAIL_USER or GMAIL_APP_PASSWORD is missing.
 * - Catches and warns on any SMTP transport error without re-throwing.
 * - The caller must NEVER see an exception — notifications must never break a mutation or settlement.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<void> {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn(
      "[email] GMAIL_USER or GMAIL_APP_PASSWORD is not set — email not sent. " +
        "Set these in .env.local to enable email notifications.",
    )
    return
  }

  try {
    await getTransport().sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
      headers: {
        // Signals to spam filters that recipients can opt out
        "List-Unsubscribe": `<mailto:${process.env.GMAIL_USER}?subject=unsubscribe>`,
      },
    })
  } catch (err) {
    console.warn("[email] Failed to send email via Gmail SMTP:", err)
  }
}
