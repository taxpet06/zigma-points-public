// NextAuth v5 API route handler.
// Mounts GET and POST handlers from the single auth.ts config file.
// Source: https://authjs.dev/getting-started/migrating-to-v5 (Pattern 3)
import { handlers } from "@/auth"
export const { GET, POST } = handlers
