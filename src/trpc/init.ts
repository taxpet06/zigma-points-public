// tRPC v11 initialization — context, router factory, and procedure builders.
// Pattern 7 from RESEARCH.md.
//
// - createTRPCContext: reads the NextAuth session via auth() on every request
// - publicProcedure: open to anyone (unauthenticated calls allowed)
// - protectedProcedure: throws UNAUTHORIZED if no session user (T-01-10)

import { initTRPC, TRPCError } from "@trpc/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { downtimeState } from "@/lib/downtime"
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
export const createCallerFactory = t.createCallerFactory

/**
 * Between terms, every procedure is closed — queries included. There is no UI left to
 * serve them and no state that may move.
 *
 * This has to live HERE, not in middleware.ts, and that is not a style choice. The
 * middleware matcher excludes any path containing a dot (`.*\..*`) so PWA assets stay
 * publicly fetchable — and a tRPC path is `/api/trpc/user.getMe`. Every procedure call
 * in the app therefore sails straight past the edge gate. Someone still holding a valid
 * session cookie from before the break would keep voting, transferring ZP and playing
 * games against a site that looks shut. Gating the one builder both other procedures are
 * derived from closes all of them at once.
 */
const downtimeGate = t.middleware(async ({ ctx, next }) => {
  if ((await downtimeState()).down) {
    // ADMINS ARE EXEMPT. The break is exactly when the admin work happens — declaring
    // the term's Zigma Maxxer, marking its Zigma Poopers, re-running scoring after a
    // correction — and every one of those actions concerns a term that has already
    // ended. Gating them meant the portal went dark at the precise moment it was
    // needed, with no way back in until the next term opened.
    //
    // The exemption lives HERE rather than in the admin chain below because the admin
    // page also calls plain protectedProcedures (admin.getAllUsers,
    // admin.listApprovedEmails, term.crownHolder, term.poopHolders). Exempting only
    // adminProcedure would have unlocked the door and left half the room dark.
    //
    // This does not weaken what the gate is for: stopping ORDINARY users acting against
    // a site that looks shut — voting, transferring ZP, playing games. The role is read
    // from the DATABASE, not the JWT, so a stale ADMIN token buys nothing, and the
    // lookup only happens while the app is closed — it costs nothing when it is open.
    const userId = ctx.session?.user?.id
    if (!userId || !(await isDbAdmin(userId))) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Zigma Points is closed until the next term begins.",
      })
    }
  }
  return next()
})

/**
 * The session guard, factored out so BOTH chains below can use it — the admin chain
 * needs it without the downtime gate that sits above it in the normal chain.
 * Threat: T-01-10 — Elevation of Privilege via unauthenticated procedure call.
 */
const requireSession = t.middleware(({ ctx, next }) => {
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

export const publicProcedure = t.procedure.use(downtimeGate)

/**
 * protectedProcedure: throws UNAUTHORIZED when the caller has no valid session.
 * Narrows ctx.session so downstream procedures can safely access ctx.session.user.
 */
export const protectedProcedure = publicProcedure.use(requireSession)

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
