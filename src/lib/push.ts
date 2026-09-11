// IMPORTANT: This module MUST only be imported from Node.js-runtime contexts
// (tRPC mutations and the cron Route Handler). web-push uses Node's built-in
// crypto/Buffer internals — NOT edge-compatible.

import webpush from "web-push"
import { db } from "@/lib/db"

// Lazily memoized VAPID configuration — set up on first use, reused on all subsequent calls.
let configured = false

function ensureConfigured(): boolean {
  if (configured) return true
  if (
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.VAPID_SUBJECT
  ) {
    console.warn(
      "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT is not set — " +
        "push not sent. Set these in .env.local to enable push notifications.",
    )
    return false
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT, // must be "mailto:..." — web-push throws otherwise
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
  configured = true
  return true
}

/**
 * Fail-soft push sender.
 *
 * - Returns immediately (with a console.warn) if any VAPID env var is missing.
 * - Sends to every PushSubscription row for userId.
 * - On statusCode 410 (Gone) or 404 (Not Found), the dead subscription row is deleted.
 * - The caller must NEVER see an exception — notifications must never break a mutation or settlement.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url: string },
): Promise<void> {
  if (!ensureConfigured()) return

  const subs = await db.pushSubscription.findMany({ where: { userId } })

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        )
      } catch (err) {
        // web-push throws WebPushError with .statusCode — 410 Gone / 404 Not Found
        // both mean "this subscription is dead, prune it" (web-push-libs/web-push#237).
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          await db.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {})
        } else {
          console.warn("[push] send failed:", err)
        }
      }
    }),
  )
}
