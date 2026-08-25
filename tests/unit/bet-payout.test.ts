import { describe, it, expect } from "vitest"
import { distribute, settleBets, type BetStake } from "@/lib/bet-payout"

const stake = (id: string, choice: string, amount: number): BetStake => ({
  id,
  userId: `u-${id}`,
  choice,
  amount,
})

describe("distribute", () => {
  it("conserves the total exactly (no rounding drift)", () => {
    const out = distribute(50, [10, 5, 5]) // pot 50 across winner stakes 20
    expect(out.reduce((a, b) => a + b, 0)).toBe(50)
    expect(out[0]).toBe(25) // 10/20 * 50
  })

  it("hands leftover units to the largest fractional shares", () => {
    const out = distribute(10, [1, 1, 1]) // 3.33 each -> 4,3,3
    expect(out.reduce((a, b) => a + b, 0)).toBe(10)
    expect(out.filter((n) => n === 4)).toHaveLength(1)
  })

  it("returns zeros for a zero pot", () => {
    expect(distribute(0, [3, 2])).toEqual([0, 0])
  })
})

describe("settleBets — proportional pari-mutuel", () => {
  it("splits the whole pot among winners by stake", () => {
    const bets = [
      stake("a", "A", 10),
      stake("b", "A", 5),
      stake("c", "A", 5),
      stake("x", "B", 20),
      stake("y", "B", 10),
    ]
    const { payoutByBetId, pot, winnerCount } = settleBets(bets, "A")
    expect(pot).toBe(50)
    expect(winnerCount).toBe(3)
    // Winners get their stake back plus a share of the losers' 30.
    expect(payoutByBetId.get("a")).toBe(25)
    expect(payoutByBetId.get("b")).toBe(13)
    expect(payoutByBetId.get("c")).toBe(12)
    expect(payoutByBetId.get("x")).toBe(0)
    expect(payoutByBetId.get("y")).toBe(0)
    // ZP is conserved: total paid out == pot.
    const total = [...payoutByBetId.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(pot)
  })

  it("refunds every bettor when nobody picked the winner", () => {
    const bets = [stake("a", "A", 10), stake("b", "B", 5)]
    const { payoutByBetId, winnerCount } = settleBets(bets, "C")
    expect(winnerCount).toBe(0)
    expect(payoutByBetId.get("a")).toBe(10)
    expect(payoutByBetId.get("b")).toBe(5)
  })

  it("gives the sole winner the entire pot", () => {
    const bets = [stake("a", "A", 3), stake("b", "B", 7)]
    const { payoutByBetId } = settleBets(bets, "A")
    expect(payoutByBetId.get("a")).toBe(10)
  })

  it("handles an empty pool", () => {
    const { pot, winnerCount } = settleBets([], "A")
    expect(pot).toBe(0)
    expect(winnerCount).toBe(0)
  })
})
