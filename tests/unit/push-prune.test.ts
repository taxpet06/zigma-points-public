import { describe, it, expect, vi, beforeEach } from "vitest"

const sendNotificationMock = vi.fn()
const setVapidDetailsMock = vi.fn()

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}))

const findManyMock = vi.fn()
const deleteMock = vi.fn()

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
  },
}))

describe("sendPushToUser", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key")
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key")
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com")
    findManyMock.mockReset()
    deleteMock.mockReset()
    sendNotificationMock.mockReset()
  })

  it("deletes the subscription row on a 410 Gone response", async () => {
    const sub = { id: "sub-1", userId: "user-1", endpoint: "https://push.example/1", p256dh: "p", auth: "a" }
    findManyMock.mockResolvedValueOnce([sub])
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }))
    deleteMock.mockResolvedValueOnce({ id: sub.id })

    const { sendPushToUser } = await import("@/lib/push")
    await sendPushToUser("user-1", { title: "t", body: "b", url: "/x" })

    expect(deleteMock).toHaveBeenCalledWith({ where: { endpoint: sub.endpoint } })
  })

  it("does NOT delete the subscription row on a non-410/404 error (e.g. 500)", async () => {
    const sub = { id: "sub-2", userId: "user-1", endpoint: "https://push.example/2", p256dh: "p", auth: "a" }
    findManyMock.mockResolvedValueOnce([sub])
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error("Server Error"), { statusCode: 500 }))

    const { sendPushToUser } = await import("@/lib/push")
    await sendPushToUser("user-1", { title: "t", body: "b", url: "/x" })

    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("is a no-op (never throws) when VAPID env vars are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "")
    vi.stubEnv("VAPID_PRIVATE_KEY", "")
    vi.stubEnv("VAPID_SUBJECT", "")

    // Reset modules so push.ts's memoized `configured` flag doesn't leak from a prior test.
    vi.resetModules()
    const { sendPushToUser } = await import("@/lib/push")

    await expect(sendPushToUser("user-1", { title: "t", body: "b", url: "/x" })).resolves.toBeUndefined()
    expect(findManyMock).not.toHaveBeenCalled()
  })
})
