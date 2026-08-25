"use client"
// Navigation shell header — shown on every page (Success Criterion 4).
//
// Signed-in state: app name link + ZP balance badge + user dropdown (email + sign-out).
//   Admin users also see an /admin link.
// Signed-out state: app name link + Sign in / Sign up links.
//
// Security (T-01-11): /admin link is DECORATIVE — the real access gate is middleware.ts.
// useTRPC user.getMe is used to read the live DB balance so it stays current after
// point transfers (future phases). useSession is used for auth state and role display.

import Link from "next/link"
import { useSession, signOut } from "next-auth/react"
import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/cosmetics/user-avatar"
import { ZpLogo } from "@/components/nav/zp-logo"
import { TermCountdown } from "@/components/nav/term-countdown"
import { navItemClass, navButtonClass } from "@/components/nav/nav-item"
import { cn } from "@/lib/utils"
import { UserCircle, Gamepad2, Store } from "lucide-react"

export function Header() {
  const { data: session, status } = useSession()
  const trpc = useTRPC()

  // Fetch the current user's DB record for live ZP balance (protectedProcedure).
  // Poll every 60s so the balance stays current after cron settlements and admin edits.
  const { data: me, isLoading: meLoading } = useQuery(
    trpc.user.getMe.queryOptions(undefined, {
      enabled: status === "authenticated",
      refetchInterval: 60_000,
    })
  )

  // Drives the ping on the game-hub button. ponytail: slots is the only game, so a
  // spin is the only "something waiting" signal — generalise if more games earn dots.
  const { data: rewardStatus } = useQuery(
    trpc.dailyReward.getStatus.queryOptions(undefined, {
      enabled: status === "authenticated",
    })
  )
  const spinAvailable = rewardStatus?.claimedToday === false

  const isAdmin = session?.user?.role === "ADMIN"

  return (
    <header className="border-b bg-background sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Left: app logo (ZP monogram) */}
        <Link
          href="/"
          aria-label="Zigma Points — home"
          className="flex items-center -ml-0.5"
        >
          <ZpLogo className="h-7 w-auto" />
        </Link>

        {/* Right: auth-aware actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {status === "loading" && (
            <div className={cn(navItemClass, "w-24 animate-pulse bg-muted")} />
          )}

          {status === "authenticated" && session?.user && (
            <>
              {/* ZP balance */}
              {/* Readout, not a control: wears the same outline as its neighbours but
                  stays hover-less so it never reads as pressable. */}
              {meLoading ? (
                <div
                  className={cn(navItemClass, "w-[4.5rem] animate-pulse bg-muted")}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className={cn(
                    navItemClass,
                    "shrink-0 px-2.5 font-mono text-xs font-medium tabular-nums text-foreground sm:px-3 sm:text-sm"
                  )}
                >
                  {me?.zigmaPoints ?? 0} ZP
                </span>
              )}

              {/* Time left in the current term — ticks client-side (see the component) */}
              <TermCountdown enabled={status === "authenticated"} />

              <Link
                href="/game-hub"
                aria-label="Game hub"
                className={cn(navButtonClass, "relative")}
              >
                <Gamepad2 className="h-5 w-5" aria-hidden="true" />
                {/* Ping while today's spin is still up for grabs */}
                {spinAvailable && (
                  <>
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                  </>
                )}
              </Link>

              <Link href="/shop" aria-label="Shop" className={navButtonClass}>
                <Store className="h-5 w-5" aria-hidden="true" />
              </Link>

              {/* The avatar IS the menu trigger — one target instead of an avatar link
                  with a chevron button beside it. Profile moved into the menu, so the
                  page is still one tap away and the header lost a button. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={navButtonClass} aria-label="Account menu">
                    {/* The photo is the icon, wrapped with the user's equipped ring.
                        Falls back to UserCircle (not initials) per the profile's D-11. */}
                    <UserAvatar
                      userId={me?.id}
                      image={me?.image}
                      name={me?.name}
                      ring={me?.equippedRing}
                      size={28}
                      fallback={<UserCircle className="h-5 w-5" aria-hidden="true" />}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal truncate">
                    {session.user.email ?? "—"}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link href="/profile">Profile</Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link href="/admin">Admin</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onSelect={() => signOut({ callbackUrl: "/sign-in" })}
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {status === "unauthenticated" && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
