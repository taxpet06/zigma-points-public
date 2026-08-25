// MineZweeper's board — the ONE module the client and the router both import, exactly
// as words.ts is shared by wordle.tsx and wordle.ts. The board the player clears and the
// board the server verifies are produced by the same code from the same inputs (day +
// first tap), so they can never disagree. No React, no DOM, no Prisma in here.
//
// Two rules make the game fair and the verification cheap:
//
//   1. The day's mine layout is a pure function of the day string (mulberry32 over an
//      FNV-1a hash of "YYYY-MM-DD"), so everyone gets the same board and it rolls at
//      midnight America/New_York with everything else (lib/day-key).
//
//   2. The first tap is guaranteed safe AND guaranteed to open a cascade: every mine in
//      the tapped cell's 3x3 is relocated by a rule the server reproduces exactly. That's
//      why boardForDay takes `first` — the layout isn't finished until the player commits
//      to a cell, and the server re-runs the same relocation from the same cell.
//
// The client sends { first, revealed } and the server rebuilds and checks it. This is not
// unbreakable — the permutation is public and deterministic, so a determined player can
// compute the mine set themselves. It's the same threat model Wordle already ships under
// (the word list is public too): it stops the trivial cheats, and the @@unique row caps
// the damage at one payout a day regardless.

import { mulberry32 } from "@/lib/seeded-rng"

export const COLS = 16
export const ROWS = 16
export const MINE_COUNT = 40
export const CELLS = COLS * ROWS

/** In-bounds neighbours of `i` (up to 8). The column check is the whole point: a bare
 *  i-1 / i+1 wraps around the right edge onto the next row's first cell. */
export function neighbours(i: number): number[] {
  const r = Math.floor(i / COLS)
  const c = i % COLS
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue
      out.push(nr * COLS + nc)
    }
  }
  return out
}

/** Deterministic shuffle of [0..255] for a day. The first 40 entries are the mines; the
 *  tail is the relocation pool, which is why the whole array is shuffled and not just
 *  the head. FNV-1a over the day string gives the seed — cheap, and well spread across
 *  consecutive days (a plain char sum would give neighbouring days neighbouring seeds). */
export function dayPermutation(day: string): number[] {
  let h = 0x811c9dc5
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  const rnd = mulberry32(h)
  const perm = Array.from({ length: CELLS }, (_, i) => i)
  for (let i = CELLS - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  return perm
}

/**
 * The day's board as seen from a given first tap. Mines are perm[0..39], then every mine
 * inside the first tap's 3x3 is moved out of it — so the first tap is always safe and
 * always has count 0, which means it always opens a cascade instead of a lone "1".
 *
 * Relocation is deterministic on both sides: mines are moved in ascending cell index
 * order, and each one lands on the next entry of the SAME permutation from index 40
 * forward that is neither already a mine nor in the safe 3x3, with one shared cursor so
 * two relocations can't pick the same cell. Using the permutation's tail (rather than
 * scanning up from 0) keeps relocated mines spread over the board instead of clustering
 * in the top-left. Mine count stays exactly MINE_COUNT.
 */
export function boardForDay(
  day: string,
  first: number,
): { mines: Set<number>; counts: Uint8Array } {
  const perm = dayPermutation(day)
  const mines = new Set(perm.slice(0, MINE_COUNT))
  const safe = new Set([first, ...neighbours(first)])

  const displaced = [...mines].filter((m) => safe.has(m)).sort((a, b) => a - b)
  let cursor = MINE_COUNT
  for (const m of displaced) {
    mines.delete(m)
    while (cursor < CELLS) {
      const cand = perm[cursor++]
      if (!mines.has(cand) && !safe.has(cand)) {
        mines.add(cand)
        break
      }
    }
  }

  // The tail is 216 cells and at most 9 of them are in `safe`, so the pool can never run
  // dry — but if it somehow did we'd silently ship a board with fewer than 40 mines, and
  // verifySolve would then accept a solve the player never earned.
  if (mines.size !== MINE_COUNT) throw new Error("minezweeper: mine relocation lost a mine")

  const counts = new Uint8Array(CELLS)
  for (const m of mines) for (const n of neighbours(m)) counts[n]++
  return { mines, counts }
}

/**
 * Flood-fill from `start`: reveal it, and if it has no mined neighbour keep expanding.
 * Returns the newly-revealed cells in BFS order — the UI staggers its reveal animation by
 * that order, which is what makes the cascade radiate outward from the tap rather than
 * appearing all at once. Never reveals a mine.
 */
export function cascade(
  counts: Uint8Array,
  mines: Set<number>,
  start: number,
  revealed: Set<number>,
): number[] {
  if (revealed.has(start) || mines.has(start)) return []
  const out: number[] = [start]
  const seen = new Set([start])
  // Index cursor instead of shift() — 256 cells makes it moot, but it's the same length.
  for (let head = 0; head < out.length; head++) {
    const i = out[head]
    if (counts[i] !== 0) continue
    for (const n of neighbours(i)) {
      if (seen.has(n) || revealed.has(n) || mines.has(n)) continue
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/** True iff `revealed` is exactly the day's non-mine set for this first tap — every safe
 *  cell present, no mine present. This is the win proof: the router derives ZP from it and
 *  never reads a score off the client. A payload that doesn't verify is simply a loss. */
export function verifySolve(day: string, first: number, revealed: Iterable<number>): boolean {
  if (!Number.isInteger(first) || first < 0 || first >= CELLS) return false

  const set = new Set<number>()
  for (const i of revealed) {
    if (!Number.isInteger(i) || i < 0 || i >= CELLS) return false
    set.add(i)
  }
  if (!set.has(first)) return false

  const { mines } = boardForDay(day, first)
  for (let i = 0; i < CELLS; i++) {
    if (mines.has(i) === set.has(i)) return false // mine revealed, or safe cell missed
  }
  return true
}
