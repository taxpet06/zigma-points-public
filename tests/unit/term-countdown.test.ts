import { describe, it, expect } from "vitest"
import { formatTermRemaining } from "@/components/nav/term-countdown"

const NOW = new Date("2026-08-24T12:00:00Z").getTime()
const at = (ms: number) => formatTermRemaining(new Date(NOW + ms), NOW)

describe("formatTermRemaining", () => {
  it("shows days, hours and minutes while the term runs", () => {
    expect(at((3 * 1440 + 4 * 60 + 5) * 60_000)).toBe("3d 4h 5m")
  })

  it("drops the days segment inside the last day", () => {
    expect(at((4 * 60 + 5) * 60_000)).toBe("4h 5m")
  })

  it("floors partial minutes", () => {
    expect(at(59_000)).toBe("0h 0m")
  })

  it("reads Term Ended at and after the end", () => {
    expect(at(0)).toBe("Term Ended")
    expect(at(-1)).toBe("Term Ended")
  })
})
