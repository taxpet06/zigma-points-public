// Server-side session + role guard helpers.
// These are the re-check primitives for Server Components, Server Actions, and
// tRPC procedures (Pitfall 4 — middleware is the first gate, not the only gate).
//
// AUTH-04: requireAdmin() enforces ADMIN-only access server-side, complementing
// the edge middleware check in middleware.ts.

import { redirect } from "next/navigation"
import { auth } from "@/auth"

/**
 * Assert that a valid session exists. Redirects to /sign-in if not signed in.
 * Use at the top of any Server Component or Server Action that requires auth.
 */
export async function requireSession() {
  const session = await auth()
  if (!session?.user) {
    redirect("/sign-in")
  }
  return session
}

/**
 * Assert that the signed-in user has the ADMIN role.
 * Redirects to / if not signed in or not an admin.
 * Use inside any Server Component, Server Action, or tRPC procedure that is
 * restricted to admins — the middleware edge check is NOT sufficient alone.
 * T-01-06 mitigation (ASVS V4 — dual enforcement).
 */
export async function requireAdmin() {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/")
  }
  return session
}
