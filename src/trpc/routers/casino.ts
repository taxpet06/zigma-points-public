// Casino tRPC router — the shared spine (seeds, rotation, history, resume) that every casino
// game plugs into. Deliberately holds no game logic: games 11-16 add their own router files,
// mirroring how flappy.ts and tetris.ts already coexist as separate routers.
//
// The single most dangerous line in this file is a Prisma read without an explicit `select`:
// Prisma returns all scalar fields by default, and one such read on CasinoSeed ships the live
// serverSeed to the browser, letting a player compute every future outcome
// (10-RESEARCH.md § Pitfall 2 / T-10-18). Every CasinoSeed read below passes an explicit
// select that omits serverSeed; the sole exception is the rotation reveal, where the row has
// just become publicly revealable, and the per-row history mapping, where revealedAt gates it.
//
// Every procedure is protectedProcedure and none takes a userId input — the id always comes
// from ctx.session.user.id (T-10-23; matches the 260720-jjq precedent removing anonymous
// betting).

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, protectedProcedure } from "@/trpc/init"
import { db, runSerializable } from "@/lib/db"
import { newServerSeed, hashServerSeed } from "@/lib/casino/fairness"
import { getOrCreateActiveSeed } from "@/lib/casino/bet"

// Shared by setClientSeed and rotateSeed (FAIR-02/03). `:` is the HMAC message field
// separator (`clientSeed:nonce:round` — fairness.ts), so a client seed of "abc:2" at nonce 1
// produces the identical message as "abc" at nonce 2: a deliberate, exploitable outcome
// collision across seed states (10-RESEARCH.md § Pitfall 8 / T-10-20). Rejected at this zod
// boundary, before any DB write.
const clientSeedSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^:]+$/, "Client seeds can't contain a colon (:).")

export const casinoRouter = createTRPCRouter({
  /** The active (unrevealed) seed pair's public half — hash, client seed, nonce. Never the
   *  server seed (FAIR-01) — not in the response, not selected from Prisma. Lazily creates
   *  the pair on first call via the exact helper openBet() uses, so there is one creation
   *  path, not two. */
  getSeed: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id

    const existing = await db.casinoSeed.findFirst({
      where: { userId, revealedAt: null },
      // Explicit select omitting serverSeed — never fetch the secret and drop it later.
      select: { id: true, serverSeedHash: true, clientSeed: true, nonce: true },
    })
    if (existing) {
      return { seedId: existing.id, serverSeedHash: existing.serverSeedHash, clientSeed: existing.clientSeed, nonce: existing.nonce }
    }

    // No active pair yet — this is a read-then-insert, hence Serializable (10-RESEARCH.md
    // § Seed Lifecycle: "the first getSeed/openBet ... creates a CasinoSeed inside
    // runSerializable"). The created row includes serverSeed (bet.ts needs it for openBet);
    // we deliberately forward only the four safe fields below, never the row itself.
    const created = await runSerializable((tx) => getOrCreateActiveSeed(tx, userId))
    return { seedId: created.id, serverSeedHash: created.serverSeedHash, clientSeed: created.clientSeed, nonce: created.nonce }
  }),

  /** Updates the active pair's client seed in place. The nonce is NOT reset — it keeps
   *  climbing so (serverSeed, clientSeed, nonce) triples stay unique and no past outcome
   *  becomes re-derivable from a reused input (FAIR-02). */
  setClientSeed: protectedProcedure
    .input(z.object({ clientSeed: clientSeedSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const active = await db.casinoSeed.findFirst({
        where: { userId, revealedAt: null },
        select: { id: true },
      })
      if (!active) throw new TRPCError({ code: "NOT_FOUND", message: "No active seed — call getSeed first." })

      const updated = await db.casinoSeed.update({
        where: { id: active.id },
        data: { clientSeed: input.clientSeed },
        select: { clientSeed: true },
      })
      return { clientSeed: updated.clientSeed }
    }),

  /** Retires the active pair (revealing its server seed — from this instant it is publicly
   *  returnable) and opens a fresh one at nonce 0 (FAIR-03). Both writes happen inside one
   *  transaction: a rotation that revealed the old seed but failed to create the new pair
   *  would leave the user unable to bet. */
  rotateSeed: protectedProcedure
    .input(z.object({ clientSeed: clientSeedSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      return runSerializable(async (tx) => {
        const active = await tx.casinoSeed.findFirst({
          where: { userId, revealedAt: null },
          select: { id: true },
        })
        if (!active) throw new TRPCError({ code: "NOT_FOUND", message: "No active seed to rotate." })

        // From this write onward serverSeed is publicly returnable — the row is retired.
        const retired = await tx.casinoSeed.update({
          where: { id: active.id },
          data: { revealedAt: new Date() },
          select: { serverSeed: true },
        })

        // ponytail: no eager "next server seed" commitment (Stake's nextServerSeed /
        // nextServerSeedHash columns) — rotation already publishes the new hash before any
        // bet lands on it, and the client seed below is chosen by the caller AFTER seeing
        // that hash, so the eager commitment would add no additional guarantee here. Add
        // those two columns if that ever changes.
        //
        // The caller supplying clientSeed now — after the new serverSeedHash exists — is
        // load-bearing, not UX polish (T-10-21): if the server both generated the new server
        // seed and already knew the client seed it would pair with, it could grind candidate
        // server seeds until the first N nonces were all losses.
        const serverSeed = newServerSeed()
        const serverSeedHash = await hashServerSeed(serverSeed)
        const created = await tx.casinoSeed.create({
          data: { userId, serverSeed, serverSeedHash, clientSeed: input.clientSeed, nonce: 0 },
          select: { serverSeedHash: true, clientSeed: true, nonce: true },
        })

        return {
          revealedServerSeed: retired.serverSeed,
          serverSeedHash: created.serverSeedHash,
          clientSeed: created.clientSeed,
          nonce: created.nonce,
        }
      })
    }),

  /** Cursor-paginated bet history, newest first, scoped to the caller only (CASN-06). There
   *  is deliberately NO userId input parameter — its absence is the control against history
   *  enumeration (T-10-19) and makes the IDOR impossible to reintroduce by a careless `where`
   *  edit later. */
  history: protectedProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const items = await db.casinoBet.findMany({
        // SETTLED only (10-09 deviation, Rule 2): an ACTIVE round has null multiplier/payout,
        // which this list has no honest way to render as a ledger row — CASN-07's activeRound
        // is the resume surface for that round, not this list.
        where: { userId, status: "SETTLED" },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        select: {
          id: true,
          game: true,
          wager: true,
          multiplier: true,
          payout: true,
          createdAt: true,
          nonce: true,
          config: true,
          // Nested select-then-conditional-drop is the one place that pattern is fine
          // (Pitfall 2's stated exception): the reveal condition is per-row (seed.revealedAt),
          // not a fixed property of this endpoint, so no single explicit select can express
          // "serverSeed, but only sometimes". A rotated round is verifiable; an un-rotated
          // one is not — see 10-RESEARCH.md § Seed Lifecycle "Verifier inputs".
          //
          // serverSeedHash (10-09 deviation, Rule 3): the published commitment for the row's
          // seed pair. Without it the Verifier has nothing to compare a recomputed hash
          // against, so every tapped row — even a revealed one — would dead-end at "cannot
          // verify yet". The hash is safe to publish unconditionally (FAIR-01): it is the
          // commitment, not the secret.
          seed: { select: { clientSeed: true, serverSeed: true, serverSeedHash: true, revealedAt: true } },
        },
      })

      let nextCursor: string | undefined
      if (items.length > input.limit) {
        const extra = items.pop()!
        nextCursor = extra.id
      }

      const mappedItems = items.map(({ seed, ...bet }) => ({
        ...bet,
        clientSeed: seed?.clientSeed ?? null,
        serverSeed: seed?.revealedAt ? seed.serverSeed : null,
        serverSeedHash: seed?.serverSeedHash ?? null,
      }))

      return { items: mappedItems, nextCursor }
    }),

  /** The caller's single in-flight round, for resume-after-refresh (CASN-07). Because the
   *  stake was already debited at openBet, a refresh can't eat it — the ZP is accounted for
   *  and the round is still live. */
  activeRound: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id

    const bet = await db.casinoBet.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      // SAFE projection only (10-RESEARCH.md § Pitfall 4): an in-flight round must never
      // ship information the current UI doesn't already display — for a multi-step game like
      // Mines, the revealed tiles, never the mine array. Phase 10 stores nothing hidden in
      // `state` yet; this comment is the contract phases 11-16 inherit. No `seed` relation —
      // a live round must not let the client read its own unrevealed server seed.
      select: { id: true, game: true, wager: true, config: true, state: true, multiplier: true, createdAt: true },
    })
    if (!bet) return null

    return {
      betId: bet.id,
      game: bet.game,
      wager: bet.wager,
      config: bet.config,
      state: bet.state,
      multiplier: bet.multiplier,
      createdAt: bet.createdAt,
    }
  }),
})
