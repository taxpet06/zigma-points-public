import { describe, test, expect } from "vitest"
import { deriveVoteState } from "@/lib/validation/vote"

describe("deriveVoteState", () => {
  test("null returns 'none'", () => {
    expect(deriveVoteState(null)).toBe("none")
  })

  test("{ type: 'AGREE' } returns 'agree'", () => {
    expect(deriveVoteState({ type: "AGREE" })).toBe("agree")
  })

  test("{ type: 'DISAGREE' } returns 'disagree'", () => {
    expect(deriveVoteState({ type: "DISAGREE" })).toBe("disagree")
  })
})
