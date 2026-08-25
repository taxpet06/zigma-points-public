"use client"
// Floating bottom navigation — rendered on every page while signed in (root layout).
//
// Lifted out of HomeTabs so it isn't coupled to the home page's Radix Tabs state.
// The home tabs already read `?tab=` from the URL, so plain links drive them exactly
// as the old TabsTriggers did; from any other route these links navigate home first.

import { useEffect, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Home, ArrowLeftRight, ListChecks, Users, Plus } from "lucide-react"
import { CreatePostModal } from "@/components/feed/create-post-modal"
import { normalizeTab } from "@/lib/tabs"

const TABS = [
  { value: "posts", label: "Posts", icon: Home, href: "/?tab=posts" },
  { value: "exchange", label: "Exchange", icon: ArrowLeftRight, href: "/?tab=exchange" },
  { value: "tasks", label: "Activities", icon: ListChecks, href: "/?tab=tasks" },
  { value: "people", label: "People", icon: Users, href: "/?tab=people" },
] as const

const triggerClass =
  "group flex min-w-[3rem] flex-col items-center justify-center gap-0.5 rounded-full px-3 py-2 text-[0.65rem] font-medium text-muted-foreground transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:min-w-0 sm:flex-row sm:gap-1.5 sm:px-4 sm:text-sm"

const STORE_KEY = "bottom-bar-tab"

function BottomBarNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // On home, `?tab=` is the active tab. Everywhere else (a post, an activity, a
  // profile) there is no tab of its own, so the bar keeps showing the last tab the
  // user picked — the bar never reads as inert, and it matches where "back" lands.
  const current = pathname === "/" ? normalizeTab(searchParams.get("tab")) : null
  // ponytail: sessionStorage — per-browser-tab memory, survives navigation and reload,
  // dies with the tab. Move to a cookie only if it must also survive on the server.
  useEffect(() => {
    if (current) sessionStorage.setItem(STORE_KEY, current)
  }, [current])

  // Re-read on every render (each navigation re-renders), so landing on a post picks
  // up the tab that was current when the user left home. Server snapshot is the
  // default, so SSR and first client render agree.
  const lastTab = useSyncExternalStore(
    () => () => {},
    () => {
      return normalizeTab(sessionStorage.getItem(STORE_KEY))
    },
    () => "posts",
  )

  const active = current ?? lastTab

  function renderTrigger(t: (typeof TABS)[number]) {
    const Icon = t.icon
    return (
      <Link
        key={t.value}
        href={t.href}
        scroll={false}
        aria-label={t.label}
        aria-current={active === t.value ? "page" : undefined}
        data-state={active === t.value ? "active" : "inactive"}
        className={triggerClass}
      >
        <Icon className="h-5 w-5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=active]:scale-110 group-active:scale-90" />
        <span className="leading-none">{t.label}</span>
      </Link>
    )
  }

  return (
    <>
      {/* Spacer so fixed bar never covers the end of a page's content. */}
      <div aria-hidden="true" className="h-24 shrink-0" />
      <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-sticky)] flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <div className="bottom-bar-pill pointer-events-auto flex h-auto items-center gap-0.5 rounded-full border bg-background/80 p-1.5 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:gap-1">
          {renderTrigger(TABS[0])}
          {renderTrigger(TABS[1])}
          <CreatePostModal
            trigger={
              <button
                type="button"
                aria-label="Create post or betting pool"
                className="mx-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-primary/60 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Plus className="h-6 w-6" />
              </button>
            }
          />
          {renderTrigger(TABS[2])}
          {renderTrigger(TABS[3])}
        </div>
      </nav>
    </>
  )
}

export function BottomBar() {
  const { status } = useSession()
  // ponytail: auth state alone gates the bar — sign-in/sign-up are unauthenticated,
  // so they get it for free without a route allowlist to keep in sync.
  if (status !== "authenticated") return null
  return <BottomBarNav />
}
