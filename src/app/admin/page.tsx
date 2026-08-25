// Admin Dashboard — real admin panel (Phase 6).
//
// The real access gate is middleware.ts (T-01-06 / edge enforcement).
// requireAdmin() provides server-side defense-in-depth (Pitfall 4 / ASVS V4 / T-6-08).
//
// Security (T-6-09 Information Disclosure): db.user.findMany uses explicit select
// that NEVER includes password, accounts, or sessions fields.
// Server Component fetches users directly — avoids tRPC round-trip for initial render.

import { requireAdmin } from "@/lib/auth-helpers"
import { AdminTabs } from "@/components/admin/admin-tabs"

export default async function AdminPage() {
  await requireAdmin()

  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Admin Dashboard
      </h1>
      <AdminTabs />
    </div>
  )
}
