import { describe, it, expect } from "vitest"
import { mulberry32 } from "@/lib/seeded-rng"

describe("mulberry32", () => {
  it("is deterministic — same seed produces the same sequence", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b())
    }
  })

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    // First value must differ (mulberry32 is well-diffused)
    expect(a()).not.toBe(b())
  })

  it("produces values in [0, 1)", () => {
    const r = mulberry32(12345)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it("mean of 10k samples is close to 0.5 (basic uniformity)", () => {
    const r = mulberry32(999)
    let sum = 0
    for (let i = 0; i < 10_000; i++) sum += r()
    const mean = sum / 10_000
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
  })
})
