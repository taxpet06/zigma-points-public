// TypeScript module augmentation for NextAuth v5.
// Adds `role` and `id` to Session.user, User, and JWT without type casting.
//
// IMPORTANT: This file must live at the project root (NOT inside src/).
// It is picked up by tsconfig.json's "**/*.ts" include glob.
//
// Source: https://authjs.dev/getting-started/typescript (verified 2026-06-13)
// Pitfall 3: Do NOT use `satisfies AuthConfig` in auth.ts — it breaks this augmentation.

import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      role: string
      id: string
    } & DefaultSession["user"]
  }

  interface User {
    role: string
    id: string
    password?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string
    id?: string
  }
}
