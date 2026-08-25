import { describe, it, expect } from "vitest"
import { deriveMines } from "@/lib/casino/mines"

// Same golden triple tests/unit/plinko-derive.test.ts and plinko-router.test.ts already use —
// reused rather than minting a new vector.
const seed = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

describe("deriveMines — golden vector", () => {
  it("golden: the shipped triple at mines=5 is exactly [19, 5, 2, 13, 17], in order", async () => {
    expect(await deriveMines(seed, 5)).toEqual([19, 5, 2, 13, 17])
  })
})

describe("deriveMines — prefix property", () => {
  it("prefix: mines=1 is [19] and mines=3 is [19, 5, 2]", async () => {
    expect(await deriveMines(seed, 1)).toEqual([19])
    expect(await deriveMines(seed, 3)).toEqual([19, 5, 2])
  })

  it("prefix: for every m in 1..23, deriveMines(seed, m) is deriveMines(seed, m+1) sliced to m", async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) => i + 1).map((m) => deriveMines(seed, m)),
    )
    const mismatches: string[] = []
    for (let m = 1; m <= 23; m++) {
      const shorter = results[m - 1] // index m-1 -> mines=m
      const longer = results[m] // index m -> mines=m+1
      const sliced = longer.slice(0, m)
      if (JSON.stringify(shorter) !== JSON.stringify(sliced)) {
        mismatches.push(`m=${m}: ${JSON.stringify(shorter)} vs ${JSON.stringify(sliced)}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe("deriveMines — distinctness", () => {
  it("distinct: for every m in 1..24, result has length m, entries in 0..24, all distinct", async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) => i + 1).map((m) => deriveMines(seed, m)),
    )
    const mismatches: string[] = []
    for (let m = 1; m <= 24; m++) {
      const set = results[m - 1]
      if (set.length !== m) mismatches.push(`m=${m}: length ${set.length}`)
      if (!set.every((n) => Number.isInteger(n) && n >= 0 && n <= 24)) {
        mismatches.push(`m=${m}: out-of-range entry in ${JSON.stringify(set)}`)
      }
      if (new Set(set).size !== m) mismatches.push(`m=${m}: duplicate entry in ${JSON.stringify(set)}`)
    }
    expect(mismatches).toEqual([])
  })
})

describe("deriveMines — seed sensitivity", () => {
  it("seed-sensitive: a different nonce produces a different mine set at m=5", async () => {
    const a = await deriveMines(seed, 5)
    const b = await deriveMines({ ...seed, nonce: 2 }, 5)
    expect(a).not.toEqual(b)
  })
})
