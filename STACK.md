# Zigma Points — Tech Stack

**Last updated:** 2026-06-13
**App type:** Social media platform with a community-driven reputation/points economy
**Team:** Solo developer
**Hosting constraint:** Free / near-free
**Language:** TypeScript throughout

## Executive Summary

Zigma Points is a web-only, responsive social platform where users award and dispute points via a community voting system. The stack is built around a single monorepo (Next.js 15) deployed to Vercel's hobby tier, with Neon for PostgreSQL, Prisma as the ORM, tRPC for type-safe data fetching, TanStack Query for client-side caching, and Supabase-free alternatives covering auth (NextAuth v5), storage (Uploadthing), and observability (Sentry). Vote settlement runs on a Vercel Cron job every N minutes. The entire stack runs at $0/month at MVP scale.

---

## Decisions

| Layer | Choice | Key Reason | Revisit When |
|---|---|---|---|
| Frontend framework | Next.js 15 (App Router) | Unified frontend + API, free Vercel hosting, SSR for feed | Building native mobile app |
| Backend | Next.js API Routes + Server Actions | No separate repo/deploy, same TS types end-to-end | Complex background processing needs grow |
| Database | Neon (PostgreSQL) | Free tier, serverless, relational schema fits perfectly | > 3GB storage or > 10k concurrent connections |
| ORM | Prisma | Ergonomic API, Studio GUI useful for debugging settlement logic | Cold start latency becomes measurable |
| Authentication | NextAuth v5 (Auth.js) | Free, Prisma adapter, JWT custom claims for admin role | Need MFA, org management, or audit logs |
| State management | TanStack Query + Zustand | Optimistic voting UX, cache invalidation, minimal UI state | Server state needs go away entirely |
| Styling | Tailwind CSS + shadcn/ui | Modern components (Card, Dialog, Table, Badge) out of the box | Unique brand identity fights shadcn defaults |
| API contract | tRPC | Type-safe from Prisma model to UI component, TanStack Query adapter | Need to expose API to third-party clients |
| File storage | Uploadthing | Built for Next.js, chunked uploads, shadcn-compatible UI, free 2GB | > 2GB storage (migrate backend to R2, keep Uploadthing DX) |
| Deployment | Vercel (Hobby) | Free, zero-config Next.js, 2 cron jobs included | > 100GB/month bandwidth or function timeout issues |
| Testing | Vitest + Playwright | Unit tests for settlement math, E2E for 3 critical paths | Team grows, coverage requirements added |
| Observability | Sentry + Vercel Analytics | Error alerting (Sentry) + usage metrics (Analytics), both free | Need structured logs or query tracing |
| Vote settlement | Vercel Cron → API route → Prisma tx | No extra infrastructure, uses included cron, atomic DB writes | Thousands of posts per settlement window (batch or pg_cron) |

---

## Full Rationale

### Next.js 15 (App Router)
Web-only, TypeScript, Vercel deployment — this is the natural fit. App Router Server Components handle initial feed rendering on the server (fast, SEO-friendly), React takes over for interactions. The backend API lives in the same codebase via API routes and Server Actions, eliminating a second repo and second deployment target for a solo dev.

### Next.js API Routes + Server Actions
Server Actions handle mutations (create post, cast vote, admin point edit). tRPC procedures handle queries (feed, post details, user balances). No separate Express/NestJS/Hono server to deploy, configure, or monitor. Vercel deploys everything as one unit.

### Neon (PostgreSQL)
The data model is inherently relational: users → posts → votes → point transactions → replies. Neon's free tier (0.5 CPU, 1GB storage) is sufficient for an MVP. Serverless connection pooling handles Next.js's ephemeral serverless function connections correctly.

### Prisma
Chosen over Drizzle for ergonomics and the Studio GUI (invaluable for debugging point balance discrepancies). The cold start overhead of Prisma's query engine is a real concern on Vercel serverless but acceptable at MVP scale. Migrate to Drizzle if cold starts become measurable.

### NextAuth v5 (Auth.js)
Free, open source, official Prisma adapter stores sessions in Neon alongside application data. Admin role stored as a custom claim in the JWT session — every server-side request has the role without extra database queries. Handles email/password + optional social OAuth.

**Admin role implementation note:** Extend the session callback to include `role` from the User table. Protect admin routes via Next.js middleware checking `session.user.role === 'ADMIN'`.

### TanStack Query + Zustand
TanStack Query manages all server state — feed posts, vote counts, point balances. Optimistic updates on voting (vote registers instantly, rolls back on failure) are handled via `useMutation` + `onMutate`. Zustand covers thin UI state: active admin tab, modal visibility, notification count. Do not use React Context for shared state — it causes full tree re-renders which hurts feed performance.

### Tailwind CSS + shadcn/ui
shadcn/ui components map directly to this app's UI needs:
- `Card` → post cards in the feed
- `Badge` → point amounts, agree/disagree counts
- `Avatar` → user profile pictures
- `Dialog` → media upload, post creation modal
- `Sheet` → reply thread panel
- `Table` → admin points/username table
- `Tabs` → regular feed / task posts tab switch

All components are copied into the codebase (not a package dependency), fully customizable.

### tRPC
Defines typed procedures for all data-fetching operations. The `@trpc/tanstack-react-query` adapter means TanStack Query calls tRPC procedures natively — no manual `fetch()` calls, no type casting. Type errors surface at the tRPC router layer when the Prisma schema changes.

**Key routers to define:** `post.list`, `post.getById`, `user.getBalance`, `vote.getForPost`, `task.list`, `admin.users`, `admin.updatePoints`.

### Uploadthing
Handles image, video, and GIF uploads for posts and replies. Define a file router with two endpoints: `postMedia` (images + short videos, authenticated users) and `taskAttachments` (same, admin only). The React `<UploadButton>` component integrates with shadcn styling. When storage exceeds 2GB free tier, configure Uploadthing to use a Cloudflare R2 bucket as the backend — no code changes needed.

### Vercel (Hobby)
Zero-config Next.js deployment, automatic SSL, global CDN. Two cron jobs included — one for vote settlement, one reserved. Push to `main` branch = automatic production deploy. Preview deployments on feature branches for testing before merge.

**Function timeout note:** Hobby tier limits serverless functions to 10 seconds. The vote settlement API route must process posts in batches (max 50 per invocation) to stay within this limit.

### Vitest + Playwright
**Vitest covers:**
- Vote settlement math (agree threshold logic, point calculation, edge cases: ties, zero votes, negative point requests)
- Point balance mutation logic (can't go below 0, max point request validation)
- Admin permission guards

**Playwright covers (3 flows only):**
1. User creates a point-award post → post appears in feed
2. Votes are cast → settlement runs → point balances update correctly
3. Admin edits a user's point balance → change persists and reflects in user's profile

### Sentry + Vercel Analytics
Sentry: install `@sentry/nextjs`, configure in `instrumentation.ts`. Set up an alert for any new error type in the vote settlement route specifically — that's the most financially impactful failure mode. Free tier: 5,000 errors/month.

Vercel Analytics: enable in Vercel dashboard, one line in `layout.tsx`. Tracks page views and Web Vitals — useful for catching mobile performance regressions.

### Vote Settlement (Vercel Cron → API Route)
**Flow:**
1. Vercel Cron fires on schedule (e.g., `*/15 * * * *` — every 15 minutes)
2. Hits `POST /api/internal/settle-votes` with a `Authorization: Bearer {CRON_SECRET}` header
3. Route queries Neon for posts where `votingEndsAt < NOW()` AND `settled = false`, limited to 50
4. For each post: count agrees and disagrees. If `agrees > disagrees` → award the requested points. If `disagrees >= agrees` → award nothing (or deduct, per product rules). 
5. Update `User.zigmaPoints` and set `Post.settled = true` in a single Prisma transaction
6. Return a summary for Sentry logging

**CRON_SECRET** stored as a Vercel environment variable, checked in the API route before any processing.

---

## What We Deferred and Why

| Deferred | Reason |
|---|---|
| Native mobile app | Web-only scope; responsive design covers mobile use. Revisit if users demand it. |
| WebSocket real-time feed | Replaced by TanStack Query polling or manual refetch on focus. Supabase Realtime would have given this for free but Neon doesn't. Add if feed staleness becomes a UX complaint. |
| Cloudflare R2 (storage) | Uploadthing's 2GB free tier is sufficient for MVP. R2 is the natural upgrade path and Uploadthing supports it natively. |
| pg_cron for settlement | More reliable than HTTP cron but requires Neon extension setup. Upgrade path if settlement reliability becomes an issue. |
| Rich text editor for posts | Posts are plain text + media. A rich text editor (Tiptap, Lexical) adds complexity without clear user benefit at MVP. |
| Email notifications | Out of scope for MVP. Add Resend (free tier: 100 emails/day) when notifications are prioritized. |
| Rate limiting | Add Upstash Redis (free tier) for rate limiting post creation and voting when abuse becomes a real concern. |

---

## Red Flags to Watch For

- **Prisma cold starts become noticeable** — users complain about first-load latency > 2 seconds. Migrate to Drizzle or add connection pooling via PgBouncer on Neon.
- **Vote settlement times out** — the Vercel function logs show 10s timeout errors. Reduce batch size to 20 posts and add a `lastSettledAt` cursor so runs resume correctly.
- **Uploadthing storage approaching 2GB** — dashboard alert at 1.5GB. Configure R2 bucket as Uploadthing backend before hitting the limit.
- **Sentry error volume spikes after a deploy** — roll back immediately, the settlement or points logic is likely broken.
- **Admin panel accessible to non-admins** — the middleware role check is the single most important security gate. Add a Playwright test specifically for this.
- **Point balances going negative or behaving unexpectedly** — the Prisma transaction in settlement is not correctly atomic. Review the `$transaction` block and add a Vitest regression test for the failing case.
