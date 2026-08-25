// TanStack QueryClient factory.
// Returns a new QueryClient configured for superjson serialization — required when
// using dehydrate/hydrate across the server/client boundary with tRPC v11.
//
// Each Server Component call creates its own QueryClient (avoids cross-request caching).
// The "use client" TRPCReactProvider reuses a singleton QueryClient per browser session.

import {
  defaultShouldDehydrateQuery,
  MutationCache,
  QueryClient,
} from "@tanstack/react-query"
import superjson from "superjson"

export function makeQueryClient() {
  const queryClient = new QueryClient({
    // Any successful mutation can change the caller's ZP — transfers, bets, tasks,
    // the daily reward, and admin edits all touch zigmaPoints across 6 routers. Rather
    // than wire getMe invalidation into each handler (and forget future ones), refetch
    // the header balance after every mutation so the top-bar ZP updates immediately.
    // getMe is a tiny single-row query; the occasional wasted refetch after a non-ZP
    // mutation (a vote, a reply) is far cheaper than a stale balance.
    // ponytail: blanket getMe invalidation; narrow to ZP mutations only if profiling ever flags it.
    mutationCache: new MutationCache({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const path = q.queryKey?.[0]
            return Array.isArray(path) && path[0] === "user" && path[1] === "getMe"
          },
        })
      },
    }),
    defaultOptions: {
      queries: {
        // With SSR, set a higher staleTime to avoid immediate refetch on mount
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  })
  return queryClient
}
