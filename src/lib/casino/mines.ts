// Mines' isomorphic core — imported by the server router, the board, and the verifier.
// No React, no DOM, no second HMAC implementation: crypto lives only in fairness.ts, and this
// module's whole value is that server and verifier run the SAME function.
//
// deriveMines is now a frozen wire format for TWO games — Mines and Chicken Cross (Phase 15,
// src/private-games/chicken/logic.ts's deriveTraps is a plain alias). A future editor cannot change the
// shuffle without breaking Chicken's verifier too.

import { floats, type SeedInput } from "@/lib/casino/fairness"

export const MINES_TILES = 25
export const MINES_MIN = 1
export const MINES_MAX = 24

/** C(n, k) for n <= 25 — exact: every intermediate r*(n-i)/(i+1) is an integer in this order,
 *  and the max value C(25,12) = 5,200,300 is far inside 2^53. Do NOT use a factorial form or a
 *  MAX_SAFE_INTEGER guard — n is bounded by construction (25 tiles), never user-supplied. */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

/** mult(m,k) = 0.99 * C(25,k) / C(25-m,k), rounded to 2dp half-away-from-zero. Computed in
 *  CENTS from exact integer binomials: the published table has 24 exact x.xx5 cells, and the
 *  obvious float-product form gets (3,15) wrong by a cent — 18.974999999999998 -> 18.97 where
 *  the published value is 18.98, while its mathematical twin (15,3) lands on exactly
 *  18.975 -> 18.98. See 12-RESEARCH.md § Rounding. A future reader will be tempted to
 *  "simplify" this back into that bug — don't.
 *
 *  The scaling constant is 99 (= 0.99 * 100), matching "round to 2dp": round(mult * 100) / 100
 *  = round(99 * C/D) / 100. 12-RESEARCH.md's code sample writes 9900, which is a factor of 100
 *  too large — verified against the shipped fixture table (12-13 -> 5148297, not 514829700)
 *  and against every 2dp cell; fixed here as a Rule 1 bug rather than transcribed verbatim.
 *
 *  Throws rather than returning NaN: a money-path requirement, since payoutFor() would floor a
 *  NaN into something unexpected. */
export function minesMultiplier(mines: number, k: number): number {
  if (mines < MINES_MIN || mines > MINES_MAX || k < 1 || k > MINES_TILES - mines) {
    throw new Error(`bad mines config mines=${mines} k=${k}`)
  }
  return Math.round((99 * binomial(MINES_TILES, k)) / binomial(MINES_TILES - mines, k)) / 100
}

/** Fisher-Yates over the full 25-tile deck from 24 floats (96 bytes = 3 HMAC rounds, handled
 *  internally by floats() — never a manual cursor, never three concatenated calls). The shuffle
 *  always runs all 24 swap events regardless of `mines`, which is what makes the mine set for m
 *  a strict prefix of the set for m+1 and lets one seed be verified at any mine count. */
export async function deriveMines(seed: SeedInput, mines: number): Promise<number[]> {
  const fs = await floats(seed, 24)
  const deck = Array.from({ length: MINES_TILES }, (_, i) => i)
  for (let i = 24; i > 0; i--) {
    const j = Math.floor(fs[24 - i] * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.slice(0, mines)
}
