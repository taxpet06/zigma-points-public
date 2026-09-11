import { describe, it, expect } from "vitest"
import { sevenBag, pieceAt, PIECES } from "@/lib/tetris/rng"

const sorted = (arr: readonly string[]) => [...arr].sort()

describe("sevenBag", () => {
  it("is a permutation of all 7 pieces for distinct seeds", () => {
    for (const seed of [1, 42, 999]) {
      const bag = sevenBag(seed, 0)
      expect(bag).toHaveLength(7)
      expect(sorted(bag)).toEqual(sorted(PIECES))
    }
  })

  it("is deterministic — same (seed, bagIndex) produces the same permutation", () => {
    const a = sevenBag(1234, 2)
    const b = sevenBag(1234, 2)
    expect(a).toEqual(b)
  })

  it("different bagIndex values produce independent shuffles", () => {
    const bags = [0, 1, 2, 3, 4].map((i) => sevenBag(777, i))
    const allIdentical = bags.every((b) => JSON.stringify(b) === JSON.stringify(bags[0]))
    expect(allIdentical).toBe(false)
  })
})

describe("pieceAt", () => {
  it("stitches consecutive bags: pieceAt(0..6) == sevenBag(0), pieceAt(7..13) == sevenBag(1)", () => {
    const seed = 55
    const bag0 = sevenBag(seed, 0)
    const bag1 = sevenBag(seed, 1)
    for (let n = 0; n < 7; n++) {
      expect(pieceAt(seed, n)).toBe(bag0[n])
    }
    for (let n = 7; n < 14; n++) {
      expect(pieceAt(seed, n)).toBe(bag1[n - 7])
    }
  })
})
