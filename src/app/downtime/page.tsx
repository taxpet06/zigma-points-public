// The closed door. Between terms this is the only page on the site — middleware
// redirects every other path here, and redirects this path back to / the moment a term
// is running again (see middleware.ts), so it is never reachable while the app is open.
//
// No client JS by design: no countdown ticking down, no session, no queries. The root
// layout strips the app chrome for this page and the backdrop is server-rendered CSS,
// so what ships is markup and a stylesheet. Nothing here can change state, which is the
// whole point of downtime.
//
// The ONE exception is the admin reopen button, mounted only when the viewer is an
// admin. Everyone else still gets the JS-free page above; an admin gets the way back in
// without having to find a URL that middleware is redirecting away from.

import type { Metadata } from "next"
import Link from "next/link"
import { ZpLogo } from "@/components/nav/zp-logo"
import { RESET_TZ } from "@/lib/day-key"
import { downtimeState } from "@/lib/downtime"
import { auth } from "@/auth"
import { ReopenButton } from "@/components/admin/reopen-button"

export const metadata: Metadata = {
  title: "Zigma Points — Back next term",
  // A closed door is not what anyone should find in search while the app is live again.
  robots: { index: false, follow: false },
}

// RESET_TZ, not the visitor's zone: a term opens at a wall-clock moment in the same
// zone every daily reset already keys off, and a server-rendered page has no way to know
// the reader's anyway. Naming the zone in the output is what keeps that honest.
const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: RESET_TZ,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
})
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: RESET_TZ,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
})

export default async function DowntimePage() {
  const { down, nextStartsAt, nextName } = await downtimeState()
  // Role from the session is a JWT snapshot, which is fine for deciding whether to
  // RENDER a button: admin.setDowntime re-reads the role from the database, so a
  // demoted admin sees the button and gets FORBIDDEN if they press it.
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"

  // Reachable while the app is open, because middleware deliberately has no redirect in
  // that direction (see middleware.ts — a matching one loops at term boundaries). Say so
  // and point home rather than showing a closed door over a running app.
  if (!down) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-medium">Zigma Points is open.</p>
          <Link href="/" className="text-primary mt-2 inline-block text-sm underline">
            Go to the feed
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="animate-card-rise w-full max-w-md text-center">
        <ZpLogo className="mx-auto h-14 w-auto" />

        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-balance">
          Zigma Points is closed
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-pretty">
          The term is over. Points are frozen, the feed is locked, and nothing settles
          until the next term begins.
        </p>

        {nextStartsAt ? (
          <div className="border-border/70 bg-card/60 mt-10 rounded-xl border p-6 backdrop-blur-sm">
            <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
              {nextName ? `${nextName} opens` : "Back on"}
            </p>
            <p className="mt-3 font-mono text-lg leading-snug font-medium">
              {dateFmt.format(nextStartsAt)}
            </p>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              {timeFmt.format(nextStartsAt)}
            </p>
          </div>
        ) : (
          <div className="border-border/70 bg-card/60 mt-10 rounded-xl border p-6 backdrop-blur-sm">
            <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
              Next term
            </p>
            <p className="mt-3 text-lg leading-snug font-medium">Not scheduled yet</p>
            <p className="text-muted-foreground mt-1 text-sm text-pretty">
              Check back soon — the date goes up here as soon as it is set.
            </p>
          </div>
        )}

        {isAdmin && <ReopenButton />}

        <p className="text-muted-foreground/70 mt-10 text-xs">
          See you next term.
        </p>
      </div>
    </div>
  )
}
