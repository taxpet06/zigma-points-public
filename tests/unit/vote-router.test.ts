// TODO: these are integration tests — filled in after Wave 1 procedures are implemented

import { describe, test } from "vitest"

describe("castVote", () => {
  test.todo("rejects unauthenticated")
  test.todo("upserts vote row")
  test.todo("throws FORBIDDEN when votingEndsAt passed")
  test.todo("throws FORBIDDEN when voting on own post")
  test.todo("allows flipping vote type via upsert")
})

describe("retractVote", () => {
  test.todo("rejects unauthenticated")
  test.todo("deletes vote row")
  test.todo("no-ops if vote does not exist")
  test.todo("throws FORBIDDEN when votingEndsAt passed")
})
