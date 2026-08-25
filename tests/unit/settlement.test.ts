import { describe, it, expect, vi } from "vitest"

// Mock the db module — settlePost just builds the ops array, so mocks return identifiable objects.
vi.mock("@/lib/db", () => ({
  db: {
    post: {
      update: vi.fn((args) => ({ ...args, __op: "post.update" })),
    },
    user: {
      update: vi.fn((args) => ({ ...args, __op: "user.update" })),
    },
  },
}))

import { settlePost } from "@/lib/settlement"

type MockOp = {
  __op: string
  where: { id?: string }
  data: {
    settled?: boolean
    outcome?: string
    zigmaPoints?: { increment?: number; decrement?: number }
  }
}

function makePost(overrides: {
  type?: "AWARD" | "DEDUCT"
  zpAmount?: number
  targets?: { userId: string }[]
  votes?: { type: "AGREE" | "DISAGREE" }[]
}) {
  return {
    id: "post-1",
    authorId: "user-author",
    type: (overrides.type ?? "AWARD") as "AWARD" | "DEDUCT",
    zpAmount: overrides.zpAmount ?? 10,
    targets: overrides.targets ?? [{ userId: "user-target" }],
    votes: overrides.votes ?? [],
  }
}

describe("settlePost", () => {
  it("agrees > disagrees → Awarded, 3 ops (post update + target balance + author reward)", () => {
    const post = makePost({
      type: "AWARD",
      zpAmount: 10,
      votes: [
        { type: "AGREE" },
        { type: "AGREE" },
        { type: "AGREE" },
        { type: "DISAGREE" },
      ],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(3)
    expect(ops[0].__op).toBe("post.update")
    expect(ops[0].data.outcome).toBe("Awarded")
    expect(ops[0].data.settled).toBe(true)
    // Compare-and-set against the cron's snapshot: if an admin cancelled this post
    // between the read and this write, no row matches, Prisma throws, and the whole
    // $transaction rolls back — so a cancelled post can never be credited.
    expect(ops[0].where).toEqual({ id: "post-1", settled: false })
    expect(ops[1].__op).toBe("user.update")
    expect(ops[1].data.zigmaPoints?.increment).toBe(10)
    // Last op is the author reward: strictly an increment, capped at 3 (post awards 10).
    expect(ops[2].where.id).toBe("user-author")
    expect(ops[2].data.zigmaPoints?.increment).toBe(3)
  })

  it("author reward below the cap passes through un-capped (zpAmount 2 → author +2)", () => {
    const post = makePost({
      type: "AWARD",
      zpAmount: 2,
      votes: [{ type: "AGREE" }, { type: "AGREE" }, { type: "DISAGREE" }],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(3)
    expect(ops[1].data.zigmaPoints).toHaveProperty("increment", 2) // target
    expect(ops[2].where.id).toBe("user-author")
    expect(ops[2].data.zigmaPoints).toHaveProperty("increment", 2) // author, under cap
  })

  it("tie (agrees === disagrees) → Rejected, 1 op (post update only)", () => {
    const post = makePost({
      votes: [
        { type: "AGREE" },
        { type: "AGREE" },
        { type: "DISAGREE" },
        { type: "DISAGREE" },
      ],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(1)
    expect(ops[0].data.outcome).toBe("Rejected")
  })

  it("zero votes → Rejected, 1 op", () => {
    const post = makePost({ votes: [] })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(1)
    expect(ops[0].data.outcome).toBe("Rejected")
  })

  it("disagrees > agrees → Rejected, 1 op", () => {
    const post = makePost({
      votes: [
        { type: "AGREE" },
        { type: "DISAGREE" },
        { type: "DISAGREE" },
        { type: "DISAGREE" },
      ],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(1)
    expect(ops[0].data.outcome).toBe("Rejected")
  })

  it("AWARD Awarded → target zigmaPoints increment + author reward", () => {
    const post = makePost({
      type: "AWARD",
      zpAmount: 25,
      votes: [{ type: "AGREE" }, { type: "AGREE" }, { type: "DISAGREE" }],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(3)
    expect(ops[1].data.zigmaPoints).toHaveProperty("increment", 25)
    expect(ops[1].data.zigmaPoints).not.toHaveProperty("decrement")
    // Author reward is capped at 3 even though the post awards 25.
    expect(ops[2].where.id).toBe("user-author")
    expect(ops[2].data.zigmaPoints).toHaveProperty("increment", 3)
  })

  it("DEDUCT Awarded → target decrement, author still rewarded the absolute value", () => {
    const post = makePost({
      type: "DEDUCT",
      zpAmount: 15,
      votes: [{ type: "AGREE" }, { type: "AGREE" }, { type: "DISAGREE" }],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(3)
    expect(ops[1].data.zigmaPoints).toHaveProperty("decrement", 15)
    expect(ops[1].data.zigmaPoints).not.toHaveProperty("increment")
    // Author is strictly awarded even for a DEDUCT post, capped at 3 (post awards 15).
    expect(ops[2].where.id).toBe("user-author")
    expect(ops[2].data.zigmaPoints).toHaveProperty("increment", 3)
    expect(ops[2].data.zigmaPoints).not.toHaveProperty("decrement")
  })

  it("Rejected → no balance op (ops.length 1)", () => {
    const post = makePost({
      votes: [{ type: "DISAGREE" }],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(1)
    expect(ops[0].data.outcome).toBe("Rejected")
  })

  it("multi-target AWARD Awarded → 1 post update + one balance op per target + author reward, each +zpAmount (M-01)", () => {
    const post = makePost({
      type: "AWARD",
      zpAmount: 10,
      targets: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }],
      votes: [{ type: "AGREE" }, { type: "AGREE" }, { type: "DISAGREE" }],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(5) // 1 post.update + 3 target user.update + 1 author user.update
    expect(ops[0].__op).toBe("post.update")
    // Targets each get the full zpAmount (10); the author reward (last op) is capped at 3.
    const targetOps = ops.slice(1, 4)
    expect(targetOps.map((o) => o.where.id)).toEqual(["u1", "u2", "u3"])
    for (const op of targetOps) {
      expect(op.__op).toBe("user.update")
      expect(op.data.zigmaPoints).toHaveProperty("increment", 10)
    }
    expect(ops[4].where.id).toBe("user-author")
    expect(ops[4].data.zigmaPoints).toHaveProperty("increment", 3)
  })

  it("multi-target Rejected → no balance ops regardless of target count (M-01)", () => {
    const post = makePost({
      targets: [{ userId: "u1" }, { userId: "u2" }],
      votes: [{ type: "DISAGREE" }],
    })
    const ops = settlePost(post) as unknown as MockOp[]
    expect(ops).toHaveLength(1)
    expect(ops[0].data.outcome).toBe("Rejected")
  })
})
