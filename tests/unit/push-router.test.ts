import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the db module — pushSubscription.upsert spy, mirrors notify-new-post.test.ts's mocking pattern.
const upsertMock = vi.fn(async ({ create }: { create: { id?: string } }) => ({ id: "sub-1", ...create }))

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      upsert: (...args: unknown[]) => upsertMock(...(args as [{ create: { id?: string } }])),
    },
  },
}))

// @/trpc/init transitively imports @/auth (next-auth), which imports "next/server" — not
// resolvable in the Vitest node environment. Mock it out; createCaller supplies ctx directly
// so the real auth() implementation is never exercised by this test anyway.
vi.mock("@/auth", () => ({ auth: vi.fn() }))

import { createCallerFactory } from "@/trpc/init"
import { pushRouter } from "@/trpc/routers/push"
import { subscribeSchema } from "@/lib/validation/push"

const createCaller = createCallerFactory(pushRouter)

describe("push.subscribe", () => {
  beforeEach(() => {
    upsertMock.mockClear()
  })

  it("upserts by endpoint with userId sourced from the session (not client input)", async () => {
    const sessionUserId = "session-user-1"
    const caller = createCaller({
      session: { user: { id: sessionUserId } },
    } as never)

    const input = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: "p256dh-key",
      auth: "auth-key",
    }

    await caller.subscribe(input)

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const call = upsertMock.mock.calls[0][0] as {
      where: { endpoint: string }
      update: { userId: string }
      create: { userId: string; endpoint: string }
    }
    expect(call.where.endpoint).toBe(input.endpoint)
    // userId written must be the session id — never any client-supplied value
    // (input has no userId field at all, confirming it cannot leak through).
    expect(call.update.userId).toBe(sessionUserId)
    expect(call.create.userId).toBe(sessionUserId)
    expect(call.create.endpoint).toBe(input.endpoint)
  })

  it("throws UNAUTHORIZED before any DB access when there is no session", async () => {
    const caller = createCaller({ session: null } as never)

    await expect(
      caller.subscribe({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        p256dh: "p256dh-key",
        auth: "auth-key",
      }),
    ).rejects.toThrow()
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

describe("subscribeSchema", () => {
  it("rejects a malformed endpoint (not a URL)", () => {
    const result = subscribeSchema.safeParse({
      endpoint: "not-a-url",
      p256dh: "key",
      auth: "key",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty p256dh/auth", () => {
    const result = subscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: "",
      auth: "",
    })
    expect(result.success).toBe(false)
  })

  it("accepts a well-formed subscription", () => {
    const result = subscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: "key",
      auth: "key",
    })
    expect(result.success).toBe(true)
  })
})
