import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the db module — a user with email/notifications on, a null-email user, and a
// findUnique mock reconfigured per-test for the missing/opted-out cases.
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}))

vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(),
}))

import { notifyTradeOffer, notifyListingSold } from "@/lib/notifications"
import { db } from "@/lib/db"
import { sendEmail } from "@/lib/email"
import { sendPushToUser } from "@/lib/push"

const withEmail = { id: "user-1", email: "user1@example.com", name: "User One", emailNotifications: true }
const optedOut = { id: "user-2", email: "user2@example.com", name: "User Two", emailNotifications: false }
const noEmail = { id: "user-3", email: null, name: "User Three", emailNotifications: true }

beforeEach(() => {
  vi.mocked(db.user.findUnique).mockReset()
  vi.mocked(sendEmail).mockClear()
  vi.mocked(sendPushToUser).mockClear()
})

describe("notifyTradeOffer", () => {
  it("resolves without calling sendEmail or sendPushToUser when the recipient row is missing", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null as never)

    await expect(notifyTradeOffer("missing", "Offerer", "Golden Ring", 50)).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it("resolves without calling sendEmail when the recipient's email is null, and does not throw", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(noEmail as never)

    await expect(notifyTradeOffer(noEmail.id, "Offerer", "Golden Ring", 50)).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("calls sendEmail exactly once when emailNotifications is true, and always calls sendPushToUser", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(withEmail as never)

    await notifyTradeOffer(withEmail.id, "Offerer", "Golden Ring", 50)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    expect(sendPushToUser).toHaveBeenCalledWith(withEmail.id, expect.objectContaining({ title: "New trade offer" }))
  })

  it("skips sendEmail when emailNotifications is false, but still calls sendPushToUser", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(optedOut as never)

    await notifyTradeOffer(optedOut.id, "Offerer", "Golden Ring", 50)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it("headline contains the item name and the ZP amount", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(withEmail as never)

    await notifyTradeOffer(withEmail.id, "Offerer", "Golden Ring", 50)

    const pushBody = vi.mocked(sendPushToUser).mock.calls[0][1].body
    expect(pushBody).toContain("Golden Ring")
    expect(pushBody).toContain("50 ZP")
  })
})

describe("notifyListingSold", () => {
  it("resolves without calling sendEmail or sendPushToUser when the seller row is missing", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null as never)

    await expect(notifyListingSold("missing", "Buyer", "Silver Ring", 75)).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it("resolves without calling sendEmail when the seller's email is null, and does not throw", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(noEmail as never)

    await expect(notifyListingSold(noEmail.id, "Buyer", "Silver Ring", 75)).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("calls sendEmail exactly once when emailNotifications is true, and always calls sendPushToUser", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(withEmail as never)

    await notifyListingSold(withEmail.id, "Buyer", "Silver Ring", 75)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    expect(sendPushToUser).toHaveBeenCalledWith(withEmail.id, expect.objectContaining({ title: "Your listing sold" }))
  })

  it("skips sendEmail when emailNotifications is false, but still calls sendPushToUser", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(optedOut as never)

    await notifyListingSold(optedOut.id, "Buyer", "Silver Ring", 75)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it("headline contains the buyer's name, item name and the ZP amount", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(withEmail as never)

    await notifyListingSold(withEmail.id, "Buyer", "Silver Ring", 75)

    const pushBody = vi.mocked(sendPushToUser).mock.calls[0][1].body
    expect(pushBody).toContain("Buyer")
    expect(pushBody).toContain("Silver Ring")
    expect(pushBody).toContain("75 ZP")
  })
})
