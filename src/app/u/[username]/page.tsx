// /u/[handle] — Public profile server component.
//
// The [username] segment accepts either a claimed username OR a user id, so every
// user has a reachable profile whether or not they've claimed a username.
//
// Security:
//   T-02-11 — explicit select: never returns password or email (Information Disclosure)
//   T-02-12 — Prisma parameterizes the where clause; unknown handle -> notFound() (Tampering)
//
// Next.js 15: params is a Promise — must await (Pitfall 3 in RESEARCH.md).

import { notFound } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { UserCircle, Pencil, Trophy } from "lucide-react"
import { PostHistoryTabs } from "@/components/profile/post-history-tabs"
import { CardBackground } from "@/components/cosmetics/card-background"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { TitleChip } from "@/components/cosmetics/title-chip"
import { CrownBadge, MAXXER_GOLD } from "@/components/cosmetics/crown-badge"
import { MaxxerTrophy, PooperTally, POOPER_BROWN } from "@/components/cosmetics/maxxer-trophy"
import { PoopBadge } from "@/components/cosmetics/poop-badge"
import { poopHolderIds } from "@/lib/terms"

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username: handle } = await params // REQUIRED in Next.js 15 — Pitfall 3

  const session = await auth()

  // T-02-11: explicit select — never password or email.
  // Resolve by username first, falling back to id, so usernameless users are reachable.
  const user = await db.user.findFirst({
    where: { OR: [{ username: handle }, { id: handle }] },
    select: {
      id: true,
      name: true,
      image: true,
      bio: true,
      zigmaPoints: true,
      username: true,
      equippedBackground: true,
      equippedRing: true,
      equippedTitle: true,
      hasCrown: true,
      // Every term this user was the Zigma Maxxer for. The count is the trophy tally
      // and the names are the "26S Zigma Maxxer" badges — one query, both jobs.
      termsWon: { select: { id: true, name: true }, orderBy: { startsAt: "desc" } },
      termPoopers: { select: { termId: true } },
    },
  })

  if (!user) notFound()

  // The mirror of termsWon. TermPooper.termId is a plain column (no relation), so the
  // term names are a second lookup.
  const [termsPooped, poopHolders] = await Promise.all([
    db.term.findMany({
      where: { id: { in: user.termPoopers.map((p) => p.termId) } },
      select: { id: true, name: true },
      orderBy: { startsAt: "desc" },
    }),
    poopHolderIds(),
  ])

  const isOwner = session?.user?.id === user.id

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Profile header card */}
      <Card className="mb-6 relative overflow-hidden isolate">
        <CardBackground variant={user.equippedBackground} />
        {user.equippedBackground && (
          <div className="absolute inset-0 z-[1] bg-background/30" />
        )}
        <MaxxerTrophy count={user.termsWon.length} />
        <PooperTally count={termsPooped.length} />

        {/* The tally takes the top-left corner the avatar sits in, so the content drops
            clear of it — far enough that a crown or 💩 on the avatar still fits. */}
        <CardContent className={`${termsPooped.length > 0 ? "pt-[4.5rem]" : "pt-6"} relative z-10`}>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* Avatar — h-20 w-20 per UI-SPEC Spacing */}
            {/* Crown outside AvatarRing so it stacks above the ring's own
                decorations — see the note in user-avatar.tsx. */}
            <div className="relative inline-flex shrink-0">
              {user.hasCrown && <CrownBadge size={80} />}
              {/* Never both — see user-avatar.tsx. */}
              {!user.hasCrown && poopHolders.includes(user.id) && <PoopBadge size={80} />}
              <AvatarRing variant={user.equippedRing}>
                <Avatar className="h-20 w-20 shrink-0">
                  <AvatarImage
                    src={user.image ?? undefined}
                    alt={`${user.name ?? user.username ?? "User"}'s profile photo`}
                  />
                  <AvatarFallback>
                    {/* D-11: UserCircle fallback — NO initials */}
                    <UserCircle
                      className="h-full w-full text-muted-foreground"
                      aria-hidden="true"
                    />
                  </AvatarFallback>
                </Avatar>
              </AvatarRing>
            </div>

            {/* Profile info */}
            <div className="flex-1 min-w-0">
              {/* Display name — text-xl semibold per UI-SPEC Typography */}
              <h1
                className={`truncate text-xl font-semibold text-foreground ${
                  user.termsWon.length > 0 ? "pr-16" : ""
                }`}
              >
                {user.name ?? user.username ?? "Unnamed"}
              </h1>

              <div className="flex flex-wrap items-center gap-2">
                <TitleChip slug={user.equippedTitle} size="sm" />
              </div>

              {/* @username — only when claimed */}
              {user.username && (
                <p className="text-sm text-muted-foreground">@{user.username}</p>
              )}

              {/* Bio */}
              {user.bio && (
                <p className="mt-2 text-base text-foreground">{user.bio}</p>
              )}

              {/* ZP balance — text-3xl semibold per UI-SPEC Typography Display role */}
              <p className="mt-3 text-2xl font-semibold text-foreground tabular-nums font-mono">
                {user.zigmaPoints} ZP
              </p>

              {/* Owner-only: Edit profile link */}
              {isOwner && (
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link href="/profile/edit">
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                    Edit profile
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Terms won — deliberately OUTSIDE the card. Inside, next to the equipped
          title on the equipped background, it read as one more cosmetic; it is a
          record the community awarded, so it sits on the plain page surface. */}
      {(user.termsWon.length > 0 || termsPooped.length > 0) && (
        <div className="-mt-2 mb-6 flex flex-wrap items-center gap-2">
          {user.termsWon.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold leading-none"
              style={{
                color: MAXXER_GOLD,
                borderColor: MAXXER_GOLD,
                backgroundColor: `color-mix(in oklch, ${MAXXER_GOLD} 12%, transparent)`,
              }}
            >
              <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
              {t.name} Zigma Maxxer
            </span>
          ))}
          {termsPooped.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold leading-none"
              style={{
                color: POOPER_BROWN,
                borderColor: POOPER_BROWN,
                backgroundColor: `color-mix(in oklch, ${POOPER_BROWN} 12%, transparent)`,
              }}
            >
              <span aria-hidden="true">💩</span>
              {t.name} Zigma Pooper
            </span>
          ))}
        </div>
      )}

      {/* D-07: Sent/Received post history, plus the owner-only Inventory tab
          (cosmetics are equipped there, no trip to /shop needed) */}
      <PostHistoryTabs userId={user.id} isOwner={isOwner} />
    </main>
  )
}
