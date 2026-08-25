import { describe, expect, it } from "vitest"
import { scoreGuess, answerForDay, WORD_SET } from "@/components/game-hub/words"

describe("scoreGuess", () => {
  it("marks exact matches correct", () => {
    expect(scoreGuess("crane", "crane")).toEqual([
      "correct", "correct", "correct", "correct", "correct",
    ])
  })

  it("marks absent letters", () => {
    // none of f,g,h,j,k appear in 'crane'
    expect(scoreGuess("fghjk", "crane")).toEqual([
      "absent", "absent", "absent", "absent", "absent",
    ])
  })

  it("does not over-count duplicate guess letters beyond the answer's supply", () => {
    // answer 'abbey' (a,b,b,e,y) vs guess 'babes' (b,a,b,e,s).
    expect(scoreGuess("babes", "abbey")).toEqual([
      "present", // b — in answer, wrong spot
      "present", // a — in answer, wrong spot
      "correct", // b — exact
      "correct", // e — exact
      "absent",  // s — not in answer
    ])
  })

  it("greens take priority, and leftover duplicates draw from the remaining pool", () => {
    // 'eerie' (e,e,r,i,e) vs 'three' (t,h,r,e,e): i2 'r' and i4 'e' are exact.
    expect(scoreGuess("eerie", "three")).toEqual([
      "present", // e — one e left in the pool after greens
      "absent",  // e — pool exhausted
      "correct", // r
      "absent",  // i
      "correct", // e
    ])
  })
})

describe("answerForDay", () => {
  it("is deterministic per UTC day and always a valid dictionary word", () => {
    const d = new Date("2026-07-17T09:00:00Z")
    const a = answerForDay(d)
    expect(a).toBe(answerForDay(new Date("2026-07-17T23:59:00Z")))
    expect(a).toHaveLength(5)
    expect(WORD_SET.has(a)).toBe(true)
  })
})
