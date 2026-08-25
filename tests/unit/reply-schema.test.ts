import { describe, it, expect } from "vitest"
import { createReplySchema } from "@/lib/validation/reply"

const valid = {
  postId: "post-123",
  content: "Great point!",
}

describe("createReplySchema", () => {
  it("accepts a valid reply with content only", () => {
    expect(createReplySchema.safeParse(valid).success).toBe(true)
  })

  it("accepts a valid reply with parentId (nested)", () => {
    expect(createReplySchema.safeParse({ ...valid, parentId: "reply-456" }).success).toBe(true)
  })

  it("accepts a valid reply with a valid https mediaUrl", () => {
    expect(createReplySchema.safeParse({ ...valid, mediaUrl: "https://utfs.io/f/abc123.jpg" }).success).toBe(true)
  })

  it("rejects empty content", () => {
    expect(createReplySchema.safeParse({ ...valid, content: "" }).success).toBe(false)
  })

  it("rejects whitespace-only content", () => {
    expect(createReplySchema.safeParse({ ...valid, content: "   " }).success).toBe(false)
  })

  it("rejects content over 1000 characters", () => {
    expect(createReplySchema.safeParse({ ...valid, content: "a".repeat(1001) }).success).toBe(false)
  })

  it("rejects an invalid mediaUrl", () => {
    expect(createReplySchema.safeParse({ ...valid, mediaUrl: "not-a-url" }).success).toBe(false)
  })

  it("does not expose authorId in schema shape", () => {
    const shape = createReplySchema.shape
    expect("authorId" in shape).toBe(false)
  })
})
