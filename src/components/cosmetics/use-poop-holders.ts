"use client"

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"

// Is this user wearing a Zigma Pooper's poop?
//
// The mirror of useCrownHolder: one cached query answers it for every avatar on the
// page (React Query dedupes by key) instead of threading a column through the ~25 user
// selects that feed avatars. It returns a LIST rather than a single holder — a term has
// one Maxxer but any number of Poopers.
export function usePoopHolders(userId?: string | null) {
  const trpc = useTRPC()
  const { data } = useQuery({
    ...trpc.term.poopHolders.queryOptions(),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000, // the list changes about as often as the crown moves
  })
  return Boolean(userId) && Boolean(data?.includes(userId!))
}
