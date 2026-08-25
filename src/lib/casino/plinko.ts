// Plinko's isomorphic core — the 27 published payout tables, the pure fairness-driven derive,
// and the pure board geometry. Imported by the server router (src/trpc/routers/plinko.ts), the
// canvas board component, AND the in-browser verifier. It must therefore contain no React, no
// DOM access, and no second HMAC implementation: crypto lives only in fairness.ts, and this
// module's whole value is that server and verifier run the SAME function.

import { floats, type SeedInput } from "@/lib/casino/fairness"

export const PLINKO_RISKS = ["LOW", "MEDIUM", "HIGH"] as const
export type PlinkoRisk = (typeof PLINKO_RISKS)[number]

export const PLINKO_MIN_ROWS = 8
export const PLINKO_MAX_ROWS = 16

/** Published Stake/Rainbet tables, re-verified by execution in 11-RESEARCH.md: every array is
 *  mirror-symmetric and computes to 98.906%-99.160% nominal RTP — both properties are asserted
 *  in tests/unit/plinko-tables.test.ts, because the RTP band alone does NOT catch a single-cell
 *  typo (a table can be wrong in a way that still lands "close to 99%").
 *
 *  MEDIUM[16][2] (and its mirror [14]) is 10, NOT 1.0. The upstream 1.0 value breaks mirror
 *  symmetry against its own index 14 and still produces a plausible 98.8608% RTP — see
 *  11-RESEARCH.md § Pitfall 8 and the named regression test.
 *
 *  There is deliberately no "RAIN" tier: Rainbet's fourth risk level could not be verified from
 *  any source and must not be invented (11-CONTEXT.md, locked).
 *
 *  "99% RTP" (PLNK-03) means NOMINAL TABLE RTP, asserted here. Realised RTP legitimately differs
 *  because payoutFor() floors at the bottom and MAX_PAYOUT caps at the top (11-CONTEXT.md) — do
 *  not add a realised-RTP assertion or "correct" a table to chase one. */
export const PLINKO_TABLES: Record<PlinkoRisk, Readonly<Record<number, readonly number[]>>> = {
  LOW: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    9: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6],
    10: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
    11: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    13: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1],
    14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
    15: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  MEDIUM: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    9: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
    10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    11: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    13: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
    14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
    15: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88],
    // index 2 and its mirror index 14 are 10, NOT 1.0 — see the typo regression test.
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  HIGH: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    9: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
    10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    11: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    13: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
    14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
}

/** bits[i] = 0 (left) | 1 (right), one per row, from the first `rows` floats. Slices by
 *  `rows`, not by the input array's length, so an 8-row call and a 16-row call on the same
 *  seed produce prefix-identical paths (floats() is itself a pure prefix generator). */
export function plinkoPath(fs: readonly number[], rows: number): number[] {
  return fs.slice(0, rows).map((f) => Math.floor(f * 2))
}

/** The server's authoritative multiplier read — the client never supplies one. Throws
 *  rather than returning undefined so a malformed risk/rows/bucket can never silently
 *  produce a NaN payout that payoutFor() would floor to something unexpected. */
export function plinkoMultiplier(risk: PlinkoRisk, rows: number, bucket: number): number {
  const table = PLINKO_TABLES[risk][rows]
  if (!table || bucket < 0 || bucket >= table.length) {
    throw new Error(`bad plinko config ${risk}/${rows}/${bucket}`)
  }
  return table[bucket]
}

/** Requests exactly `rows` floats — not a fixed 16: the stream is prefix-consistent, so this
 *  is both cheaper and identical to slicing a longer request. bucket = the count of rights;
 *  no shuffle, so the distribution is exactly binomial C(n,k)/2^n. */
export async function derivePlinko(seed: SeedInput, rows: number, risk: PlinkoRisk) {
  const path = plinkoPath(await floats(seed, rows), rows)
  const bucket = path.reduce((a, b) => a + b, 0)
  return { path, bucket, multiplier: plinkoMultiplier(risk, rows, bucket) }
}

// Pure, DOM-free geometry — this is what makes PLNK-02 a unit test instead of a UAT eyeball.
// The invariant: for every rows 8..16 and every bucket 0..rows,
//   ballX(W, rows, rows, bucket) === bucketCenterX(W, rows, bucket)
// If the animation ever drifts from the server's answer, this identity is what broke. Pegs
// are positioned with the same ballX() so a peg can never be somewhere the ball is not.

export function bucketWidth(boardW: number, rows: number): number {
  return boardW / (rows + 1)
}

/** Horizontal centre of the ball after `row` steps of which `rights` went right. */
export function ballX(boardW: number, rows: number, row: number, rights: number): number {
  return boardW / 2 + (2 * rights - row) * (bucketWidth(boardW, rows) / 2)
}

export function bucketCenterX(boardW: number, rows: number, bucket: number): number {
  return (bucket + 0.5) * bucketWidth(boardW, rows)
}
