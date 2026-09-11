// Shared Zod schema for username validation.
// Single source of truth used by tRPC input validation and client-side RHF validation.
// Rules (Claude's discretion, per D-03): lowercase alphanumeric + underscores, 3-20 chars.
// Must start and end with a letter or number (no leading/trailing underscores like _admin or user_).

import { z } from "zod"

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username cannot exceed 20 characters")
  .regex(
    /^[a-z0-9]([a-z0-9_]*[a-z0-9])?$/,
    "Only lowercase letters, numbers, and underscores allowed; must start and end with a letter or number"
  )
