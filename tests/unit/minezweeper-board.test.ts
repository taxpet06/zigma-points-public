// MineZweeper board — the three things that would silently break the game:
//   generation (40 mines, counts agreeing with them), the first-tap 3x3 relocation
//   (safe AND zero-cascade, at corners/edges/centre), and determinism (client and
//   server must rebuild the identical board or every win verifies as a loss).

import { describe, it, expect } from "vitest"
import {
  CELLS,
  MINE_COUNT,
  boardForDay,
  neighbours,
  verifySolve,
} from "@/components/game-hub/minezweeper/board"

const DAY = "2026-08-03"

describe("boardForDay", () => {
  it("places exactly 40 mines with counts that agree with them", () => {
    const { mines, counts } = boardForDay(DAY, 136)
    expect(mines.size).toBe(MINE_COUNT)
    for (let i = 0; i < CELLS; i++) {
      expect(counts[i]).toBe(neighbours(i).filter((n) => mines.has(n)).length)
    }
  })

  it("keeps the first tap's 3x3 mine-free so it always opens a cascade", () => {
    for (const first of [0, 15, 136, 240, 255, 7, 128]) {
      const { mines, counts } = boardForDay(DAY, first)
      expect(mines.size).toBe(MINE_COUNT)
      expect(mines.has(first)).toBe(false)
      for (const n of neighbours(first)) expect(mines.has(n)).toBe(false)
      expect(counts[first]).toBe(0)
    }
  })

  it("is deterministic per (day, first) and differs across days", () => {
    const a = [...boardForDay(DAY, 42).mines].sort((x, y) => x - y)
    const b = [...boardForDay(DAY, 42).mines].sort((x, y) => x - y)
    const other = [...boardForDay("2026-08-04", 42).mines].sort((x, y) => x - y)
    expect(a).toEqual(b)
    expect(a).not.toEqual(other)
  })
})

describe("verifySolve", () => {
  const first = 136
  const { mines } = boardForDay(DAY, first)
  const safeCells = Array.from({ length: CELLS }, (_, i) => i).filter((i) => !mines.has(i))

  it("accepts exactly the non-mine set", () => {
    expect(safeCells.length).toBe(CELLS - MINE_COUNT)
    expect(verifySolve(DAY, first, safeCells)).toBe(true)
  })

  it("rejects a missing safe cell, an included mine, and the wrong day", () => {
    expect(verifySolve(DAY, first, safeCells.slice(1))).toBe(false)
    expect(verifySolve(DAY, first, [...safeCells, [...mines][0]])).toBe(false)
    expect(verifySolve("2026-08-04", first, safeCells)).toBe(false)
  })
})
