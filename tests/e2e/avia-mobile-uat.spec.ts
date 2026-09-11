// Avia Masters mobile UAT — 16-05-PLAN.md Task 1, the Phase 16 gate and the final gate of
// milestone v1.1. Mirrors tests/e2e/chicken-mobile-uat.spec.ts's harness verbatim: emulated
// 360x640 portrait, real sign-up/sign-in/setBalance against the live dev server and real
// Postgres, screenshots as evidence in .planning/phases/16-aviamasters/uat-screenshots/. Every
// prior mobile UAT suite (Plinko/Mines/Dice/Wheel/Chicken) caught a real bug — this one is a
// gate, not a formality, and the only place the animated flight, the disclosure copy and a real
// settled round are exercised together. Motion is UNCONDITIONAL here: Gate H asserts the board
// still flies under prefers-reduced-motion (see its own comment for why that inverted).
//
// This suite never asserts a realised payout rate anywhere — floor and the cap legitimately
// move it (93.7% at 5 ZP versus about 96.8% at 100 ZP per 16-CONTEXT.md), and the nominal 97%
// proof lives in tests/unit/avia-model.test.ts.
//
// Aviamasters is single-shot and has NO cash-out and NO in-round decision of any kind — unlike
// every prior multi-step game (Mines/Chicken), a round never sits ACTIVE across a page load, so
// this file needs no resume gate and no cross-test cleanup (finishRound-style helper).

import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test"
import path from "node:path"

test.use({ viewport: { width: 360, height: 640 } })
test.describe.configure({ mode: "serial" })

// Date.now() alone collides under --repeat-each with parallel workers (two repetitions'
// module instances can start within the same millisecond, then both try to sign up the
// identical email) — the random suffix is what actually makes each repetition's user unique.
const TS = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
const USER = {
  name: "Avia UAT",
  email: `aviauat${TS}@example.com`,
  password: "AviaUAT123!",
}

const SHOT_DIR = path.join(process.cwd(), ".planning/phases/16-aviamasters/uat-screenshots")

// The model's designed spawn parameters (16-RESEARCH.md / aviamasters.ts) — restated here only
// as plain numbers for test-timeout/loop-bound arithmetic, never re-derived or re-verified (that
// proof lives in tests/unit/avia-model.test.ts).
const AVIA_STEPS = 16
const CRUISE_MS = 260 // AVIA_SPEED_MS.CRUISE — restated for Gate H's flight-duration arithmetic.
const WATER_CRASH_RATE = 0.44 // approximate — 40 attempts is overwhelmingly safe per 16-05-PLAN.md

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

async function openAvia(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /casino/i }).click()
  const card = page.getByRole("button", { name: /Avia Masters — fly and land, no cash-out/i })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.locator('[data-testid="avia-sky"]')).toBeVisible({ timeout: 5_000 })
  // The dialog's own enter transition (fade-in-0 + zoom-in-95, duration-200) is still running
  // the instant the sky becomes visible in the DOM — chicken-mobile-uat.spec.ts's own precedent.
  await page.waitForTimeout(300)
}

async function setBet(page: Page, amount: number) {
  const input = page.getByLabel("Bet amount in ZP")
  await input.click()
  await input.fill(String(amount))
  await input.blur()
}

async function setSpeed(page: Page, name: "Turtle" | "Cruise" | "Hare" | "Lightning") {
  await page.getByRole("radio", { name, exact: true }).click()
}

// The single primary action — its label swaps "Bet N ZP" -> "Settling…" -> back to "Bet N ZP",
// but the underlying element (h-14 w-full, the only button in the controls slot) never changes,
// so this is the stable way to read its position regardless of round phase.
function primaryButton(page: Page): Locator {
  return page.locator("button.h-14.w-full")
}

function outcomeSlot(page: Page): Locator {
  return page.locator("div.h-16")
}

function counterReadout(page: Page): Locator {
  return page.locator(".font-mono.text-2xl.font-semibold.tabular-nums").first()
}

async function readBalance(page: Page): Promise<number> {
  const text = (await page.getByText(/^Balance /).textContent()) ?? ""
  const m = text.match(/Balance ([\d,]+) ZP/)
  if (!m) throw new Error(`could not parse balance: ${text}`)
  return Number.parseInt(m[1].replace(/,/g, ""), 10)
}

async function readOutcomeNet(page: Page): Promise<number> {
  const text = (await outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/).textContent()) ?? ""
  const m = text.match(/^([+−])([\d,]+) ZP$/)
  if (!m) throw new Error(`could not parse outcome net: ${text}`)
  const magnitude = Number.parseInt(m[2].replace(/,/g, ""), 10)
  return m[1] === "−" ? -magnitude : magnitude
}

async function waitForSettle(page: Page, timeoutMs = 20_000) {
  // The Bet button disables the instant a round starts and re-enables the instant it settles —
  // a far more reliable "THIS round is done" signal than the outcome slot's own text: CasinoShell
  // keeps that slot permanently mounted, so a repeat-bet loop's round #2 mid-flight state still
  // shows round #1's stale net line until round #2 itself actually settles.
  await expect(primaryButton(page)).toBeEnabled({ timeout: timeoutMs })
  await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 5_000 })
}

/** The board's own aria-label carries the settled state in plain English — the ground truth for
 *  landed vs water, read directly rather than inferred from a screenshot. */
async function isLanded(page: Page): Promise<boolean> {
  const label = await page.locator('[data-testid="avia-sky"]').getAttribute("aria-label")
  if (!label) throw new Error("avia-sky aria-label missing — was the round actually settled?")
  if (/Landed on the carrier/.test(label)) return true
  if (/Went down in the water/.test(label)) return false
  throw new Error(`round not yet settled: ${label}`)
}

async function assertNoHScroll(page: Page) {
  const [scrollW, clientW] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scrollW).toBeLessThanOrEqual(360)
  expect(scrollW).toBe(clientW)
}

/** Same z-index-occlusion caveat chicken-mobile-uat.spec.ts documents for CasinoShell's sticky
 *  control bar: scroll the dialog to its max before screenshotting the outcome slot. */
async function scrollDialogToBottom(page: Page) {
  await page.getByRole("dialog").evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
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
// Gate A: thumb zone — Aviamasters has no in-round controls at all, so the "no precision
// tapping mid-round" criterion is satisfied by construction. This gate asserts the surrounding
// chrome instead: the bet button, the speed segmented control and the autoplay select.
// ---------------------------------------------------------------------------

test.describe("Gate A: thumb zone — no in-round controls at all", () => {
  test("Bet button, speed radios and autoplay select are >=44px on the smaller axis; sticky bar never moves", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)
    await setBet(page, 25)

    const bet = primaryButton(page)
    const radios = page.getByRole("radio")
    const autoplaySelect = page.getByLabel("Autoplay rounds")

    await expect(bet).toBeVisible()
    const betBox = await bet.boundingBox()
    expect(betBox).not.toBeNull()
    expect(Math.min(betBox!.width, betBox!.height)).toBeGreaterThanOrEqual(44)

    await expect(radios).toHaveCount(4) // Turtle / Cruise / Hare / Lightning
    for (let i = 0; i < 4; i++) {
      const box = await radios.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44)
    }

    const selectBox = await autoplaySelect.boundingBox()
    expect(selectBox).not.toBeNull()
    expect(Math.min(selectBox!.width, selectBox!.height)).toBeGreaterThanOrEqual(44)

    // Non-overlap: the three rows (speed / autoplay-or-stop / bet button) stack vertically.
    const autoplayBox = await autoplaySelect.boundingBox()
    expect(autoplayBox!.y + autoplayBox!.height).toBeLessThanOrEqual(betBox!.y)

    const dialog = page.getByRole("dialog")
    await dialog.evaluate((el) => {
      el.scrollTop = 0
    })
    const yPreBet = (await bet.boundingBox())!.y
    await page.screenshot({ path: path.join(SHOT_DIR, "gateA-prebet.png") })

    await bet.click()
    await page.waitForTimeout(100) // mid-flight
    const yMid = (await bet.boundingBox())!.y
    expect(yMid).toBe(yPreBet)

    await waitForSettle(page)
    const ySettled = (await bet.boundingBox())!.y
    expect(ySettled).toBe(yPreBet) // sticky — never moves across pre-bet/mid-flight/settled

    await page.screenshot({ path: path.join(SHOT_DIR, "gateA-settled.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate B: no horizontal scroll, at both the default speed and LIGHTNING.
// ---------------------------------------------------------------------------

test.describe("Gate B: no horizontal scroll", () => {
  for (const speed of ["Cruise", "Lightning"] as const) {
    test(`${speed} — never overflows before the bet, after opening, mid-flight, or after settle`, async ({
      page,
      request,
    }) => {
      test.setTimeout(30_000)
      await setBalance(request, 500)
      await signIn(page)
      await openAvia(page)
      await assertNoHScroll(page)

      await setSpeed(page, speed)
      await setBet(page, 25)
      await assertNoHScroll(page)

      await primaryButton(page).click()
      await assertNoHScroll(page) // mid-flight, camera translated
      await waitForSettle(page)
      await assertNoHScroll(page)
    })
  }
})

// ---------------------------------------------------------------------------
// Gate C: AVIA-02 the Counter Balance — starts at 1.00x, never shows a tweened value, and the
// final displayed value matches the settled multiplier on a landing round.
// ---------------------------------------------------------------------------

test.describe("Gate C: AVIA-02 the Counter Balance", () => {
  test("1.00x pre-bet, only discrete step values shown mid-flight, final display matches the settled multiplier", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)
    await setBet(page, 25)

    const counter = counterReadout(page)
    await expect(counter).toHaveText("1.00×")

    for (let attempt = 0; attempt < 40; attempt++) {
      await primaryButton(page).click()

      // Sample the readout at a much tighter interval than any step's reveal timer — the counter
      // has no CSS transition of its own (only the camera/plane do), so every sample must be one
      // of the discrete step values, never an interpolated tween.
      const seen = new Set<string>()
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        const t = (await counter.textContent().catch(() => null)) ?? ""
        if (t) seen.add(t)
        // The Bet button re-enabling is THIS round's settle signal — the outcome slot's own
        // text is a bad break condition here since CasinoShell keeps it mounted, so a retry
        // (attempt > 0) would still show the PREVIOUS round's stale net line at this point.
        if (await primaryButton(page).isEnabled().catch(() => false)) break
        await page.waitForTimeout(30)
      }
      await waitForSettle(page)

      for (const v of seen) expect(v).toMatch(/^\d+(\.\d+)?×$/)
      // At most one value per step plus the pre-bet start — never more, which would mean a
      // tween or a stray re-render showed something outside the discrete step sequence.
      expect(seen.size).toBeLessThanOrEqual(AVIA_STEPS + 1)

      if (await isLanded(page)) {
        const secondaryText = (await outcomeSlot(page).locator("p.font-mono.text-sm").textContent()) ?? ""
        const m = secondaryText.match(/([\d.]+)×/)
        expect(m).not.toBeNull()
        const finalDisplay = (await counter.textContent()) ?? ""
        expect(finalDisplay).toBe(`${m![1]}×`)
        await page.screenshot({ path: path.join(SHOT_DIR, "gateC-landing.png") })
        return
      }
      // Water crash: the last displayed counter legitimately differs from the settled 0.00x
      // (AVIA-03 — a water landing loses everything regardless of the balance reached). Retry
      // for a landing round to exercise the equality this gate is actually about.
    }
    throw new Error("could not reach a landing round within 40 attempts for Gate C")
  })
})

// ---------------------------------------------------------------------------
// Gate D: AVIA-01 a full round — exactly one network round trip, net matches payout - stake,
// and there is NO cash-out control anywhere.
// ---------------------------------------------------------------------------

test.describe("Gate D: AVIA-01 a full round", () => {
  test("25 ZP bet settles with exactly one aviamasters.play request, net matches payout - stake, no cash out control exists", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)
    await setSpeed(page, "Lightning")
    await setBet(page, 25)

    let playRequests = 0
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("aviamasters.play")) playRequests++
    })

    const balanceBefore = await readBalance(page)
    await primaryButton(page).click()
    await waitForSettle(page)

    expect(playRequests).toBe(1)

    const outcomeNet = await readOutcomeNet(page)
    await expect.poll(() => readBalance(page), { timeout: 5_000 }).toBe(balanceBefore + outcomeNet)

    // AVIA-01: assert there is no cash out control anywhere in the dialog — the defining
    // property of this game is that it has no in-round decision of any kind, ever.
    await expect(page.getByRole("button", { name: /cash ?out/i })).toHaveCount(0)

    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gateD-fullround.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate E: AVIA-03 a water round — a negative net at 0.00x, board shows the water landing.
// ---------------------------------------------------------------------------

test.describe("Gate E: AVIA-03 a water round", () => {
  test("a water landing pays 0.00x, negative net, and the board names the water landing", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)
    await setSpeed(page, "Lightning")
    await setBet(page, 25)

    for (let attempt = 0; attempt < 40; attempt++) {
      await primaryButton(page).click()
      await waitForSettle(page)

      if (!(await isLanded(page))) {
        const secondaryText = (await outcomeSlot(page).locator("p.font-mono.text-sm").textContent()) ?? ""
        expect(secondaryText).toContain("0.00×")

        const outcomeNet = await readOutcomeNet(page)
        expect(outcomeNet).toBeLessThan(0)

        const label = await page.locator('[data-testid="avia-sky"]').getAttribute("aria-label")
        expect(label).toMatch(/Went down in the water/)

        await page.screenshot({ path: path.join(SHOT_DIR, "gateE-water.png") })
        return
      }
    }
    throw new Error(
      `no water landing within 40 rounds — model crash rate is ~${WATER_CRASH_RATE * 100}%, this should not happen`,
    )
  })
})

// ---------------------------------------------------------------------------
// Gate F: AVIA-04 the disclosure — always visible, names 97%, never claims low volatility.
// ---------------------------------------------------------------------------

test.describe("Gate F: AVIA-04 the disclosure", () => {
  test("names 97% and 'do not change the odds', never claims low volatility", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)

    await expect(page.getByText(/do not change the odds/i)).toBeVisible()
    await expect(page.getByText(/97%/)).toBeVisible()
    await expect(page.getByText(/low volatility/i)).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Gate G: AVIA-04 autoplay — strictly serial requests, concurrency never exceeds 1, Stop halts
// further rounds immediately.
// ---------------------------------------------------------------------------

test.describe("Gate G: AVIA-04 autoplay", () => {
  test("autoplay requests never overlap; Stop takes effect at the next boundary", async ({ page, request }) => {
    test.setTimeout(60_000)
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)
    await setSpeed(page, "Lightning")
    await setBet(page, 25)

    let inFlight = 0
    let maxInFlight = 0
    let totalStarted = 0
    const isPlayReq = (url: string) => url.includes("aviamasters.play")
    page.on("request", (req) => {
      if (req.method() === "POST" && isPlayReq(req.url())) {
        inFlight++
        totalStarted++
        maxInFlight = Math.max(maxInFlight, inFlight)
      }
    })
    page.on("requestfinished", (req) => {
      if (req.method() === "POST" && isPlayReq(req.url())) inFlight--
    })
    page.on("requestfailed", (req) => {
      if (req.method() === "POST" && isPlayReq(req.url())) inFlight--
    })

    await page.getByLabel("Autoplay rounds").selectOption("10")
    await expect(page.getByRole("button", { name: /Stop autoplay/ })).toBeVisible({ timeout: 5_000 })

    // Let a couple of rounds fire, then stop mid-run — proves the halt takes effect at the next
    // round boundary rather than waiting for all 10 to complete.
    await page.waitForTimeout(1_500)
    await page.getByRole("button", { name: /Stop autoplay/ }).click()

    // The select reappears once the run drains — this IS "autoplay stopped".
    await expect(page.getByLabel("Autoplay rounds")).toBeVisible({ timeout: 10_000 })

    const countAtStop = totalStarted
    await page.waitForTimeout(2_000)
    expect(totalStarted).toBe(countAtStop) // no further requests fired after Stop

    expect(maxInFlight).toBeLessThanOrEqual(1)
    expect(totalStarted).toBeGreaterThanOrEqual(1)
    expect(totalStarted).toBeLessThan(10) // Stop actually cut the run short
  })
})

// ---------------------------------------------------------------------------
// Gate H: reduced motion — the board still flies. This gate was INVERTED (from "static result
// strip, settles within one tick, zero infinite animations") when the always-animate contract
// landed: iOS Low Power Mode and Android battery saver both report prefers-reduced-motion:
// reduce, so the old fallback made the game look broken on a merely low battery. CasinoShell's
// `.game-motion` exempts the casino subtree from globals.css's reduced-motion freeze, and the
// result strip is gone entirely. What this gate protects now is that the exemption actually
// reaches the DOM — a regression that re-gated the board would show up here as an instant settle
// or as zero looping animations.
// ---------------------------------------------------------------------------

test.describe("Gate H: reduced motion still animates", () => {
  test("the flight plays at full length and the board keeps its looping motion under reduced motion", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    await setBalance(request, 500)
    await signIn(page)
    // test.use({ reducedMotion: "reduce" }) does not reach window.matchMedia in this
    // Playwright/Chromium combination (verified in Phase 14/15) — page.emulateMedia's
    // imperative form is what every prior mobile UAT suite uses for this exact gate.
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openAvia(page)
    await setSpeed(page, "Cruise")
    await setBet(page, 25)

    // Clouds, waves and the propeller loop before a bet is even placed — the board is alive at
    // rest, not only mid-round.
    const countInfinite = () =>
      page
        .getByRole("dialog")
        .evaluate(
          (dialog) =>
            Array.from(dialog.querySelectorAll("*")).filter(
              (el) => getComputedStyle(el).animationIterationCount === "infinite",
            ).length,
        )
    expect(await countInfinite()).toBeGreaterThan(0)

    const t0 = Date.now()
    await primaryButton(page).click()
    // Mid-flight: the plane's own idle bob and propeller are running, which is what the old
    // "zero infinite animations" assertion used to forbid.
    await page.waitForTimeout(400)
    expect(await countInfinite()).toBeGreaterThan(0)
    await page.screenshot({ path: path.join(SHOT_DIR, "gateH-reduced-motion-midflight.png") })

    await waitForSettle(page)
    // The shortest possible round is a step-1 water crash. Anything under one Cruise tick would
    // mean the per-step reveal timer had been skipped — the exact regression this gate exists to
    // catch now, and the only direction that matters here. The upper bound is deliberately loose
    // (AVIA_STEPS ticks plus 5s of slack for the mutation round trip and the dev server): it is a
    // runaway-timer guard, not a performance assertion.
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(CRUISE_MS)
    expect(elapsed).toBeLessThan(CRUISE_MS * AVIA_STEPS + 5_000)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateH-reduced-motion.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate I: the conditional cap disclosure — absent at 25 ZP, present at 100 ZP.
// ---------------------------------------------------------------------------

test.describe("Gate I: the conditional cap disclosure", () => {
  test("absent at 25 ZP, present at 100 ZP naming the x250 max and the 100x cap", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openAvia(page)

    await setBet(page, 25)
    await expect(page.getByText(/cap instead\./)).toHaveCount(0)

    await setBet(page, 100)
    const capLine = page.locator("p").filter({ hasText: "cap instead" })
    await expect(capLine).toBeVisible()
    await expect(capLine).toContainText("100 ZP")
    await expect(capLine).toContainText("×250")
    await expect(capLine).toContainText("100×")
  })
})

// ---------------------------------------------------------------------------
// Gate J: screenshot evidence — dark-mode board legibility mid-flight and at settle.
// ---------------------------------------------------------------------------

test.describe("Gate J: screenshot evidence", () => {
  test("dark mode board legibility mid-flight and at settle", async ({ page, request }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ colorScheme: "dark" })
    await openAvia(page)
    await setSpeed(page, "Cruise")
    await setBet(page, 25)

    await primaryButton(page).click()
    await page.waitForTimeout(500) // mid-flight
    await page.screenshot({ path: path.join(SHOT_DIR, "gateJ-darkmode-midflight.png") })

    await waitForSettle(page)
    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gateJ-darkmode-settle.png") })
  })
})
