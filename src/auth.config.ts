// Edge-compatible NextAuth config — no Prisma adapter, no Node.js-only modules.
// Used exclusively by middleware.ts which runs on the Edge Runtime.
// The full config (with PrismaAdapter + bcrypt) lives in src/auth.ts.

import type { NextAuthConfig } from "next-auth"
import Credentials from "next-auth/providers/credentials"

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/sign-in",
  },
  // Credentials stub: authorize always returns null here.
  // Real credential validation happens in src/auth.ts (Node.js runtime only).
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async () => null,
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role
        token.id = user.id
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string
        session.user.id = (token.id ?? token.sub) as string
      }
      return session
    },
  },
}
