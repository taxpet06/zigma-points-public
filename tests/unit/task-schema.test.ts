import { describe, it, expect } from "vitest"
import {
  createTaskSchema,
  updateTaskSchema,
  updateBalanceSchema,
  completeTaskSchema,
} from "@/lib/validation/task"
import { createReplySchema } from "@/lib/validation/reply"

// ---------------------------------------------------------------------------
// createTaskSchema
// ---------------------------------------------------------------------------

const validTask = {
  title: "T",
  description: "D",
  zpReward: 1,
}

describe("createTaskSchema", () => {
  it("accepts a minimal valid task", () => {
    expect(createTaskSchema.safeParse(validTask).success).toBe(true)
  })

  it("coerces zpReward from string '5' to number 5", () => {
    const result = createTaskSchema.safeParse({ ...validTask, zpReward: "5" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.zpReward).toBe(5)
  })

  it("rejects zpReward of 0", () => {
    expect(createTaskSchema.safeParse({ ...validTask, zpReward: 0 }).success).toBe(false)
  })

  it("rejects negative zpReward", () => {
    expect(createTaskSchema.safeParse({ ...validTask, zpReward: -1 }).success).toBe(false)
  })

  it("rejects non-integer zpReward", () => {
    expect(createTaskSchema.safeParse({ ...validTask, zpReward: 1.5 }).success).toBe(false)
  })

  it("rejects empty title", () => {
    expect(createTaskSchema.safeParse({ ...validTask, title: "" }).success).toBe(false)
  })

  it("rejects title over 200 characters", () => {
    expect(createTaskSchema.safeParse({ ...validTask, title: "a".repeat(201) }).success).toBe(false)
  })

  it("rejects empty description", () => {
    expect(createTaskSchema.safeParse({ ...validTask, description: "" }).success).toBe(false)
  })

  it("rejects description over 2000 characters", () => {
    expect(createTaskSchema.safeParse({ ...validTask, description: "a".repeat(2001) }).success).toBe(false)
  })

  it("accepts optional mediaUrl as valid URL", () => {
    expect(
      createTaskSchema.safeParse({ ...validTask, mediaUrl: "https://utfs.io/f/abc123.jpg" }).success
    ).toBe(true)
  })

  it("rejects invalid mediaUrl", () => {
    expect(createTaskSchema.safeParse({ ...validTask, mediaUrl: "not-a-url" }).success).toBe(false)
  })

  it("does not include adminId in schema shape (mass-assignment guard)", () => {
    const shape = createTaskSchema.shape
    expect("adminId" in shape).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// betsCloseAt — betting cutoff (create + update)
// ---------------------------------------------------------------------------

const betBase = {
  title: "Who wins?",
  description: "Pick one.",
  kind: "BET" as const,
  minBet: 1,
  choices: ["A", "B"],
}

describe("createTaskSchema betsCloseAt", () => {
  it("accepts a future close time and coerces it to a Date", () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const parsed = createTaskSchema.parse({ ...betBase, betsCloseAt: future })
    expect(parsed.betsCloseAt).toBeInstanceOf(Date)
  })

  it("treats an empty datetime-local value as no cutoff", () => {
    const parsed = createTaskSchema.parse({ ...betBase, betsCloseAt: "" })
    expect(parsed.betsCloseAt).toBeUndefined()
  })

  it("rejects a close time in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(createTaskSchema.safeParse({ ...betBase, betsCloseAt: past }).success).toBe(false)
  })
})

describe("updateTaskSchema betsCloseAt", () => {
  const updateBase = { taskId: "t1", title: "T", description: "D" }

  it("accepts a future close time", () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const parsed = updateTaskSchema.parse({ ...updateBase, betsCloseAt: future })
    expect(parsed.betsCloseAt).toBeInstanceOf(Date)
  })

  it("maps an emptied datetime-local field to null (clear the cutoff)", () => {
    const parsed = updateTaskSchema.parse({ ...updateBase, betsCloseAt: "" })
    expect(parsed.betsCloseAt).toBeNull()
  })

  it("explicit null clears the cutoff (not coerced to 1970)", () => {
    const parsed = updateTaskSchema.parse({ ...updateBase, betsCloseAt: null })
    expect(parsed.betsCloseAt).toBeNull()
  })

  it("omitted betsCloseAt stays undefined (leave unchanged)", () => {
    const parsed = updateTaskSchema.parse(updateBase)
    expect(parsed.betsCloseAt).toBeUndefined()
  })

  it("rejects a close time in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(updateTaskSchema.safeParse({ ...updateBase, betsCloseAt: past }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// updateBalanceSchema
// ---------------------------------------------------------------------------

describe("updateBalanceSchema", () => {
  it("accepts { userId: 'u1', newBalance: 0 }", () => {
    expect(updateBalanceSchema.safeParse({ userId: "u1", newBalance: 0 }).success).toBe(true)
  })

  it("accepts { userId: 'u1', newBalance: 50 }", () => {
    expect(updateBalanceSchema.safeParse({ userId: "u1", newBalance: 50 }).success).toBe(true)
  })

  it("accepts negative newBalance", () => {
    expect(updateBalanceSchema.safeParse({ userId: "u1", newBalance: -1 }).success).toBe(true)
  })

  it("rejects non-integer newBalance", () => {
    expect(updateBalanceSchema.safeParse({ userId: "u1", newBalance: 10.5 }).success).toBe(false)
  })

  it("rejects empty userId", () => {
    expect(updateBalanceSchema.safeParse({ userId: "", newBalance: 10 }).success).toBe(false)
  })

  it("does not include reason in schema shape (D-06)", () => {
    const shape = updateBalanceSchema.shape
    expect("reason" in shape).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// completeTaskSchema
// ---------------------------------------------------------------------------

describe("completeTaskSchema", () => {
  it("accepts { taskId: 't1', replyId: 'r1' }", () => {
    expect(completeTaskSchema.safeParse({ taskId: "t1", replyId: "r1" }).success).toBe(true)
  })

  it("rejects empty taskId", () => {
    expect(completeTaskSchema.safeParse({ taskId: "", replyId: "r1" }).success).toBe(false)
  })

  it("rejects empty replyId", () => {
    expect(completeTaskSchema.safeParse({ taskId: "t1", replyId: "" }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createReplySchema (XOR refine: exactly one of postId/taskId)
// ---------------------------------------------------------------------------

describe("createReplySchema (XOR refine)", () => {
  it("accepts { postId: 'p1', content: 'hi' } (postId only)", () => {
    expect(createReplySchema.safeParse({ postId: "p1", content: "hi" }).success).toBe(true)
  })

  it("accepts { taskId: 't1', content: 'hi' } (taskId only)", () => {
    expect(createReplySchema.safeParse({ taskId: "t1", content: "hi" }).success).toBe(true)
  })

  it("rejects { postId: 'p1', taskId: 't1', content: 'hi' } (both set)", () => {
    expect(
      createReplySchema.safeParse({ postId: "p1", taskId: "t1", content: "hi" }).success
    ).toBe(false)
  })

  it("rejects { content: 'hi' } (neither set)", () => {
    expect(createReplySchema.safeParse({ content: "hi" }).success).toBe(false)
  })

  it("accepts optional parentId alongside postId", () => {
    expect(
      createReplySchema.safeParse({ postId: "p1", parentId: "parent1", content: "hi" }).success
    ).toBe(true)
  })

  it("accepts optional mediaUrl alongside taskId", () => {
    expect(
      createReplySchema.safeParse({
        taskId: "t1",
        content: "hi",
        mediaUrl: "https://utfs.io/f/abc123.jpg",
      }).success
    ).toBe(true)
  })

  it("rejects empty content", () => {
    expect(createReplySchema.safeParse({ postId: "p1", content: "" }).success).toBe(false)
  })
})
