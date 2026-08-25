// tRPC v11 server-side utilities: server caller + HydrateClient.
// Used in Server Components to prefetch data and pass it to the client via dehydration.
//
// Usage in a Server Component:
//   const trpc = await createServerCaller()
//   const me = await trpc.user.getMe()
//
// Usage for prefetch + HydrateClient pattern:
//   <HydrateClient queryClient={qc}>
//     <ClientComponent />
//   </HydrateClient>

import { dehydrate, HydrationBoundary } from "@tanstack/react-query"

import { appRouter } from "@/trpc/routers/_app"
import { createTRPCContext, createCallerFactory } from "@/trpc/init"
import { makeQueryClient } from "@/trpc/query-client"

const createCaller = createCallerFactory(appRouter)

/**
 * Create a server-side tRPC caller that reads the current session.
 * Only use this inside Server Components or Server Actions.
 */
export async function createServerCaller() {
  const ctx = await createTRPCContext()
  return createCaller(ctx)
}

/**
 * HydrateClient: wraps a subtree with dehydrated query state so Client Components
 * receive prefetched data without an extra network round-trip.
 */
export function HydrateClient({
  children,
  queryClient,
}: {
  children: React.ReactNode
  queryClient: ReturnType<typeof makeQueryClient>
}) {
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  )
}

export { makeQueryClient }
