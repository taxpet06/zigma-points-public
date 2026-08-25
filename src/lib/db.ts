// Prisma v7 singleton with PrismaNeon adapter.
// - Uses DATABASE_URL (pooled Neon connection) at runtime via the WebSocket driver.
// - Imports PrismaClient from the generated output path (not "@prisma/client") per Prisma v7.
// - Follows the global singleton pattern to prevent connection exhaustion in Next.js dev hot-reload.
// Source: https://neon.com/docs/guides/prisma (verified 2026-06-13)
import { PrismaClient, Prisma } from "../../prisma/generated/prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL!,
  })
  return new PrismaClient({ adapter })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db

// A count-then-insert under the default READ COMMITTED isolation is NOT race-safe:
// concurrent daily-cap checks can each read count=0 and all insert, blowing past
// the cap (ZP-farming, review CR-01). Serializable makes those concurrent
// transactions conflict; the loser gets a serialization failure (Prisma P2034 /
// Postgres 40001) and this helper retries, re-reading the now-committed count.
// Business rejections thrown inside `fn` (e.g. TRPCError) are NOT retryable and
// propagate on the first throw.
function isSerializationFailure(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === "P2034" || /40001|could not serialize|deadlock detected/i.test(e?.message ?? "")
}

export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  retries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: "Serializable" })
    } catch (err) {
      if (isSerializationFailure(err) && attempt < retries) continue
      throw err
    }
  }
}
