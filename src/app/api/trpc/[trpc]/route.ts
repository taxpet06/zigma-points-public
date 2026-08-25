// tRPC HTTP route handler — mounts the appRouter at /api/trpc for GET + POST.
// Uses @trpc/server's fetchRequestHandler (Fetch API adapter — correct for Next.js App Router).
// Source: RESEARCH.md Pattern 7.

import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

import { appRouter } from "@/trpc/routers/_app"
import { createTRPCContext } from "@/trpc/init"

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  })

export { handler as GET, handler as POST }
