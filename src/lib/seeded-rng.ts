// Deterministic PRNG — same seed → same sequence, on both client and server.
// This is what makes claim-once anti-cheat cheap: server can reproduce the exact
// edible layout the client sees.

/** mulberry32 — 32-bit state, well-diffused, tiny. See
 *  https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
