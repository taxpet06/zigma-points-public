import { describe, it, expect, afterEach } from "vitest"
import { isIOS, isStandalone } from "@/lib/pwa"

// vitest.config.ts runs unit tests under environment "node" — window/navigator
// don't exist by default, so we stub them per-test and clean up after.
function stubGlobals(opts: {
  userAgent: string
  standalone?: boolean
  displayModeStandalone: boolean
}) {
  ;(globalThis as unknown as { navigator: unknown }).navigator = {
    userAgent: opts.userAgent,
    standalone: opts.standalone,
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    matchMedia: (query: string) => ({
      matches: query === "(display-mode: standalone)" ? opts.displayModeStandalone : false,
    }),
  }
}

describe("pwa detection helpers", () => {
  afterEach(() => {
    delete (globalThis as unknown as { navigator?: unknown }).navigator
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it("SSR (no window): both return false, no crash", () => {
    expect(isIOS()).toBe(false)
    expect(isStandalone()).toBe(false)
  })

  it("iPhone Safari, not installed: nudge-eligible (isIOS true, isStandalone false)", () => {
    stubGlobals({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15",
      standalone: false,
      displayModeStandalone: false,
    })
    expect(isIOS()).toBe(true)
    expect(isStandalone()).toBe(false)
  })

  it("iPhone Safari, installed via navigator.standalone: isStandalone true", () => {
    stubGlobals({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15",
      standalone: true,
      displayModeStandalone: false,
    })
    expect(isIOS()).toBe(true)
    expect(isStandalone()).toBe(true)
  })

  it("Android Chrome, installed: not iOS, standalone true (not nudge-eligible)", () => {
    stubGlobals({
      userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120",
      standalone: undefined,
      displayModeStandalone: true,
    })
    expect(isIOS()).toBe(false)
    expect(isStandalone()).toBe(true)
  })
})
