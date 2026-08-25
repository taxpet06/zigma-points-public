import { describe, it, expect } from "vitest"
import {
  sendZpSchema,
  requestZpSchema,
  respondTransferSchema,
  owedAmount,
  repayment,
} from "@/lib/validation/transfer"

const future = () => new Date(Date.now() + 86_400_000)
const past = new Date("2020-01-01T00:00:00Z")

describe("sendZpSchema / requestZpSchema", () => {
  it("accepts a valid single-recipient send", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5 }).success).toBe(true)
  })

  it("accepts multiple recipients", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1", "u2"], amount: 5 }).success).toBe(true)
    expect(requestZpSchema.safeParse({ fromUserIds: ["u1", "u2"], amount: 5 }).success).toBe(true)
  })

  it("coerces amount from string '5' to number 5", () => {
    const r = sendZpSchema.safeParse({ toUserIds: ["u1"], amount: "5" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(5)
  })

  it("rejects amount of 0", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 0 }).success).toBe(false)
  })

  it("rejects negative amount", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: -3 }).success).toBe(false)
  })

  it("rejects non-integer amount", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 1.5 }).success).toBe(false)
  })

  it("rejects an empty recipient list", () => {
    expect(sendZpSchema.safeParse({ toUserIds: [], amount: 5 }).success).toBe(false)
    expect(requestZpSchema.safeParse({ fromUserIds: [], amount: 5 }).success).toBe(false)
  })

  it("rejects a note over 160 chars", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, note: "x".repeat(161) }).success).toBe(false)
  })
})

describe("loan fields", () => {
  it("accepts a send with no loan fields at all", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5 }).success).toBe(true)
  })

  it("accepts a complete loan on both schemas", () => {
    expect(
      sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, interestPct: 10, dueAt: future() }).success
    ).toBe(true)
    expect(
      requestZpSchema.safeParse({ fromUserIds: ["u1"], amount: 5, interestPct: 10, dueAt: future() }).success
    ).toBe(true)
  })

  it("rejects interestPct without dueAt, and dueAt without interestPct", () => {
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, interestPct: 10 }).success).toBe(false)
    expect(sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, dueAt: future() }).success).toBe(false)
    expect(requestZpSchema.safeParse({ fromUserIds: ["u1"], amount: 5, interestPct: 10 }).success).toBe(false)
    expect(requestZpSchema.safeParse({ fromUserIds: ["u1"], amount: 5, dueAt: future() }).success).toBe(false)
  })

  it("rejects a dueAt in the past", () => {
    expect(
      sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, interestPct: 10, dueAt: past }).success
    ).toBe(false)
    expect(
      requestZpSchema.safeParse({ fromUserIds: ["u1"], amount: 5, interestPct: 10, dueAt: past }).success
    ).toBe(false)
  })

  it("bounds interestPct to an integer 0..1000", () => {
    for (const bad of [-1, 1001, 1.5]) {
      expect(
        sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, interestPct: bad, dueAt: future() }).success
      ).toBe(false)
      expect(
        requestZpSchema.safeParse({ fromUserIds: ["u1"], amount: 5, interestPct: bad, dueAt: future() }).success
      ).toBe(false)
    }
    for (const ok of [0, 1000]) {
      expect(
        sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, interestPct: ok, dueAt: future() }).success
      ).toBe(true)
      expect(
        requestZpSchema.safeParse({ fromUserIds: ["u1"], amount: 5, interestPct: ok, dueAt: future() }).success
      ).toBe(true)
    }
  })

  it("accepts a datetime-local string for dueAt", () => {
    const d = future()
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T12:00`
    expect(
      sendZpSchema.safeParse({ toUserIds: ["u1"], amount: 5, interestPct: 10, dueAt: local }).success
    ).toBe(true)
  })
})

describe("owedAmount", () => {
  it("adds simple interest", () => {
    expect(owedAmount(100, 10)).toBe(110)
  })

  it("treats 0% as a legal loan, not a no-op", () => {
    expect(owedAmount(100, 0)).toBe(100)
  })

  it("rounds interest UP", () => {
    expect(owedAmount(7, 5)).toBe(8) // 0.35 → 1
    expect(owedAmount(3, 50)).toBe(5) // 1.5 → 2
  })
})

describe("repayment direction", () => {
  // The row shape is identical either way: borrower = toUserId, lender = fromUserId.
  // Send loan:    lender created the row and paid out at creation.
  // Request loan: borrower created the row; the lender (fromUser) paid on approval.
  const expected = { borrowerId: "borrower", lenderId: "lender", owed: 110 }

  it("collects from toUser and pays fromUser on a Send-shaped loan", () => {
    expect(
      repayment({ fromUserId: "lender", toUserId: "borrower", amount: 100, interestPct: 10 })
    ).toEqual(expected)
  })

  it("collects from toUser and pays fromUser on a Request-shaped loan", () => {
    expect(
      repayment({ fromUserId: "lender", toUserId: "borrower", amount: 100, interestPct: 10 })
    ).toEqual(expected)
  })

  it("treats a null interestPct as 0%", () => {
    expect(repayment({ fromUserId: "l", toUserId: "b", amount: 40, interestPct: null }).owed).toBe(40)
  })
})

describe("respondTransferSchema", () => {
  it("accepts APPROVE and REJECT", () => {
    expect(respondTransferSchema.safeParse({ transferId: "t1", action: "APPROVE" }).success).toBe(true)
    expect(respondTransferSchema.safeParse({ transferId: "t1", action: "REJECT" }).success).toBe(true)
  })

  it("rejects an unknown action", () => {
    expect(respondTransferSchema.safeParse({ transferId: "t1", action: "MAYBE" }).success).toBe(false)
  })
})
