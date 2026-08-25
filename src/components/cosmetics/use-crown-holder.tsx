"use client"

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"

// Does this user wear the Zigma Maxxer crown?
//
// There is exactly one holder app-wide, so one cached query answers it for every
// avatar on the page (React Query dedupes by key) instead of threading a hasCrown
// column through the ~25 user selects that feed avatars.
export function useCrownHolder(userId?: string | null) {
  const trpc = useTRPC()
  const { data } = useQuery({
    ...trpc.term.crownHolder.queryOptions(),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000, // the crown moves about once a term
  })
  return Boolean(userId) && data?.id === userId
}
