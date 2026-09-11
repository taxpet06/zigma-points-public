"use client"
// tRPC v11 client-side context: TRPCProvider + useTRPC hook.
// Pattern 7 from RESEARCH.md -- @trpc/tanstack-react-query (NOT @trpc/react-query).

import { useState } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { createTRPCClient, httpBatchLink } from "@trpc/client"
import { createTRPCContext } from "@trpc/tanstack-react-query"
import superjson from "superjson"

import type { AppRouter } from "@/trpc/routers/_app"
import { makeQueryClient } from "@/trpc/query-client"

// createTRPCContext gives us a type-safe TRPCProvider and useTRPC hook
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()

let browserQueryClient: ReturnType<typeof makeQueryClient> | undefined

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient()
  }
  // Browser: reuse the singleton to avoid losing cache across re-renders
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

/**
 * TRPCReactProvider wraps both QueryClientProvider and TRPCProvider.
 * Place this high in the component tree (e.g. root layout) so all Client
 * Components can access the query client and tRPC hooks.
 */
export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  )
}
