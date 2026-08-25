// Plinko mobile UAT — 11-08-PLAN.md Task 2, the phase gate's five desk-unprovable checks.
// Emulated 360x640 portrait (Chrome DevTools device emulation), per the plan's explicit
// allowance ("If a 360px-wide device is not available, use Chrome DevTools device emulation
// at exactly 360x640... and note in the record that it was emulated").
//
// Auth pattern: local signUp/signIn/setBalance helpers, same as flappy.spec.ts/tetris.spec.ts.
// Screenshots are written to .planning/phases/11-plinko/uat-screenshots/ as evidence.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"

test.use({ viewport: { width: 360, height: 640 } })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Plinko UAT",
  email: `plinkouat${TS}@example.com`,
  password: "PlinkoUAT123!",
}

const SHOT_DIR = path.join(process.cwd(), ".planning/phases/11-plinko/uat-screenshots")

async function approveEmail(request: APIRequestContext) {
  const res = await request.post("/api/test/approve-email", { data: { email: USER.email } })
  expect(res.ok()).toBeTruthy()
}

async function signUp(page: Page) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(USER.name)
  await page.getByLabel("Email").fill(USER.email)
  await page.getByLabel("Password").fill(USER.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function signIn(page: Page) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(USER.email)
  await page.getByLabel("Password").fill(USER.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function setBalance(request: APIRequestContext, zigmaPoints: number) {
  const res = await request.post("/api/test/seed-balance", {
    data: { email: USER.email, zigmaPoints },
  })
  expect(res.ok()).toBeTruthy()
}

async function openPlinko(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /casino/i }).click()
  const card = page.getByRole("button", { name: /Plinko — drop a ball/i })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("img", { name: /^Plinko board/ })).toBeVisible({ timeout: 5_000 })
}

async function setRows(page: Page, target: number) {
  const valueLoc = page.locator('span[aria-live="off"]')
  const more = page.getByRole("button", { name: "More rows" })
  const fewer = page.getByRole("button", { name: "Fewer rows" })
  for (let guard = 0; guard < 20; guard++) {
    const current = Number.parseInt((await valueLoc.textContent()) ?? "0", 10)
    if (current === target) return
    if (current < target) await more.click()
    else await fewer.click()
  }
}

async function setRisk(page: Page, risk: "Low" | "Medium" | "High") {
  await page.getByRole("radio", { name: risk }).click()
}

async function setBet(page: Page, amount: number) {
  const input = page.getByLabel("Bet amount in ZP")
  await input.click()
  await input.fill(String(amount))
  await input.blur()
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.describe("Setup", () => {
  test("create test user", async ({ page, request }) => {
    await approveEmail(request)
    await signUp(page)
  })
})

// ---------------------------------------------------------------------------
// UAT item 1 (highest risk): 16 rows at 360x640 portrait, High risk.
// ---------------------------------------------------------------------------

test.describe("UAT-1: 16 rows @ 360x640, High risk", () => {
  test("no horizontal scroll, Bet reachable, chip grid legible, 44px targets, stable board height", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openPlinko(page)

    await setRisk(page, "High")

    // Step rows 8 -> 16 one at a time, recording canvas height at each step.
    await setRows(page, 8)
    const canvas = page.locator('canvas[role="img"]')
    const heights: number[] = []
    for (let r = 8; r <= 16; r++) {
      await setRows(page, r)
      const box = await canvas.boundingBox()
      heights.push(box!.height)
    }
    const heightRange = Math.max(...heights) - Math.min(...heights)
    // Spec: "board height should barely change (~7px total across the range)".
    expect(heightRange).toBeLessThan(12)

    // Now at rows=16, High risk (loop above left it at 16).
    await expect(page.locator('span[aria-live="off"]')).toHaveText("16")

    // No horizontal scroll anywhere in the document.
    const [scrollW, clientW] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ])
    expect(scrollW).toBe(clientW)

    // Bet button stays reachable at the bottom (sticky control bar).
    const betBtn = page.getByRole("button", { name: /^Bet \d+ ZP$/ })
    await expect(betBtn).toBeVisible()
    const betBox = await betBtn.boundingBox()
    expect(betBox).not.toBeNull()
    expect(betBox!.y).toBeGreaterThanOrEqual(0)
    expect(betBox!.y + betBox!.height).toBeLessThanOrEqual(640)
    expect(betBox!.height).toBeGreaterThanOrEqual(44)

    // Payout chip grid: 17 chips at 16 rows, none clipped horizontally.
    // Scoped to the chip container specifically — a bare text regex also matches the
    // cap-disclosure line's standalone "{cap/bet}×" span when the cap fires at this bet.
    const chips = page.locator("div.flex.flex-wrap.gap-1 > span")
    await expect(chips).toHaveCount(17)
    const count = await chips.count()
    for (let i = 0; i < count; i++) {
      const box = await chips.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(360)
    }

    // 44px floor on every rows/risk target.
    for (const name of ["Low", "Medium", "High"]) {
      const box = await page.getByRole("radio", { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    for (const name of ["Fewer rows", "More rows"]) {
      const box = await page.getByRole("button", { name }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await page.screenshot({ path: path.join(SHOT_DIR, "01-16rows-high-360x640.png") })
  })
})

// ---------------------------------------------------------------------------
// UAT item 2: the measureText label gate — screenshot evidence at each row count.
// ---------------------------------------------------------------------------

test.describe("UAT-2: measureText label gate — screenshot evidence per row count", () => {
  test("captures the bucket strip at 8, 10, 11, 12, 16 rows for visual inspection", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openPlinko(page)
    await setRisk(page, "High")

    const canvas = page.locator('canvas[role="img"]')
    for (const r of [8, 10, 11, 12, 16]) {
      await setRows(page, r)
      // Let the static layer redraw settle (redrawStatic runs synchronously in an effect,
      // but give a frame for the RAF-driven renderFrame to flush).
      await page.waitForTimeout(50)
      await canvas.screenshot({ path: path.join(SHOT_DIR, `02-labels-${r}rows.png`) })
    }
  })
})

// ---------------------------------------------------------------------------
// UAT item 3 (blocks the phase on FAIL): ten rapid drops.
// ---------------------------------------------------------------------------

test.describe("UAT-3: ten rapid drops (PLNK-04)", () => {
  test("every ball lands, no error toast, selectors lock, balance converges exactly", async ({
    page,
    request,
  }) => {
    await setBalance(request, 1000)
    await signIn(page)
    await openPlinko(page)
    await setBet(page, 10)

    const betBtn = page.getByRole("button", { name: /^Bet 10 ZP$/ })
    await expect(betBtn).toBeVisible()

    // Tap Bet ten times as fast as possible.
    for (let i = 0; i < 10; i++) {
      await betBtn.click({ force: true })
    }

    // No error toast (sonner) at any point during the 10-drop window.
    const errorToast = page.getByText(/Couldn't settle that round/i)

    // The "Locked while balls are falling." line can clear on a MOMENTARY zero (activeBalls
    // briefly touching 0 between two overlapping animations before the remaining queued
    // requests have even fired) — confirmed empirically: a raw, uncached read of the balance
    // taken right when this text first disappears can still be several drops behind, and
    // keeps changing for a few more seconds. Require the "locked" line to STAY absent across
    // a full settle window, not just disappear once, before treating the queue as drained.
    await expect(page.getByText("Locked while balls are falling.")).toHaveCount(0, { timeout: 30_000 })
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500)
      await expect(page.getByText("Locked while balls are falling.")).toHaveCount(0)
    }

    await expect(errorToast).toHaveCount(0)

    // Bypass the DOM/react-query cache entirely — a no-store fetch straight to the tRPC
    // endpoint — and poll until three consecutive reads agree, which is the actual proof
    // that every one of the ten plays has committed server-side.
    async function rawServerBalance(): Promise<number> {
      const json = await page.evaluate(async () => {
        const res = await fetch(
          '/api/trpc/user.getMe?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%7D',
          { cache: "no-store", credentials: "same-origin" },
        )
        return res.json()
      })
      return json[0].result.data.json.zigmaPoints
    }
    let stableCount = 0
    let serverBalance = await rawServerBalance()
    while (stableCount < 3) {
      await page.waitForTimeout(500)
      const next = await rawServerBalance()
      if (next === serverBalance) {
        stableCount++
      } else {
        stableCount = 0
        serverBalance = next
      }
    }

    // The client's own displayed balance (serverBalance - pendingCredits, empty here) must
    // equal that settled server truth.
    const displayedText = (await page.locator("text=/^Balance /").textContent()) ?? ""
    expect(displayedText).toContain(serverBalance.toLocaleString())

    // Refresh the page and confirm the number does not change.
    await page.reload()
    await page.getByRole("tab", { name: /casino/i }).click()
    const card = page.getByRole("button", { name: /Plinko — drop a ball/i })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()
    await expect(page.getByRole("img", { name: /^Plinko board/ })).toBeVisible({ timeout: 5_000 })
    await expect(page.locator("text=/^Balance /")).toContainText(serverBalance.toLocaleString())
  })
})

// ---------------------------------------------------------------------------
// UAT item 4: dark mode legibility + prefers-reduced-motion resolves instantly.
// ---------------------------------------------------------------------------

test.describe("UAT-4: dark mode + reduced motion", () => {
  test("dark mode bucket fills are captured for legibility review", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ colorScheme: "dark" })
    await openPlinko(page)
    await setRisk(page, "High")
    await setRows(page, 16)
    await page.waitForTimeout(50)
    await page.screenshot({ path: path.join(SHOT_DIR, "04-darkmode-16rows-high.png") })
  })

  // ASSERTION INVERTED (was: "reduced motion resolves the round immediately with no ball
  // drawn"). iOS Low Power Mode and Android battery saver both report
  // `prefers-reduced-motion: reduce`, which is why users reported the casino games "don't
  // animate". The board no longer has a reduced-motion branch at all — the ball always falls,
  // for everyone — so the old "settles in under 600ms" assertion now asserts the exact bug.
  // The check that keeps its value is the inverse: the drop must still be a drop.
  test("reduced motion still animates the full drop — no instant-settle shortcut", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openPlinko(page)
    await setBet(page, 25)

    const betBtn = page.getByRole("button", { name: /^Bet 25 ZP$/ })
    const outcome = page.locator('[aria-live="polite"]').getByText(/ZP$/)
    await betBtn.click()

    // The ball is in flight: the selector block locks and the outcome has not landed yet.
    await expect(page.getByText("Locked while balls are falling.")).toBeVisible({ timeout: 5_000 })
    await expect(outcome).toHaveCount(0)

    // Board mid-drop, with the ball, its trail and a pulsing peg on screen.
    await page.locator('canvas[role="img"]').screenshot({ path: path.join(SHOT_DIR, "04-middrop-reduced-motion.png") })

    // ...and it does land: 12 rows x 90ms = ~1080ms, plus round-trip and CI jitter.
    await expect(outcome).toBeVisible({ timeout: 5_000 })
  })
})

// ---------------------------------------------------------------------------
// UAT item 5: the verifier proof (FAIR-04).
// ---------------------------------------------------------------------------

test.describe("UAT-5: verifier proof", () => {
  test("a settled Plinko round verifies on-device with a matching multiplier", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openPlinko(page)
    await setBet(page, 25)

    // Place one bet so there is a settled round on the current (soon-to-rotate) seed pair.
    const betBtn = page.getByRole("button", { name: /^Bet 25 ZP$/ })
    await betBtn.click()
    await expect(page.locator('[aria-live="polite"]').getByText(/ZP$/)).toBeVisible({ timeout: 5_000 })

    // Close the game dialog, open Provably fair, rotate the seed pair (reveals the server
    // seed the bet above was drawn from), then open bet history and tap that row.
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: /provably fair/i }).click()

    // FairnessPanel is a native <details>/<summary> starting collapsed, and shares the
    // "Provably fair" label with the dialog's own trigger button — target the <summary>
    // tag specifically to expand it before its Rotate button becomes reachable.
    await page.locator("summary", { hasText: "Provably fair" }).click()

    await page.getByRole("button", { name: /rotate seed pair/i }).click()
    // Two-step confirm: a client seed is prefilled, "Rotate & reveal" commits it.
    await page.getByRole("button", { name: /rotate & reveal/i }).click()
    await expect(page.getByText(/Revealed — you can verify/i)).toBeVisible({ timeout: 5_000 })

    // BetHistory's useInfiniteQuery already fetched (on dialog mount, before rotation) and
    // is not invalidated by rotateSeed's own success handler (it only invalidates
    // casino.getSeed) — reload so the history refetches with this seed pair now revealed
    // (revealedAt set server-side by the rotation above), or the tapped row's serverSeed
    // stays the stale pre-rotation null and Verifier reports "cannot verify yet" instead.
    await page.reload()
    await page.getByRole("tab", { name: /casino/i }).click()
    await page.getByRole("button", { name: /provably fair/i }).click()

    await page.getByText("Bet history").click()
    const historyRow = page.getByRole("button", { name: /Plinko/ }).first()
    await expect(historyRow).toBeVisible({ timeout: 5_000 })
    await historyRow.click()

    await page.getByRole("button", { name: /^Verify$/ }).click()
    await expect(page.getByText("Matches")).toBeVisible({ timeout: 5_000 })

    // The derived multiplier line and the recorded multiplier must agree — read both and compare.
    const derivedLine = page.getByText(/^Derived [\d.]+× · bucket \d+ of \d+ · recorded [\d.]+×$/)
    await expect(derivedLine).toBeVisible()
    const text = (await derivedLine.textContent()) ?? ""
    const derivedMatch = text.match(/Derived ([\d.]+)×/)
    const recordedMatch = text.match(/recorded ([\d.]+)×/)
    expect(derivedMatch).not.toBeNull()
    expect(recordedMatch).not.toBeNull()
    expect(derivedMatch![1]).toBe(recordedMatch![1])
  })
})

// ---------------------------------------------------------------------------
// Cap disclosure spot check.
// ---------------------------------------------------------------------------

test.describe("Cap disclosure spot check", () => {
  test("shows at 100 ZP on High/16, absent at 5 ZP on Low/8", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openPlinko(page)

    await setRisk(page, "High")
    await setRows(page, 16)
    await setBet(page, 100)
    await expect(page.getByText("At 100 ZP, buckets above 100× pay the 10,000 ZP cap.")).toBeVisible()

    await setRisk(page, "Low")
    await setRows(page, 8)
    await setBet(page, 5)
    await expect(page.getByText(/pay the 10,000 ZP cap\./)).toHaveCount(0)
  })
})
