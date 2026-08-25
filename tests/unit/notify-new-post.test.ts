import { describe, it, expect, vi } from "vitest"

// Mock the db module — 2 users with a non-null email, 1 with a null email; author lookup.
//
// `emailNotifications` is required on every mocked user: notifications.ts gates each
// sendEmail call on that per-user preference, so a fixture omitting it yields
// `undefined` (falsy) and no email is ever sent — which is exactly why the email
// assertions in this file had been failing. Push is not gated, which is why the push
// assertions kept passing and masked the cause.
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(() => [
        { id: "user-alice", email: "alice@example.com", name: "Alice", emailNotifications: true },
        { id: "user-bob", email: "bob@example.com", name: "Bob", emailNotifications: true },
        { id: "user-noemail", email: null, name: "NoEmail", emailNotifications: true },
      ]),
      findUnique: vi.fn(() => ({
        id: "user-zp",
        email: "zp@example.com",
        name: "ZP User",
        username: "cpuser",
        emailNotifications: true,
      })),
    },
  },
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}))

vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(),
}))

import { notifyNewPost, notifyZpChange } from "@/lib/notifications"
import { sendEmail } from "@/lib/email"
import { sendPushToUser } from "@/lib/push"

describe("notifyNewPost", () => {
  it("emails every non-null-email user and skips the null-email user", async () => {
    await notifyNewPost("post-1", "Great deed", "author-1")

    expect(sendEmail).toHaveBeenCalledTimes(2)
    const calledTo = vi.mocked(sendEmail).mock.calls.map((call) => call[0].to)
    expect(calledTo).toEqual(
      expect.arrayContaining(["alice@example.com", "bob@example.com"]),
    )
    expect(calledTo).not.toContain(null)
  })

  it("also sends a broadcast push to every non-null-email user", async () => {
    vi.mocked(sendPushToUser).mockClear()
    await notifyNewPost("post-1", "Great deed", "author-1")

    expect(sendPushToUser).toHaveBeenCalledTimes(2)
    const calledIds = vi.mocked(sendPushToUser).mock.calls.map((call) => call[0])
    expect(calledIds).toEqual(expect.arrayContaining(["user-alice", "user-bob"]))
  })
})

describe("notifyZpChange", () => {
  it("sends a push to the affected user's id alongside the email", async () => {
    vi.mocked(sendPushToUser).mockClear()
    vi.mocked(sendEmail).mockClear()

    await notifyZpChange("user-zp")

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    expect(sendPushToUser).toHaveBeenCalledWith(
      "user-zp",
      expect.objectContaining({ title: expect.any(String), body: expect.any(String), url: expect.any(String) }),
    )
  })
})
