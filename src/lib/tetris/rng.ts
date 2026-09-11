// Deterministic 7-bag piece randomizer for Petris. Same seed -> same
// piece stream, on both client and server — this is the anti-cheat root
// (server replay re-derives the exact sequence the client saw).

// ponytail: reuse Flappy's mulberry32 verbatim rather than duplicating it.
export { mulberry32 } from "@/lib/seeded-rng"
import { mulberry32 } from "@/lib/seeded-rng"

export const PIECES = ["I", "O", "T", "S", "Z", "J", "L"] as const
export type PieceId = (typeof PIECES)[number]

// Same per-index mixing constant Flappy uses to derive independent draws
// from a single run seed (2654435761 is Knuth's 32-bit golden-ratio constant).
const BAG_MIX = 2654435761

/**
 * sevenBag is a pure function of (seed, bagIndex): client and server derive
 * the identical bag with no round-trip. Fisher-Yates shuffle of PIECES.
 */
export function sevenBag(seed: number, bagIndex: number): PieceId[] {
  const rand = mulberry32((seed ^ Math.imul(bagIndex, BAG_MIX)) >>> 0)
  const bag: PieceId[] = [...PIECES]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

/** The nth piece drawn across a run (n = 0-indexed draw count). */
export function pieceAt(seed: number, n: number): PieceId {
  return sevenBag(seed, Math.floor(n / 7))[n % 7]
}
