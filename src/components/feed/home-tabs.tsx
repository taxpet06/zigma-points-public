"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useQueryClient, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { UserAvatar } from "@/components/cosmetics/user-avatar"
import { CardBackground } from "@/components/cosmetics/card-background"
import { TitleChip } from "@/components/cosmetics/title-chip"
import { MaxxerTrophy, PooperTally } from "@/components/cosmetics/maxxer-trophy"
import { FeedList } from "@/components/feed/feed-list"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"
import { PodiumBoard } from "@/components/podium/podium-board"
import { PullToRefresh } from "@/components/feed/pull-to-refresh"
import { TransferPanel } from "@/components/transfer/transfer-panel"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { normalizeTab } from "@/lib/tabs"

function PeopleList() {
  const trpc = useTRPC()
  const { data: users, isLoading, isError, refetch } = useQuery(trpc.user.getAll.queryOptions())

  if (isLoading) return <FeedSkeleton count={6} />

  if (isError) {
    return (
      <div role="alert" className="py-16 text-center animate-card-rise">
        <p className="text-sm font-medium mb-3">Couldn&apos;t load members.</p>
        <Button variant="link" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!users || users.length === 0) {
    return (
      <div className="py-16 text-center animate-card-rise">
        <h2 className="text-xl font-semibold mb-2">No members yet.</h2>
        <p className="text-sm text-muted-foreground">Check back soon.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {users.map((user, i) => {
        const initials = ((user.name || "?")[0] ?? "?").toUpperCase()
        const name = user.name ?? "Unnamed"
        return (
          <Card
            key={user.id}
            // Same shell + motion as PostCard/TaskCard — keep these in sync.
            className={cn(
              "group relative isolate overflow-hidden flex flex-col items-center gap-2 p-4 text-center animate-card-rise transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            )}
            style={{ "--i": i % 8 } as React.CSSProperties}
          >
            <CardBackground variant={user.equippedBackground} />
            {user.equippedBackground && (
              <div className="absolute inset-0 z-[1] bg-background/30" />
            )}
            <MaxxerTrophy count={user._count.termsWon} size="sm" />
            <PooperTally count={user._count.termPoopers} size="sm" />
            {/* Full-card stretched link. Anchored to the Card (inset-0) and sits
                above content (z-20), so clicking anywhere — avatar, padding, text —
                opens the profile. Anchoring the ::after to the inner text wrapper
                (its old home) only covered the name block, hence the finicky clicks.
                /u/[handle] accepts username OR id, so usernameless users are reachable. */}
            <Link
              href={`/u/${user.username ?? user.id}`}
              aria-label={name}
              className="absolute inset-0 z-20 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
            <div className="relative z-10">
              <UserAvatar
                userId={user.id}
                image={user.image}
                name={name}
                ring={user.equippedRing}
                size={48}
                fallback={<span className="text-base font-semibold">{initials}</span>}
              />
            </div>
            <div className="relative z-10 w-full min-w-0">
              <span className="block truncate text-sm font-medium leading-tight">
                {name}
              </span>
              <TitleChip slug={user.equippedTitle} />
              {user.username && (
                <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
              )}
              <p className="mt-1 text-xs font-semibold tabular-nums font-mono">
                {user.zigmaPoints} ZP
              </p>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export function HomeTabs() {
  const searchParams = useSearchParams()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  // URL is the source of truth so the browser/app back button restores the active tab.
  // normalizeTab (src/lib/tabs.ts) also resolves the legacy ?tab=transfer alias.
  const tab = normalizeTab(searchParams.get("tab"))

  // Pull-to-refresh refetches whichever tab is active (replaces the old button).
  const handleRefresh = useCallback(async () => {
    try {
      if (tab === "posts") {
        // No input: FeedList's key now carries its term filter, so refetching a
        // hardcoded { limit: 20 } would miss whichever term the user is filtered to.
        await queryClient.refetchQueries(trpc.post.getFeed.infiniteQueryFilter())
      } else if (tab === "exchange") {
        await queryClient.refetchQueries(trpc.transfer.listPending.queryFilter())
      } else if (tab === "podium") {
        await queryClient.refetchQueries(trpc.term.podium.queryFilter())
      } else {
        await queryClient.refetchQueries(trpc.user.getAll.queryFilter())
      }
    } catch {
      toast.error("Refresh failed — check your connection.")
    }
  }, [tab, queryClient, trpc])

  return (
    <Tabs value={tab}>
      <PullToRefresh onRefresh={handleRefresh}>
        <TabsContent value="posts" className="mt-0">
          <FeedList />
        </TabsContent>
        <TabsContent value="exchange" className="mt-0">
          <TransferPanel />
        </TabsContent>
        <TabsContent value="podium" className="mt-0">
          <PodiumBoard />
        </TabsContent>
        <TabsContent value="people" className="mt-0">
          <PeopleList />
        </TabsContent>
      </PullToRefresh>
    </Tabs>
  )
}
