// Shared Zod schema for the push.subscribe mutation input.
// endpoint must be a valid URL; p256dh/auth are the browser-generated subscription
// keys (opaque strings) and are only checked for non-emptiness.

import { z } from "zod"

export const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
})

// unsubscribe only needs the endpoint — reuse the validator, don't redefine it.
export const unsubscribeSchema = subscribeSchema.pick({ endpoint: true })
