// tRPC v11 initialization — context, router factory, and procedure builders.
// Pattern 7 from RESEARCH.md.
//
// - createTRPCContext: reads the NextAuth session via auth() on every request
// - publicProcedure: open to anyone (unauthenticated calls allowed)
// - protectedProcedure: throws UNAUTHORIZED if no session user (T-01-10)

import { initTRPC, TRPCError } from "@trpc/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import superjson from "superjson"

/**
 * Creates the tRPC context for each request.
 * Called by the HTTP route handler and the server-side caller.
 */
export const createTRPCContext = async () => {
  const session = await auth()
  return { session }
}

type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
})

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory

/**
 * protectedProcedure: throws UNAUTHORIZED when the caller has no valid session.
 * Narrows ctx.session so downstream procedures can safely access ctx.session.user.
 * Threat: T-01-10 — Elevation of Privilege via unauthenticated procedure call.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  return next({
    ctx: {
      ...ctx,
      // session narrowed to non-null after the guard above
      session: ctx.session,
    },
  })
})

/**
 * adminProcedure: protectedProcedure + role re-read from the DB.
 *
 * The session role lives in a JWT (auth.ts), so it is a SNAPSHOT taken at sign-in:
 * a user demoted from ADMIN keeps a token that still claims ADMIN until it expires.
 * Trusting `ctx.session.user.role` alone is therefore a standing privilege-escalation
 * window. This re-reads `user.role` from the database on every privileged call, so
 * revocation is immediate and a stolen/stale token buys nothing.
 *
 * One extra indexed PK lookup per admin mutation — admin actions are rare, the
 * check is not on any hot path.
 */
/**
 * The same DB-verified role read, for procedures whose admin requirement is
 * CONDITIONAL and so can't be expressed as a procedure-level gate —
 * task.createTask (STANDARD is admin-only, BET is not) is the one caller.
 * Everything unconditionally privileged should use adminProcedure below instead.
 */
export async function isDbAdmin(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === "ADMIN"
}

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await isDbAdmin(ctx.session.user.id))) {
    // Same code + message whether the caller is a non-admin or a deleted user —
    // no oracle for probing which account ids exist.
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." })
  }
  return next({ ctx })
})
