// PUBLIC-MIRROR STUB. The real implementation is private (see docs/public-mirror.md).
// This file's exports must track src/private-games/jj/router.ts's public API.
//
// Procedure NAMES must match the real router so `_app.ts` and any typed client keep the same
// shape; the bodies are unreachable in this build.

import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"

const notFound = () => {
  throw new TRPCError({ code: "NOT_FOUND", message: "JJ is not available in the public build." })
}

export const jjRouter = createTRPCRouter({
  getStatus: protectedProcedure.query(notFound),
  feed: protectedProcedure.mutation(notFound),
  claim: protectedProcedure.mutation(notFound),
})
