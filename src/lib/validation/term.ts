// Term input validation — shared by the tRPC procedures and the admin form so both
// reject the same input.

import { z } from "zod"

const fields = {
  name: z.string().trim().min(1, "Name is required").max(60, "Keep the name under 60 characters"),
  // Coerced because <input type="datetime-local"> hands over a string.
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}

const ORDER = { message: "The end must be after the start", path: ["endsAt"] }
const endsAfterStart = (t: { startsAt: Date; endsAt: Date }) => t.endsAt > t.startsAt

export const createTermSchema = z.object(fields).refine(endsAfterStart, ORDER)

export const updateTermSchema = z
  .object({ id: z.string().min(1), ...fields })
  .refine(endsAfterStart, ORDER)

export type CreateTermInput = z.infer<typeof createTermSchema>
