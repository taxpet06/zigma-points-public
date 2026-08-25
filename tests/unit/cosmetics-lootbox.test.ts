import { describe, it, expect } from "vitest"
import { weightedPick, rollLootbox, COSMETICS } from "@/lib/cosmetics"

const BACKGROUND_SLUGS = new Set(COSMETICS.filter((c) => c.kind === "BACKGROUND").map((c) => c.slug))
const RING_SLUGS = new Set(COSMETICS.filter((c) => c.kind === "RING").map((c) => c.slug))

describe("weightedPick", () => {
  it("uniform weights produce a roughly uniform distribution", () => {
    const entries = [1, 2, 3, 4, 5, 6].map((n) => ({ slug: `s${n}`, weight: 1 }))
    const counts: Record<string, number> = {}
    for (let i = 0; i < 10_000; i++) {
      const slug = weightedPick(entries)
      counts[slug] = (counts[slug] ?? 0) + 1
    }
    for (const e of entries) {
      const freq = (counts[e.slug] ?? 0) / 10_000
      expect(freq).toBeGreaterThan(0.13)
      expect(freq).toBeLessThan(0.2)
    }
  })

  it("non-uniform weights select proportionally", () => {
    const entries = [
      { slug: "heavy", weight: 10 },
      { slug: "l1", weight: 1 },
      { slug: "l2", weight: 1 },
      { slug: "l3", weight: 1 },
      { slug: "l4", weight: 1 },
      { slug: "l5", weight: 1 },
    ]
    const counts: Record<string, number> = {}
    for (let i = 0; i < 10_000; i++) {
      const slug = weightedPick(entries)
      counts[slug] = (counts[slug] ?? 0) + 1
    }
    const heavyFreq = (counts.heavy ?? 0) / 10_000
    expect(heavyFreq).toBeGreaterThan(0.55) // nominal 10/15 ~= 0.667
    for (const light of ["l1", "l2", "l3", "l4", "l5"]) {
      const freq = (counts[light] ?? 0) / 10_000
      expect(freq).toBeLessThan(0.12)
    }
  })

  it("last bucket is inclusive — no fall-through at the top of the rng range", () => {
    const entries = [
      { slug: "a", weight: 1 },
      { slug: "b", weight: 1 },
    ]
    const slug = weightedPick(entries, () => 0.999999999)
    expect(slug).toBe("b")
  })
})

describe("rollLootbox", () => {
  it("26x-background only ever yields BACKGROUND slugs", () => {
    for (let i = 0; i < 200; i++) {
      expect(BACKGROUND_SLUGS.has(rollLootbox("26x-background"))).toBe(true)
    }
  })

  it("26x-ring only ever yields RING slugs", () => {
    for (let i = 0; i < 200; i++) {
      expect(RING_SLUGS.has(rollLootbox("26x-ring"))).toBe(true)
    }
  })
})
