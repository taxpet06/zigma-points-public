import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import { COSMETICS, LOOTBOXES, ADMIN_TITLE, rollLootbox, lootboxOdds } from "@/lib/cosmetics"
import { TITLE_NAMES } from "@/lib/title-names"

const TITLE_SLUGS = new Set(COSMETICS.filter((c) => c.kind === "TITLE").map((c) => c.slug))
const TITLES = COSMETICS.filter((c) => c.kind === "TITLE")

describe.each(["26X", "26F"])("%s catalog", (collection) => {
  it.each(["BACKGROUND", "RING", "TITLE"])("%s: exactly 6 COMMON, 3 RARE and 1 LEGENDARY", (kind) => {
    const items = COSMETICS.filter((c) => c.collection === collection && c.kind === kind)
    expect(items).toHaveLength(10)
    expect(items.filter((c) => c.rarity === "COMMON")).toHaveLength(6)
    expect(items.filter((c) => c.rarity === "RARE")).toHaveLength(3)
    expect(items.filter((c) => c.rarity === "LEGENDARY")).toHaveLength(1)
  })

  it("every kind has a lootbox at the standard 6/3/1 odds", () => {
    for (const kind of ["background", "ring", "title"]) {
      const byRarity = Object.fromEntries(
        lootboxOdds(`${collection.toLowerCase()}-${kind}`).map((o) => [o.rarity, Math.round(o.pct)]),
      )
      expect(byRarity).toEqual({ COMMON: 81, RARE: 18, LEGENDARY: 1 })
    }
  })
})

describe("title roster", () => {
  it("every title's name is a non-empty string (a missing TITLE_NAMES key would be undefined)", () => {
    expect(TITLES.every((c) => typeof c.name === "string" && c.name.length > 0)).toBe(true)
  })

  it("the public stub redacts every title the private file names", () => {
    const stub = readFileSync("tools/public-stubs/src/lib/title-names.ts", "utf8")
    for (const slug of TITLE_SLUGS) expect(stub).toContain(`"${slug}"`)
    // In the public mirror TITLE_NAMES IS the stub, so only real names are checked.
    const real = Object.values(TITLE_NAMES).filter((n) => !n.startsWith("REDACTED"))
    for (const name of real) expect(stub).not.toContain(name)
  })

  it("every committed TITLE name resolves from TITLE_NAMES by slug", () => {
    expect(TITLES.every((c) => c.name === TITLE_NAMES[c.slug])).toBe(true)
  })

  it("cosmetics.ts has no reference to NEXT_PUBLIC_TITLES_26X_JSON", () => {
    const source = readFileSync("src/lib/cosmetics.ts", "utf8")
    expect(source).not.toContain("NEXT_PUBLIC_TITLES_26X_JSON")
  })
})

describe("26x-title lootbox", () => {
  it("only ever yields a 26X TITLE slug, and never the-zigma, across 2000 rolls", () => {
    for (let i = 0; i < 2000; i++) {
      const slug = rollLootbox("26x-title")
      expect(TITLE_SLUGS.has(slug)).toBe(true)
      expect(slug).not.toBe(ADMIN_TITLE.slug)
    }
  })

  it("lootboxOdds returns the full 6/3/1 tier split: Common 81%, Rare 18%, Legendary 1%", () => {
    const odds = lootboxOdds("26x-title")
    const byRarity = Object.fromEntries(odds.map((o) => [o.rarity, Math.round(o.pct)]))
    expect(byRarity.COMMON).toBe(81)
    expect(byRarity.RARE).toBe(18)
    expect(byRarity.LEGENDARY).toBe(1)
  })
})

describe("ADMIN_TITLE unrollability", () => {
  it("ADMIN_TITLE.slug is absent from COSMETICS", () => {
    expect(COSMETICS.some((c) => c.slug === ADMIN_TITLE.slug)).toBe(false)
  })

  it("ADMIN_TITLE.slug is absent from rollLootbox's pool for every box id in LOOTBOXES", () => {
    for (const boxId of Object.keys(LOOTBOXES)) {
      for (let i = 0; i < 200; i++) {
        expect(rollLootbox(boxId)).not.toBe(ADMIN_TITLE.slug)
      }
    }
  })
})

describe("lootbox prices (ECON-01)", () => {
  it("26x-background is 100 ZP, 26x-ring is 50 ZP, 26x-title is 25 ZP", () => {
    expect(LOOTBOXES["26x-background"].price).toBe(100)
    expect(LOOTBOXES["26x-ring"].price).toBe(50)
    expect(LOOTBOXES["26x-title"].price).toBe(25)
  })
})
