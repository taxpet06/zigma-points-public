import { describe, it, expect } from "vitest"
import { usernameSchema } from "@/lib/validation/username"

describe("usernameSchema", () => {
  it("accepts a valid lowercase alphanumeric + underscore username (8 chars)", () => {
    const result = usernameSchema.safeParse("alice_99")
    expect(result.success).toBe(true)
  })

  it("rejects a username that is too short (< 3 chars)", () => {
    const result = usernameSchema.safeParse("Al")
    expect(result.success).toBe(false)
  })

  it("rejects a username that is too long (> 20 chars)", () => {
    const result = usernameSchema.safeParse("a".repeat(21))
    expect(result.success).toBe(false)
  })

  it("rejects a username with uppercase letters", () => {
    const result = usernameSchema.safeParse("Alice")
    expect(result.success).toBe(false)
  })

  it("rejects a username with spaces", () => {
    const result = usernameSchema.safeParse("al ice")
    expect(result.success).toBe(false)
  })

  it("rejects a username with hyphens", () => {
    const result = usernameSchema.safeParse("al-ice")
    expect(result.success).toBe(false)
  })
})
