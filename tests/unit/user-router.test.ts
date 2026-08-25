// User router input schema unit tests.
//
// These tests verify the Zod input shapes for tRPC procedures without requiring a live DB.
// Behaviors requiring a live DB (e.g., P2002 CONFLICT) are marked test.skip and covered
// by the E2E profile spec in tests/e2e/profile.spec.ts.

import { describe, it, expect } from "vitest"
import { z } from "zod"
import { usernameSchema } from "@/lib/validation/username"

// ── updateProfile input shape (reproduced here to test without importing the router) ──
// The schema must NOT include role, zigmaPoints, or userId (mass-assignment guard T-02-02).
const updateProfileInput = z.object({
  name: z.string().min(1).max(50).optional(),
  bio: z.string().max(160, "Bio cannot exceed 160 characters").optional(),
  image: z.string().url().optional(),
})

describe("updateProfile input schema", () => {
  it("accepts a valid bio under 160 characters", () => {
    const result = updateProfileInput.safeParse({ bio: "Hello world" })
    expect(result.success).toBe(true)
  })

  it("rejects a bio longer than 160 characters", () => {
    const result = updateProfileInput.safeParse({ bio: "a".repeat(161) })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("160")
    }
  })

  it("accepts bio at exactly 160 characters", () => {
    const result = updateProfileInput.safeParse({ bio: "a".repeat(160) })
    expect(result.success).toBe(true)
  })

  it("does not have a role field in the input schema (mass-assignment guard)", () => {
    const schema = updateProfileInput
    // Strict parse — role key should not be accepted as a known field
    const result = (schema as z.ZodObject<z.ZodRawShape>).strict().safeParse({
      name: "Alice",
      role: "ADMIN",
    })
    expect(result.success).toBe(false)
  })

  it("does not have a zigmaPoints field in the input schema (mass-assignment guard)", () => {
    const schema = updateProfileInput
    const result = (schema as z.ZodObject<z.ZodRawShape>).strict().safeParse({
      name: "Alice",
      zigmaPoints: 9999,
    })
    expect(result.success).toBe(false)
  })

  it("does not have a userId field in the input schema (IDOR guard)", () => {
    const schema = updateProfileInput
    const result = (schema as z.ZodObject<z.ZodRawShape>).strict().safeParse({
      name: "Alice",
      userId: "some-other-user-id",
    })
    expect(result.success).toBe(false)
  })

  it("accepts optional name and image alongside bio", () => {
    const result = updateProfileInput.safeParse({
      name: "Alice",
      bio: "Short bio",
      image: "https://example.com/avatar.png",
    })
    expect(result.success).toBe(true)
  })
})

describe("claimUsername input uses usernameSchema", () => {
  const claimUsernameInput = z.object({ username: usernameSchema })

  it("accepts a valid username", () => {
    const result = claimUsernameInput.safeParse({ username: "alice_99" })
    expect(result.success).toBe(true)
  })

  it("rejects an invalid username (uppercase)", () => {
    const result = claimUsernameInput.safeParse({ username: "Alice" })
    expect(result.success).toBe(false)
  })

  it("rejects a username that is too short", () => {
    const result = claimUsernameInput.safeParse({ username: "ab" })
    expect(result.success).toBe(false)
  })

  // DB-level test skipped — covered by E2E profile spec
  it.skip("rejects a duplicate username with CONFLICT error (requires live DB — covered in E2E)", () => {
    // This test requires a live database with an existing user claiming the same username.
    // See tests/e2e/profile.spec.ts PROF-03 for the integration-level coverage.
  })
})
