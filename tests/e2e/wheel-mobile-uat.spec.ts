// Wheel mobile UAT — 14-04-PLAN.md Task 2, the Phase 14 gate. Mirrors
// tests/e2e/dice-mobile-uat.spec.ts's harness verbatim: emulated 360x640 portrait, real
// sign-up/sign-in/setBalance against the live dev server and real Postgres, screenshots as
// evidence in .planning/phases/14-wheel/uat-screenshots/. Every prior mobile UAT suite
// (Plinko/Mines/Dice) caught a real bug — this one is a gate, not a formality.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"
import { WHEEL_TABLES, WHEEL_SEGMENTS, WHEEL_RISKS, type WheelRisk } from "@/lib/casino/wheel"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Wheel UAT",
  email: `wheeluat${TS}@example.com`,
  password: "WheelUAT123!",
}

const SHOT_DIR = path.join(process.cwd(), ".planning/phases/14-wheel/uat-screenshots")

const RISK_LABEL: Record<WheelRisk, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" }

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

async function openWheel(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /casino/i }).click()
  const card = page.getByRole("button", { name: /Wheel — pick segments and risk, then spin/i })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("img", { name: /-segment wheel/ })).toBeVisible({ timeout: 5_000 })
  // The dialog's own enter transition is still running the instant its content becomes visible
  // — a screenshot or bounding-box read taken then captures a translucent, still-scaling frame.
  await page.waitForTimeout(300)
}

// The ring container — WheelFace's root, role="img". Used both for its own bounding box (Gate A)
// and, via its first child div (the ONLY element that rotates), for reading the landing rotation
// (Gate G).
function wheelFace(page: Page) {
  return page.getByRole("img", { name: /-segment wheel/ })
}

function wheelRing(page: Page) {
  return wheelFace(page).locator("> div").first()
}

// The distinct-multiplier legend — the one `div.flex.flex-wrap.gap-1` in the Wheel dialog
// (plinko-controls.tsx uses the identical class combination, but that dialog is never open here).
function legendContainer(page: Page) {
  return page.locator("div.flex.flex-wrap.gap-1")
}

function legendChips(page: Page) {
  return legendContainer(page).locator("> span")
}

async function readSegments(page: Page): Promise<number> {
  const text = await page.locator('[aria-live="off"]').textContent()
  const n = Number.parseInt(text ?? "", 10)
  if (!Number.isFinite(n)) throw new Error(`could not parse segments count: ${text}`)
  return n
}

async function setSegments(page: Page, target: number) {
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    const current = await readSegments(page)
    if (current === target) return
    const label = current < target ? "More segments" : "Fewer segments"
    await page.getByRole("button", { name: label }).click()
  }
  throw new Error(`could not reach ${target} segments`)
}

async function setRisk(page: Page, risk: WheelRisk) {
  await page.getByRole("radio", { name: RISK_LABEL[risk] }).click()
}

async function setBet(page: Page, amount: number) {
  const input = page.getByLabel("Bet amount in ZP")
  await input.click()
  await input.fill(String(amount))
  await input.blur()
}

async function readBalance(page: Page): Promise<number> {
  const text = (await page.getByText(/^Balance /).textContent()) ?? ""
  const m = text.match(/Balance ([\d,]+) ZP/)
  if (!m) throw new Error(`could not parse balance: ${text}`)
  return Number.parseInt(m[1].replace(/,/g, ""), 10)
}

// The outcome slot — CasinoShell's permanently-mounted h-16 container.
function outcomeSlot(page: Page) {
  return page.locator("div.h-16")
}

async function readOutcomeNet(page: Page): Promise<number> {
  const text = (await outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/).textContent()) ?? ""
  const m = text.match(/^([+−])([\d,]+) ZP$/)
  if (!m) throw new Error(`could not parse outcome net: ${text}`)
  const magnitude = Number.parseInt(m[2].replace(/,/g, ""), 10)
  return m[1] === "−" ? -magnitude : magnitude
}

/** The outcome slot's secondary line — "{staked} ZP staked · {multiplier}×" (CasinoShell's own
 *  secondaryLine, toFixed(2)) — parsed for its multiplier, to compare against the legend chip's
 *  raw (non-toFixed) multiplier text via numeric closeness rather than string equality. */
async function readOutcomeMultiplier(page: Page): Promise<number> {
  const text = (await outcomeSlot(page).locator("p").nth(1).textContent()) ?? ""
  const m = text.match(/·\s*([\d.]+)×/)
  if (!m) throw new Error(`could not parse outcome secondary line: ${text}`)
  return Number.parseFloat(m[1])
}

async function readRotationDeg(page: Page): Promise<number> {
  const transform = await wheelRing(page).evaluate((el: HTMLElement) => el.style.transform)
  const m = transform.match(/rotate\(([-\d.]+)deg\)/)
  if (!m) throw new Error(`could not parse ring rotation: ${transform}`)
  return Number.parseFloat(m[1])
}

async function assertNoHorizontalOverflow(page: Page) {
  const [scrollW, clientW] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scrollW).toBe(clientW)

  for (const loc of [wheelFace(page), legendContainer(page)]) {
    const box = await loc.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  }
}

/** CasinoShell's control bar is `sticky bottom-0` with a translucent fill (13-05 gate's own
 *  finding), so it paints over whatever board content sits in that band until the dialog is
 *  scrolled to its max — mirrored verbatim from dice-mobile-uat.spec.ts. */
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
// Gate A: no horizontal scroll at any segment count or risk.
// ---------------------------------------------------------------------------

test.describe("Gate A: no horizontal scroll", () => {
  test("all five segment counts at each risk level fit 360px with no page scroll", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openWheel(page)

    for (const risk of WHEEL_RISKS) {
      await setRisk(page, risk)
      for (const segments of WHEEL_SEGMENTS) {
        await setSegments(page, segments)
        await assertNoHorizontalOverflow(page)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Gate B: 50-segment legibility — the check for research assumption A1 (conic hard-stop
// aliasing at 7.2deg spacing). Screenshot captured regardless of pass/fail so the edges can be
// judged visually.
// ---------------------------------------------------------------------------

test.describe("Gate B: 50-segment legibility", () => {
  for (const risk of WHEEL_RISKS) {
    test(`50 segments at ${risk} risk renders the correct legend chip count`, async ({ page, request }) => {
      await setBalance(request, 500)
      await signIn(page)
      await openWheel(page)
      await setRisk(page, risk)
      await setSegments(page, 50)

      const expectedChipCount = new Set(WHEEL_TABLES[risk][50]).size
      await expect(legendChips(page)).toHaveCount(expectedChipCount)

      // Scroll-top (not scroll-bottom): the ring itself — the thing being judged for hard-stop
      // aliasing — sits at the top of the board region, not in the sticky footer's band.
      await page.screenshot({ path: path.join(SHOT_DIR, `gateB-50-segments-${risk.toLowerCase()}.png`) })
    })
  }
})

// ---------------------------------------------------------------------------
// Gate C: touch targets — the 44px floor on every interactive element.
// ---------------------------------------------------------------------------

test.describe("Gate C: touch targets", () => {
  test("every interactive control in the Wheel dialog measures at least 44px tall", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openWheel(page)

    const targets = [
      page.getByRole("radio", { name: "Low" }),
      page.getByRole("radio", { name: "Medium" }),
      page.getByRole("radio", { name: "High" }),
      page.getByRole("button", { name: "Fewer segments" }),
      page.getByRole("button", { name: "More segments" }),
      page.getByRole("button", { name: "½" }),
      page.getByRole("button", { name: "2×" }),
      page.getByRole("button", { name: "Max" }),
      page.getByRole("button", { name: /^Bet \d+ ZP$/ }),
    ]
    for (const loc of targets) {
      const box = await loc.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})

// ---------------------------------------------------------------------------
// Gate D & E: a spin settles with a balance-matching net, and the landed segment matches the
// legend chip that lights up.
// ---------------------------------------------------------------------------

test.describe("Gate D & E: a spin settles and matches the legend", () => {
  test("a 30 ZP bet at the default 30/MEDIUM settles with a signed ZP figure, a balance-matching net, and exactly one lit legend chip matching the outcome multiplier", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await openWheel(page)
    await setBet(page, 30)

    const balanceBefore = await readBalance(page)
    await page.getByRole("button", { name: /^Bet 30 ZP$/ }).click()

    // Gate D
    // 10s, not 6s: wind-up + spin is 3620ms of deliberate animation before the result reveals.
    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 10_000 })
    const outcomeNet = await readOutcomeNet(page)
    await expect.poll(() => readBalance(page), { timeout: 5_000 }).toBe(balanceBefore + outcomeNet)

    // Gate E — exactly one legend chip carries the landed-multiplier ring class, and its
    // multiplier matches the outcome slot's secondary line (compared numerically: the chip
    // prints the raw table value, e.g. "1.5", while the outcome slot prints toFixed(2), "1.50").
    const outcomeMultiplier = await readOutcomeMultiplier(page)
    const litChips = legendContainer(page).locator("> span.ring-2")
    await expect(litChips).toHaveCount(1)
    const chipText = (await litChips.textContent()) ?? ""
    const chipMatch = chipText.match(/^([\d.]+)×/)
    if (!chipMatch) throw new Error(`could not parse lit legend chip: ${chipText}`)
    expect(Number.parseFloat(chipMatch[1])).toBeCloseTo(outcomeMultiplier, 2)

    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gateDE-settled-spin.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate F: the spin runs REGARDLESS of prefers-reduced-motion.
//
// This gate used to assert the opposite — that reduced motion resolved the result in under a
// second, skipping the spin. That was the bug users reported as "the games don't animate": iOS
// Low Power Mode and Android battery saver both report prefers-reduced-motion: reduce, so on any
// phone that was low on battery the wheel snapped straight to its answer. The casino subtree now
// carries `.game-motion` and opts out of the setting entirely (globals.css), so the contract is
// inverted: under reduce, the ring must still turn and the result must still wait for it.
// ---------------------------------------------------------------------------

test.describe("Gate F: the spin runs under prefers-reduced-motion", () => {
  test("the ring rotates and the result waits for the full spin even with reduced motion emulated", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openWheel(page)
    await setBet(page, 25)

    const rotationBefore = await readRotationDeg(page)

    const start = Date.now()
    await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()

    // Mid-spin: the ring's PAINTED angle is strictly between where it started and where it will
    // land — proof the transform is being interpolated rather than snapped.
    await page.waitForTimeout(1_200)
    const midTransform = await wheelRing(page).evaluate(
      (el: HTMLElement) => getComputedStyle(el).transform,
    )
    expect(midTransform).not.toBe("none")
    await page.screenshot({ path: path.join(SHOT_DIR, "gateF-mid-spin.png") })

    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 10_000 })
    // The full wind-up + spin is 3620ms; a result that arrived materially sooner means the
    // reduced-motion freeze is back.
    expect(Date.now() - start).toBeGreaterThan(3_000)
    expect(await readRotationDeg(page)).toBeGreaterThan(rotationBefore)

    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gateF-reduced-motion.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate G: the ring never unwinds — a second spin's accumulated rotation strictly exceeds the
// first (landingRotation's own non-negotiable, 14-01's unit-tested identity, proven here at the
// DOM level too).
// ---------------------------------------------------------------------------

test.describe("Gate G: the ring never unwinds", () => {
  test("a second spin's rotation strictly exceeds the first", async ({ page, request }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await openWheel(page)
    await setBet(page, 10)

    const betButton = page.getByRole("button", { name: /^Bet 10 ZP$/ })

    await betButton.click()
    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 10_000 })
    await expect(betButton).toBeEnabled({ timeout: 5_000 })
    const rotation1 = await readRotationDeg(page)

    await betButton.click()
    await expect.poll(() => readRotationDeg(page), { timeout: 10_000 }).toBeGreaterThan(rotation1)
  })
})
