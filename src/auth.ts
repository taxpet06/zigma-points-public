// NextAuth v5 configuration — single source of truth for auth.
// Exports handlers (for API route), auth (universal session accessor),
// signIn, signOut (for server actions / forms).
//
// Sources:
//   https://authjs.dev/getting-started/adapters/prisma
//   https://authjs.dev/getting-started/migrating-to-v5
//   https://authjs.dev/getting-started/typescript
//
// IMPORTANT: Do NOT add "satisfies" type narrowing on the config — it breaks TypeScript
// module augmentation (see RESEARCH.md Pitfall 3 / nextauthjs/next-auth#9253).

import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { db } from "@/lib/db"
import { downtimeState } from "@/lib/downtime"
import bcrypt from "bcryptjs"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db as never),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // ASVS V5: validate input BEFORE hitting the database
        if (!credentials?.email || typeof credentials.email !== "string") {
          return null
        }
        if (!credentials?.password || typeof credentials.password !== "string") {
          return null
        }
        const email = credentials.email.trim().toLowerCase()
        // Basic email format check (ASVS V5 input validation)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return null
        }
        if (credentials.password.length < 1) {
          return null
        }

        const user = await db.user.findUnique({
          where: { email },
        })

        if (!user || !user.password) return null

        // ASVS V2: bcrypt.compare is timing-safe (T-01-05)
        const valid = await bcrypt.compare(credentials.password, user.password)
        if (!valid) return null

        return user
      },
    }),
  ],
  callbacks: {
    // Between terms, nobody signs in — not even an admin. Middleware already bounces
    // /sign-in to /downtime, but that only hides the form; this is the gate that holds
    // against a direct POST to /api/auth/callback/credentials, which the middleware
    // matcher deliberately excludes. It sits on signIn rather than inside authorize()
    // so every provider added later inherits it for free.
    //
    // Scope, precisely: this covers AUTHENTICATION only. The other things under
    // /api/auth are equally unreachable by middleware and each carries its own gate —
    // api/auth/register (a plain route handler that never calls signIn) and the signUp
    // and password-reset Server Actions.
    //
    // ADMINS ARE EXEMPT. Everything that lets an admin work through a break — /admin in
    // middleware, the exempt tRPC gate, the Reopen button on the closed door — needs a
    // valid session to reach. Blocking sign-in meant one expired cookie, one cleared
    // browser or one different device locked the only people who can reopen the app out
    // of it for the whole interim, with `npm run db:studio:prod` as the sole way back.
    //
    // The role is re-read from the DATABASE, not taken from the credentials payload:
    // `user` here is whatever authorize() returned, and this decision must not be
    // spoofable by anything a caller controls.
    async signIn({ user }) {
      if (!(await downtimeState()).down) return true
      if (!user?.id) return false
      const row = await db.user.findUnique({ where: { id: user.id }, select: { role: true } })
      return row?.role === "ADMIN"
    },
    // AUTH-04: copy user.role into the JWT so it persists across requests
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role
        // Also persist the user id — tRPC getMe (Plan 4) uses it for DB lookups
        token.id = user.id
      }
      return token
    },
    // AUTH-03: JWT session — expose role and id on the session object
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string
        // Copy token.sub (NextAuth sets this) and our explicit token.id
        session.user.id = (token.id ?? token.sub) as string
      }
      return session
    },
  },
})
