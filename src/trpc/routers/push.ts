// Push subscription tRPC router.
//
// Procedures:
//   subscribe   — upserts a PushSubscription row keyed by endpoint; userId always
//                 sourced from ctx.session.user.id (never from client input, same
//                 rule as createPost's authorId — T-07-01/T-07-04).
//   unsubscribe — deletes the row for a given endpoint, scoped to the session user.

import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db } from "@/lib/db"
import { subscribeSchema, unsubscribeSchema } from "@/lib/validation/push"

export const pushRouter = createTRPCRouter({
  /**
   * Upserts a device's push subscription. Keyed on endpoint (@unique) — re-subscribing
   * the same endpoint (e.g. same device, different logged-in user) reassigns ownership
   * to the current session user rather than creating a duplicate row (T-07-01).
   */
  subscribe: protectedProcedure
    .input(subscribeSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id // never from client input — same rule as createPost's authorId

      return db.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        update: { userId, p256dh: input.p256dh, auth: input.auth },
        create: { userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth },
        select: { id: true },
      })
    }),

  /**
   * Removes a device's push subscription. Scoped to the session user's id so a user
   * can never delete another user's row (same session-ownership rule as subscribe).
   * deleteMany is idempotent — a missing/already-removed row is a no-op.
   */
  unsubscribe: protectedProcedure
    .input(unsubscribeSchema)
    .mutation(async ({ ctx, input }) => {
      await db.pushSubscription.deleteMany({
        where: { endpoint: input.endpoint, userId: ctx.session.user.id }, // userId from session — never client input
      })
      return { ok: true }
    }),
})
