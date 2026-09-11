// Next.js edge middleware — auth gate + admin role guard.
// Pattern 4 from RESEARCH.md.
//
// AUTH-04: Non-ADMIN users are redirected away from /admin*.
// Unauthenticated users are redirected to /sign-in (except /sign-in and /sign-up).
// AUTH-03: Authenticated users are redirected away from /sign-in and /sign-up to /
// so a valid session never re-renders the auth forms (e.g. via browser back button).
//
// Security notes:
//   - T-01-06: middleware is the FIRST gate; requireAdmin() in Server Components
//     and tRPC procedures is the SECOND gate (Pitfall 4 — defense in depth).
//   - matcher excludes /api/auth/* (NextAuth's own handlers must be unrestricted)
//     and Next.js static internals. Other /api/* routes ARE covered so API-level
//     admin checks still pass through requireAdmin() on the server.

import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"
import { NextResponse } from "next/server"
import { downtimeState } from "@/lib/downtime"

export default NextAuth(authConfig).auth(async (req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const isAdmin = req.auth?.user?.role === "ADMIN"

  // Between terms the whole site collapses to one static page. This runs BEFORE every
  // auth branch below, so a signed-out visitor lands on /downtime rather than /sign-in
  // and a signed-in one gets no further than a signed-out one — an existing session
  // cookie stays valid, it just has nowhere to go. Minting a NEW one is blocked in
  // auth.ts, which is the gate that survives someone POSTing straight at /api/auth
  // (excluded from the matcher below, so it never reaches this file).
  //
  // Redirects go ONE WAY only. downtimeState() caches per isolate, so during the minute
  // around a term boundary two isolates can disagree — and a matching "/downtime -> /"
  // redirect for the open case would then bounce a browser between them until it gave up
  // with ERR_TOO_MANY_REDIRECTS, at every term start and end. With only the inbound
  // redirect there is no cycle to enter: once open, /downtime is an ordinary page that
  // says so (app/downtime/page.tsx).
  const { down } = await downtimeState()
  if (down) {
    // Pass through, not redirect — /downtime must also skip the auth gate below, which
    // would otherwise bounce a signed-out visitor to /sign-in and never show the page.
    if (pathname === "/downtime") return NextResponse.next()
    // Admins keep the portal during the break — declaring a term's Maxxer, marking its
    // Poopers and re-running scoring all happen AFTER the term has ended, so locking
    // /admin at the same instant the term closed shut the door on the only work left
    // to do. This is a redirect decision made on the JWT's role claim, which may be a
    // stale snapshot; that is fine, because it only gets a page to render. Every
    // privileged action behind it re-reads the role from the database (adminProcedure
    // in trpc/init.ts), so a demoted admin can look but cannot act.
    if (isAdmin && pathname.startsWith("/admin")) return NextResponse.next()
    return NextResponse.redirect(new URL("/downtime", req.url))
  }

  // Auth pages: redirect logged-in users away, otherwise allow through
  if (
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password")
  ) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  // Redirect unauthenticated users to sign-in
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/sign-in", req.url))
  }

  // AUTH-04: block non-admins from /admin routes (T-01-06)
  if (pathname.startsWith("/admin") && !isAdmin) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  return NextResponse.next()
})

export const config = {
  // Exclude NextAuth's own handlers, cron routes (secured by CRON_SECRET instead),
  // uploadthing (see below), test-only routes (see below), and Next.js static
  // assets. All other routes (pages + /api/*) are covered — admin tRPC still
  // re-checks server-side via requireAdmin() (Pitfall 4 compliance).
  //
  // api/test/* MUST be excluded too. These are E2E-only debug endpoints
  // (seed-balance, seed-post, approve-email) that fixtures call BEFORE a
  // session exists — e.g. approve-email must run pre-signup, so there is no
  // cookie yet to satisfy the auth gate. This is not a hole: every api/test/*
  // route self-gates with `if (process.env.VERCEL_ENV) return 404`, so none
  // of them are reachable in any Vercel environment (preview or production) —
  // same shape as the api/cron exclusion above.
  //
  // api/uploadthing MUST be excluded. Uploadthing calls it back server-to-server
  // after a file lands; that request carries an HMAC signature, never a session
  // cookie. Gated here, the callback gets redirected to /sign-in and the SDK fails
  // with "Decode error (200 POST /api/uploadthing)" — onUploadComplete never runs
  // and the avatar URL is never written to the user row. This is not a hole: the
  // browser-facing upload is gated by auth() inside avatarUploader.middleware()
  // (T-02-01), and the callback is authenticated by its signature against
  // UPLOADTHING_TOKEN. Same shape as the api/cron exclusion above.
  //
  // `.*\\..*` excludes any path with a file extension (sw.js, manifest.webmanifest,
  // icon-*.png, apple-icon.png, icon.svg, favicon.ico). These PWA assets MUST be
  // publicly reachable: the browser fetches the manifest + icons WITHOUT credentials
  // during install, so gating them behind auth redirects the fetch to /sign-in and
  // Chrome then refuses to install the app (falls back to a plain home-screen
  // shortcut). Static files carry no secrets; pages + /api/* (no dot) stay gated.
  matcher: ["/((?!api/auth|api/cron|api/uploadthing|api/test|_next/static|_next/image|.*\\..*).*)"],
}
