// Client-side file rejection for the profile photo uploader.
//
// This guard is UX only — it fails fast before a doomed round-trip. The real
// boundary is avatarUploader's 4MB image cap in app/api/uploadthing/core.ts.
// These bounds must stay in sync with it.

import { describe, it, expect } from "vitest"
import { rejectFile } from "@/components/profile/avatar-upload"

const MB = 1024 * 1024

describe("rejectFile", () => {
  it("accepts an image under the 4MB cap", () => {
    expect(rejectFile({ size: 2 * MB, type: "image/jpeg" })).toBeNull()
    expect(rejectFile({ size: 1, type: "image/gif" })).toBeNull()
  })

  it("rejects non-images", () => {
    expect(rejectFile({ size: 1, type: "application/pdf" })).toMatch(/isn't an image/)
    expect(rejectFile({ size: 1, type: "video/mp4" })).toMatch(/isn't an image/)
  })

  it("rejects images over 4MB", () => {
    expect(rejectFile({ size: 4 * MB + 1, type: "image/png" })).toMatch(/over 4MB/)
  })

  it("accepts an image exactly at the 4MB cap", () => {
    expect(rejectFile({ size: 4 * MB, type: "image/png" })).toBeNull()
  })

  it("checks type before size, so a huge non-image reports the type problem", () => {
    expect(rejectFile({ size: 99 * MB, type: "application/zip" })).toMatch(/isn't an image/)
  })
})
