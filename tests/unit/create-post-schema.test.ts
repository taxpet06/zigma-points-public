import { describe, it, expect } from "vitest"
import { createPostSchema } from "@/lib/validation/post"

const valid = {
  type: "AWARD" as const,
  targetUserIds: ["user-123"],
  title: "Great work",
  explanation: "Did something excellent",
  zpAmount: 10,
}

describe("createPostSchema", () => {
  it("accepts a valid AWARD post", () => {
    expect(createPostSchema.safeParse(valid).success).toBe(true)
  })

  it("accepts a valid DEDUCT post", () => {
    expect(createPostSchema.safeParse({ ...valid, type: "DEDUCT" }).success).toBe(true)
  })

  it("accepts multiple target users (M-01)", () => {
    expect(
      createPostSchema.safeParse({ ...valid, targetUserIds: ["u1", "u2", "u3"] }).success
    ).toBe(true)
  })

  it("rejects an empty target list", () => {
    expect(createPostSchema.safeParse({ ...valid, targetUserIds: [] }).success).toBe(false)
  })

  it("rejects more than 20 target users", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `u${i}`)
    expect(createPostSchema.safeParse({ ...valid, targetUserIds: tooMany }).success).toBe(false)
  })

  it("rejects an invalid type", () => {
    expect(createPostSchema.safeParse({ ...valid, type: "TASK" }).success).toBe(false)
  })

  it("rejects an AWARD with no explanation — the relaxed base field is required back by type", () => {
    expect(createPostSchema.safeParse({ ...valid, explanation: undefined }).success).toBe(false)
  })

  it("rejects an AWARD with no zpAmount", () => {
    expect(createPostSchema.safeParse({ ...valid, zpAmount: undefined }).success).toBe(false)
  })

  it("coerces zpAmount from string '5' to number 5", () => {
    const result = createPostSchema.safeParse({ ...valid, zpAmount: "5" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.zpAmount).toBe(5)
  })

  it("rejects zpAmount of 0", () => {
    expect(createPostSchema.safeParse({ ...valid, zpAmount: 0 }).success).toBe(false)
  })

  it("rejects negative zpAmount", () => {
    expect(createPostSchema.safeParse({ ...valid, zpAmount: -1 }).success).toBe(false)
  })

  it("rejects non-integer zpAmount", () => {
    expect(createPostSchema.safeParse({ ...valid, zpAmount: 1.5 }).success).toBe(false)
  })

  it("rejects empty title", () => {
    expect(createPostSchema.safeParse({ ...valid, title: "" }).success).toBe(false)
  })

  it("rejects title over 100 characters", () => {
    expect(createPostSchema.safeParse({ ...valid, title: "a".repeat(101) }).success).toBe(false)
  })

  it("rejects empty explanation", () => {
    expect(createPostSchema.safeParse({ ...valid, explanation: "" }).success).toBe(false)
  })

  it("rejects explanation over 1000 characters", () => {
    expect(createPostSchema.safeParse({ ...valid, explanation: "a".repeat(1001) }).success).toBe(false)
  })

  it("accepts post without mediaUrl (mediaUrl is optional)", () => {
    const { mediaUrl: _, ...noMedia } = { ...valid, mediaUrl: undefined }
    expect(createPostSchema.safeParse(noMedia).success).toBe(true)
  })

  it("accepts a valid mediaUrl", () => {
    expect(createPostSchema.safeParse({ ...valid, mediaUrl: "https://utfs.io/f/abc123.jpg" }).success).toBe(true)
  })

  it("rejects an invalid mediaUrl", () => {
    expect(createPostSchema.safeParse({ ...valid, mediaUrl: "not-a-url" }).success).toBe(false)
  })

  it("does not expose server-only fields in schema shape", () => {
    const shape = createPostSchema.shape
    expect("settled" in shape).toBe(false)
    expect("outcome" in shape).toBe(false)
    expect("votingEndsAt" in shape).toBe(false)
    expect("authorId" in shape).toBe(false)
  })
})

// A REGULAR post is title-only: no targets, no explanation, no ZP. The requirements the
// AWARD/DEDUCT path enforces must all fall away for it — that is the whole feature.
describe("createPostSchema — REGULAR posts", () => {
  it("accepts a title and nothing else", () => {
    expect(createPostSchema.safeParse({ type: "REGULAR", title: "Hello" }).success).toBe(true)
  })

  it("still requires a title", () => {
    expect(createPostSchema.safeParse({ type: "REGULAR", title: "" }).success).toBe(false)
  })

  it("accepts an optional description and images", () => {
    const result = createPostSchema.safeParse({
      type: "REGULAR",
      title: "Hello",
      explanation: "Some more detail",
      images: ["https://utfs.io/f/a.jpg", "https://utfs.io/f/b.jpg"],
    })
    expect(result.success).toBe(true)
  })

  it("defaults targetUserIds to an empty list rather than demanding one", () => {
    const result = createPostSchema.safeParse({ type: "REGULAR", title: "Hello" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.targetUserIds).toEqual([])
  })

  it("still enforces the shared caps — title length, description length, image count", () => {
    const base = { type: "REGULAR" as const, title: "Hello" }
    expect(createPostSchema.safeParse({ ...base, title: "a".repeat(101) }).success).toBe(false)
    expect(createPostSchema.safeParse({ ...base, explanation: "a".repeat(1001) }).success).toBe(false)
    const tooManyImages = Array.from({ length: 11 }, (_, i) => `https://utfs.io/f/${i}.jpg`)
    expect(createPostSchema.safeParse({ ...base, images: tooManyImages }).success).toBe(false)
  })
})
