import { describe, it, expect } from "vitest"
import { normalizeEmail } from "@/lib/approved-emails"

// normalizeEmail is the whole security story of the allowlist: the admin write and
// the signup lookup must agree on the exact string, or "Bob@Example.com " walks past
// a list that contains "bob@example.com". These cases are that bypass.
describe("normalizeEmail", () => {
  it("lowercases so case cannot bypass the allowlist", () => {
    expect(normalizeEmail("Bob@Example.COM")).toBe("bob@example.com")
  })

  it("trims so padding cannot bypass the allowlist", () => {
    expect(normalizeEmail("  bob@example.com\t")).toBe("bob@example.com")
  })

  it("is idempotent — normalizing a stored value returns it unchanged", () => {
    const once = normalizeEmail("  Bob@Example.COM ")
    expect(normalizeEmail(once)).toBe(once)
  })

  it("leaves an already-canonical address alone", () => {
    expect(normalizeEmail("bob@example.com")).toBe("bob@example.com")
  })
})
