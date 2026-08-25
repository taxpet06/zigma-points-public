// Join tickets — the trust boundary between the Next app and this server.
//
// The laptop must NOT try to parse NextAuth session cookies. Instead the app (or, for
// now, the CLI at the bottom of this file) mints a short-lived ticket signed with a
// secret both sides share, and this server only has to verify a signature.
//
// Format: `${userId}.${expiryMs}.${hmacHex}`
// The HMAC covers "userId.expiryMs" so neither the id nor the expiry can be edited.

import { createHmac, timingSafeEqual } from "node:crypto"

const SECRET = process.env.GAME_SERVER_SECRET ?? ""

/** Default ticket lifetime. Short — a ticket is a bearer token, it should not linger. */
export const TICKET_TTL_MS = 60 * 60 * 1000 // 1 hour

// userId lands in the ticket delimited by ".", so it must not contain one. It is also
// echoed to other players in the room, so keep it to characters that cannot smuggle
// markup or control codes.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex")
}

export function signTicket(userId: string, ttlMs = TICKET_TTL_MS, now = Date.now(), secret = SECRET): string {
  if (!secret) throw new Error("GAME_SERVER_SECRET is not set — refusing to sign an unauthenticated ticket")
  if (!USER_ID_RE.test(userId)) throw new Error(`invalid userId: ${JSON.stringify(userId)}`)
  const payload = `${userId}.${now + ttlMs}`
  return `${payload}.${mac(payload, secret)}`
}

/** Returns the userId if the ticket is well-formed, correctly signed and unexpired; else null. */
export function verifyTicket(ticket: string, now = Date.now(), secret = SECRET): string | null {
  if (!secret) return null
  const parts = ticket.split(".")
  if (parts.length !== 3) return null
  const [userId, expiryRaw, sig] = parts as [string, string, string]
  if (!USER_ID_RE.test(userId)) return null

  const expected = mac(`${userId}.${expiryRaw}`, secret)
  // Compare before checking expiry so a bad signature and a stale ticket cost the same.
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null

  const expiry = Number(expiryRaw)
  if (!Number.isFinite(expiry) || now >= expiry) return null
  return userId
}

// --- CLI: `node ticket.ts <userId> [room]` prints a join URL you can send to someone ---
if (process.argv[1]?.endsWith("ticket.ts")) {
  const userId = process.argv[2]
  const room = process.argv[3] ?? "test"
  if (!userId) {
    console.error("usage: node ticket.ts <userId> [room]")
    process.exit(1)
  }
  const base = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`
  const ticket = signTicket(userId)
  console.log(`${base}/test.html?ticket=${encodeURIComponent(ticket)}&game=tug&room=${encodeURIComponent(room)}`)
}
