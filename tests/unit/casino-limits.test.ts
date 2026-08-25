import { describe, it, expect } from "vitest"
import { MIN_BET, MAX_BET, MAX_PAYOUT, payoutFor, assertWagerInLimits, clampBet } from "@/lib/casino/limits"

// Locked user decisions from 10-CONTEXT.md § Economy — not tuning defaults. Asserted literally
// so a later edit to limits.ts breaks a test rather than silently changing the economy.
describe("locked economy constants", () => {
  it("MIN_BET is 5", () => expect(MIN_BET).toBe(5))
  it("MAX_BET is 1000", () => expect(MAX_BET).toBe(1_000))
  it("MAX_PAYOUT is 100000", () => expect(MAX_PAYOUT).toBe(100_000))
  // The two moved together (2026-08-03): a max bet must keep 100x of payout headroom, or
  // high-multiplier games flat-cap at the top of the bet range.
  it("keeps 100x payout headroom on a max bet", () => expect(MAX_PAYOUT / MAX_BET).toBe(100))
})

describe("payoutFor — floor", () => {
  it("floors down, never rounds", () => {
    expect(payoutFor(10, 1.03)).toBe(10)
    expect(payoutFor(10, 0.2)).toBe(2)
    expect(payoutFor(1, 0.2)).toBe(0)
    expect(payoutFor(100, 2.47)).toBe(247)
    expect(payoutFor(3, 1.9999)).toBe(5)
  })

  it("a total loss (multiplier 0) pays 0", () => {
    expect(payoutFor(1, 0)).toBe(0)
  })

  it("floors BEFORE capping, not after — Mines' 5,148,297x is clamped to MAX_PAYOUT", () => {
    expect(payoutFor(100, 5148297)).toBe(100_000)
  })

  it("a payout exactly at the cap after flooring is not pushed over it", () => {
    // 100 * 1000.005 = 100000.5, floors to 100000 — at, not over, the cap.
    expect(payoutFor(100, 1000.005)).toBe(100_000)
  })
})

describe("assertWagerInLimits — bet input bounds", () => {
  it("accepts the boundary values MIN_BET and MAX_BET", () => {
    expect(() => assertWagerInLimits(MIN_BET)).not.toThrow()
    expect(() => assertWagerInLimits(MAX_BET)).not.toThrow()
  })

  it("rejects 0, negative, and above-max wagers with BAD_REQUEST", () => {
    for (const bad of [0, -5, 1001]) {
      expect(() => assertWagerInLimits(bad)).toThrow()
      try {
        assertWagerInLimits(bad)
      } catch (e) {
        expect(e).toMatchObject({ code: "BAD_REQUEST" })
      }
    }
  })

  it("rejects a non-integer wager — zigmaPoints is an Int column, a fractional stake would fractionally debit", () => {
    expect(() => assertWagerInLimits(1.5)).toThrow()
    try {
      assertWagerInLimits(1.5)
    } catch (e) {
      expect(e).toMatchObject({ code: "BAD_REQUEST" })
    }
  })
})

describe("clampBet — bet input clamp-don't-error contract", () => {
  it("passes a value already inside range through unchanged", () => {
    expect(clampBet(50, 1000)).toBe(50)
  })

  it("floors up to MIN_BET rather than erroring", () => {
    expect(clampBet(0, 1000)).toBe(MIN_BET)
  })

  it("caps at MAX_BET", () => {
    expect(clampBet(5000, 10_000)).toBe(MAX_BET)
  })

  it("caps at the balance when the balance is below MAX_BET", () => {
    expect(clampBet(50, 30)).toBe(30)
  })

  it("returns MIN_BET (never 0, never an error) when the balance is zero", () => {
    // clampBet(50, 0) === 0 is WRONG (it would render an out-of-range field); the
    // insufficient-balance state is a separate UI concern from the clamp contract.
    expect(clampBet(50, 0)).toBe(MIN_BET)
  })

  it("half-of-minimum composes to stay at the minimum", () => {
    expect(clampBet(Math.floor(MIN_BET / 2), 1000)).toBe(MIN_BET)
  })

  it("double composes to cap rather than error", () => {
    expect(clampBet(800 * 2, 10_000)).toBe(MAX_BET)
  })
})
