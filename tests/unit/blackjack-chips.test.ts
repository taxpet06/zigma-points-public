import { describe, it, expect } from "vitest"
import { chipBreakdown } from "@/components/game-hub/casino/blackjack/blackjack-chips"

describe("chipBreakdown", () => {
  it("shows one 100 chip for 100 ZP", () => {
    const parts = chipBreakdown(100)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ value: 100, count: 1 })
  })

  it("breaks 67 into two 25s and three 5s", () => {
    const map = Object.fromEntries(chipBreakdown(67).map((p) => [p.value, p.count]))
    expect(map[100]).toBeUndefined()
    expect(map[25]).toBe(2)
    expect(map[5]).toBe(3)
  })

  it("breaks 25 into a single 25", () => {
    expect(chipBreakdown(25)).toEqual([expect.objectContaining({ value: 25, count: 1 })])
  })
})
