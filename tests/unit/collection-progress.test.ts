// collectionProgress — the "29/30" counters on the profile Inventory folds.
// The three things that can silently break: duplicates inflating the count,
// the admin title inflating the DENOMINATOR, and kind scoping.

import { describe, it, expect } from "vitest"
import { COSMETICS, ADMIN_TITLE, collectionProgress } from "@/lib/cosmetics"

const all = COSMETICS.filter((c) => c.collection === "26X").map((c) => c.slug)
const titles = COSMETICS.filter((c) => c.collection === "26X" && c.kind === "TITLE").map((c) => c.slug)

describe("collectionProgress", () => {
  it("counts nothing owned as 0 / catalog size", () => {
    expect(collectionProgress([], "26X")).toEqual({ owned: 0, total: all.length })
  })

  it("counts distinct items, not copies", () => {
    // The Set of a caller holding 50 copies of one title is still one slug.
    expect(collectionProgress([titles[0], titles[0], titles[0]], "26X", "TITLE")).toEqual({
      owned: 1,
      total: titles.length,
    })
  })

  it("reads x/y with one item missing", () => {
    expect(collectionProgress(all.slice(0, -1), "26X")).toEqual({
      owned: all.length - 1,
      total: all.length,
    })
  })

  it("scopes to a kind", () => {
    const { owned, total } = collectionProgress(all, "26X", "TITLE")
    expect({ owned, total }).toEqual({ owned: titles.length, total: titles.length })
  })

  it("gives the admin title +1 owned and +0 total (11/10)", () => {
    const admin = collectionProgress([...titles, ADMIN_TITLE.slug], "26X", "TITLE")
    expect(admin).toEqual({ owned: titles.length + 1, total: titles.length })
    expect(collectionProgress([...all, ADMIN_TITLE.slug], "26X")).toEqual({
      owned: all.length + 1,
      total: all.length,
    })
  })

  it("does not credit the admin title to a non-title kind", () => {
    expect(collectionProgress([ADMIN_TITLE.slug], "26X", "RING").owned).toBe(0)
  })

  it("returns 0/0 for an unknown collection", () => {
    expect(collectionProgress(all, "NOPE")).toEqual({ owned: 0, total: 0 })
  })
})
