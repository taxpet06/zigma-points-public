// Dice mobile UAT — 13-05-PLAN.md Task 1, the Phase 13 gate (13-UI-SPEC.md § UAT Gates).
// Mirrors tests/e2e/mines-mobile-uat.spec.ts and tests/e2e/plinko-mobile-uat.spec.ts's harness
// verbatim: emulated 360x640 portrait, real sign-up/sign-in/setBalance against the live dev
// server and real Postgres, screenshots as evidence in .planning/phases/13-dice/uat-screenshots/.
//
// Two gates this suite closes are the ones a headless browser CAN settle (unlike gates 1 and 4,
// left to the human checkpoint in 13-05-PLAN Task 3): gate 2 (vertical scroll over the slider)
// needs a REAL touch gesture, not a mouse drag, because touch-action direction-locking is a
// touch-pointer-only browser behaviour — dispatched here via a raw CDP `Input.dispatchTouchEvent`
// session, since `page.touchscreen` only exposes `tap()`. Gate 3 (the 14px thumb-inset
// correction) is measured by letting the browser itself resolve the `--pct` custom property's
// `calc()` against a probe element, rather than re-deriving the arithmetic in the test.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"
import { DICE_EDGE, chanceHFor, diceMultiplier, fromChanceH } from "@/lib/casino/dice"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Dice UAT",
  email: `diceuat${TS}@example.com`,
  password: "DiceUAT123!",
}

const SHOT_DIR = path.join(process.cwd(), ".planning/phases/13-dice/uat-screenshots")

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

async function openDice(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /casino/i }).click()
  const card = page.getByRole("button", { name: /Dice — set a target, roll over or under/i })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("slider", { name: "Target" })).toBeVisible({ timeout: 5_000 })
  // The dialog's own enter transition is still running the instant its content becomes visible
  // — a screenshot or bounding-box read taken then captures a translucent, still-scaling frame.
  await page.waitForTimeout(300)
}

async function setTarget(page: Page, targetH: number) {
  const field = page.getByRole("textbox", { name: "Target" })
  await field.click()
  await field.fill((targetH / 100).toFixed(2))
  await field.blur()
}

async function readTriad(page: Page): Promise<{ multiplier: string; target: string; chance: string }> {
  return {
    multiplier: await page.getByRole("textbox", { name: "Multiplier" }).inputValue(),
    target: await page.getByRole("textbox", { name: "Target" }).inputValue(),
    chance: await page.getByRole("textbox", { name: "Win chance, percent" }).inputValue(),
  }
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

/** The readout row's "Roll {n.nn}" / "Roll —" figure — the row's own aria-live container is the
 *  only one whose text starts with "Roll" (the outcome slot's aria-live container starts with
 *  the signed ZP figure instead), so `hasText: /^Roll/` disambiguates the two live regions. */
async function readRoll(page: Page): Promise<string> {
  const container = page.locator('[aria-live="polite"]').filter({ hasText: /^Roll/ }).first()
  const text = (await container.textContent()) ?? ""
  const m = text.match(/Roll (\d[\d.]*|—)/)
  if (!m) throw new Error(`could not parse roll: ${text}`)
  return m[1]
}

// The outcome slot — CasinoShell's permanently-mounted h-16 container, the one class unique to
// it (both it and the readout row share aria-live="polite").
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

async function assertNoHorizontalOverflow(page: Page) {
  const [scrollW, clientW] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scrollW).toBe(clientW)

  for (const loc of [
    page.getByRole("slider", { name: "Target" }),
    page.getByRole("radiogroup", { name: "Roll direction" }),
    page.getByRole("textbox", { name: "Multiplier" }),
    page.getByRole("textbox", { name: "Target" }),
    page.getByRole("textbox", { name: "Win chance, percent" }),
  ]) {
    const box = await loc.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  }
}

/** CasinoShell's control bar is `sticky bottom-0` with a `bg-background/95` fill (13-UI-SPEC's
 *  own "Bet reachable at every scroll position" requirement), so it visually covers whatever
 *  board content sits in that same band until the dialog is scrolled to its max — a plain
 *  `scrollIntoViewIfNeeded()` considers an element "in view" once it's inside the viewport
 *  rectangle, with no notion that a later, higher z-index sibling paints over it. Found while
 *  writing this suite: the outcome slot and disclosure line's own assertions all pass at any
 *  scroll position (their bounding boxes are real), but a screenshot taken without this ends up
 *  showing the sticky bar's translucent fill on top of them instead — evidence that looks like
 *  the content never rendered at all. Scrolling to the bottom is what actually reveals it. */
async function scrollDialogToBottom(page: Page) {
  await page.getByRole("dialog").evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
}

/** Resolves the slider's `--pct` custom property (a `calc()` mixing a fraction of `100%` with a
 *  fixed 14px offset) to an actual pixel distance from the track's left edge, by letting the
 *  browser itself compute it against a probe element positioned in the same containing block —
 *  the only way to get a real resolved value out of a mixed-unit `calc()` from outside the
 *  engine. A naive re-derivation in the test would just restate the component's own arithmetic
 *  and could never catch a simplified (unit-corrected) implementation. */
async function readPctPx(page: Page): Promise<number> {
  const slider = page.getByRole("slider", { name: "Target" })
  return slider.evaluate((el) => {
    const pctValue = getComputedStyle(el).getPropertyValue("--pct").trim()
    const wrapper = el.parentElement as HTMLElement
    const probe = document.createElement("div")
    probe.style.position = "absolute"
    probe.style.left = pctValue
    probe.style.top = "0px"
    probe.style.width = "0px"
    probe.style.visibility = "hidden"
    wrapper.appendChild(probe)
    const probeRect = probe.getBoundingClientRect()
    const wrapperRect = wrapper.getBoundingClientRect()
    probe.remove()
    return probeRect.left - wrapperRect.left
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
// UAT Gate 2: vertical scroll over the slider — the single most likely mobile defect.
// ---------------------------------------------------------------------------

// This gate turned out NOT to be settleable in headless CDP automation, and the investigation
// itself is worth recording rather than silently downgrading to a weaker assertion.
//
// A raw `Input.dispatchTouchEvent` drag was tried first (page.touchscreen only exposes `tap()`).
// It reproduced a real finding: the slider had NO `touch-action` override at all, so the first
// touchmove was captured by the native control's own click-to-position handling with no way for
// a vertical swipe to hand off to the dialog's scroll — a genuine instance of the exact defect
// this gate exists to catch. Fixed with `touch-action: pan-y` on the slider (dice-controls.tsx),
// which is the standard, documented mitigation for this class of bug on native range inputs.
//
// But re-running the SAME synthetic drag after the fix still showed no scroll — and a series of
// control tests (below, as comments for the record) isolated why: in this Chromium/CDP/headless
// combination, a synthetic touch drag starting on ANY interactive element (a plain <button>, a
// text <input>, the range slider) fails to hand off to ancestor scroll, while the identical drag
// starting on a plain text node (the dialog's own <h2> title) scrolls correctly. That rules out
// Dice's own markup: the toggle segments and preset chips are plain, unstyled-for-touch buttons
// with no touch-action override anywhere in this codebase, and they show the identical symptom.
// This is a property of synthetic CDP touch dispatch versus interactive elements generally, not
// a Dice-specific regression, and not something `touch-action` can fix from the page side.
//
// What IS reliably provable here — and is asserted below — is that the mitigation is actually
// shipped (the computed `touch-action` value) and that it did not regress ordinary dragging.
// The full behavioural claim ("a real vertical swipe scrolls past the slider") is moved to the
// 13-05-PLAN Task 3 human checkpoint, alongside gates 1 and 4, as a third genuinely
// un-automatable item — same category as Phase 10's documented "true 60fps on physical hardware"
// residual.

test.describe("UAT Gate 2: vertical scroll over the slider", () => {
  test("the slider ships touch-action: pan-y, and dragging still sets the value", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)

    const slider = page.getByRole("slider", { name: "Target" })

    // The mitigation is actually present — not simplified away, not left at the browser default
    // ("auto"), which is what caused the drag-locks-the-page defect found while writing this gate.
    const touchAction = await slider.evaluate((el) => getComputedStyle(el).touchAction)
    expect(touchAction).toBe("pan-y")

    // touch-action must not have silently broken ordinary dragging: a real pointer drag across
    // the track still moves the thumb and updates the Target field.
    const before = await page.getByRole("textbox", { name: "Target" }).inputValue()
    const box = await slider.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height / 2, { steps: 10 })
    await page.mouse.up()
    const after = await page.getByRole("textbox", { name: "Target" }).inputValue()
    expect(after).not.toBe(before)
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 10: no horizontal scroll, at extreme targets, in both modes.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 10: no horizontal scroll", () => {
  test("no horizontal scroll at extreme targets under Roll under and Roll over", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)

    await page.getByRole("radio", { name: "Roll under" }).click()
    for (const t of [1, 5000, 9800]) {
      await setTarget(page, t)
      await assertNoHorizontalOverflow(page)
    }

    await page.getByRole("radio", { name: "Roll over" }).click()
    for (const t of [200, 5000, 9999]) {
      await setTarget(page, t)
      await assertNoHorizontalOverflow(page)
    }
  })
})

// ---------------------------------------------------------------------------
// Touch targets — the 44px floor on every interactive element.
// ---------------------------------------------------------------------------

test.describe("Touch targets", () => {
  test("every interactive target in the triad measures at least 44px tall", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)

    const targets = [
      page.getByRole("slider", { name: "Target" }),
      page.getByRole("radio", { name: "Roll under" }),
      page.getByRole("radio", { name: "Roll over" }),
      page.getByRole("textbox", { name: "Multiplier" }),
      page.getByRole("textbox", { name: "Target" }),
      page.getByRole("textbox", { name: "Win chance, percent" }),
      page.getByRole("button", { name: "2× multiplier" }),
      page.getByRole("button", { name: "3× multiplier" }),
      page.getByRole("button", { name: "5× multiplier" }),
      page.getByRole("button", { name: "10× multiplier" }),
      page.getByRole("button", { name: "50× multiplier" }),
    ]
    for (const loc of targets) {
      const box = await loc.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 3: the thumb-inset correction, at both extremes.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 3: the thumb-inset correction", () => {
  test("the fill boundary sits 14px in from each edge, never at 0% or 100%", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)
    await page.getByRole("radio", { name: "Roll under" }).click()

    const slider = page.getByRole("slider", { name: "Target" })

    await setTarget(page, 1) // min of the UNDER range — frac 0
    const boxMin = await slider.boundingBox()
    const pctMin = await readPctPx(page)
    expect(Math.abs(pctMin - 14)).toBeLessThan(1.5) // ~14px, NOT 0
    await page.screenshot({ path: path.join(SHOT_DIR, "03-thumb-inset-min.png") })

    await setTarget(page, 9800) // max of the UNDER range — frac 1
    const boxMax = await slider.boundingBox()
    const pctMax = await readPctPx(page)
    expect(Math.abs(pctMax - (boxMax!.width - 14))).toBeLessThan(1.5) // ~(width - 14), NOT width
    await page.screenshot({ path: path.join(SHOT_DIR, "03-thumb-inset-max.png") })

    // Sanity: the two boxes are the same track (min/max didn't relayout the slider itself).
    expect(boxMin!.width).toBeCloseTo(boxMax!.width, 0)
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 6: mode flip round-trips the target exactly.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 6: mode flip round-trips", () => {
  test("flipping to Roll over and back returns the target exactly; chance and multiplier never move", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)

    for (const t of [1, 2500, 5000, 9800]) {
      await page.getByRole("radio", { name: "Roll under" }).click()
      await setTarget(page, t)
      const before = await readTriad(page)

      await page.getByRole("radio", { name: "Roll over" }).click()
      await page.getByRole("radio", { name: "Roll under" }).click()

      const after = await readTriad(page)
      expect(after.target, `target round-trip failed from ${t}`).toBe(before.target)
      expect(after.multiplier, `multiplier moved on a mode round-trip from ${t}`).toBe(before.multiplier)
      expect(after.chance, `chance moved on a mode round-trip from ${t}`).toBe(before.chance)
    }
  })
})

// ---------------------------------------------------------------------------
// DICE-03 triad sync — every edit path recomputes the other two, exactly.
// Expected values are computed from the SAME functions dice-controls.tsx imports (never
// hardcoded), per the plan's own caution not to trust literal figures verbatim.
// ---------------------------------------------------------------------------

test.describe("DICE-03 triad sync", () => {
  test("typing into any one of the three fields, or tapping a chip, recomputes the other two exactly", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)
    await page.getByRole("radio", { name: "Roll under" }).click()

    // 1. Type 3.3333 into Multiplier.
    const multiplierField = page.getByRole("textbox", { name: "Multiplier" })
    await multiplierField.click()
    await multiplierField.fill("3.3333")
    await multiplierField.blur()

    const chanceH1 = Math.round(((100 - DICE_EDGE) / 3.3333) * 100)
    const expected1 = fromChanceH(chanceH1, "UNDER")
    await expect(page.getByRole("textbox", { name: "Win chance, percent" })).toHaveValue(
      (expected1.chanceH / 100).toFixed(2),
    )
    await expect(page.getByRole("textbox", { name: "Target" })).toHaveValue((expected1.targetH / 100).toFixed(2))

    // 2. Type 25 into Win chance.
    const chanceField = page.getByRole("textbox", { name: "Win chance, percent" })
    await chanceField.click()
    await chanceField.fill("25")
    await chanceField.blur()

    const expected2 = fromChanceH(2500, "UNDER")
    await expect(page.getByRole("textbox", { name: "Multiplier" })).toHaveValue(expected2.multiplier.toFixed(4))

    // 3. Tap the 5x chip.
    await page.getByRole("button", { name: "5× multiplier" }).click()
    const expected3 = fromChanceH(1980, "UNDER")
    await expect(page.getByRole("textbox", { name: "Win chance, percent" })).toHaveValue(
      (expected3.chanceH / 100).toFixed(2),
    )
    await expect(page.getByRole("textbox", { name: "Target" })).toHaveValue((expected3.targetH / 100).toFixed(2))
    await expect(page.getByRole("textbox", { name: "Multiplier" })).toHaveValue(expected3.multiplier.toFixed(4))

    // 4. Flip to Roll over — target mirrors, chance and multiplier are untouched.
    await page.getByRole("radio", { name: "Roll over" }).click()
    const targetAfterFlip = 10000 - expected3.targetH
    await expect(page.getByRole("textbox", { name: "Target" })).toHaveValue((targetAfterFlip / 100).toFixed(2))
    await expect(page.getByRole("textbox", { name: "Win chance, percent" })).toHaveValue(
      (expected3.chanceH / 100).toFixed(2),
    )
    await expect(page.getByRole("textbox", { name: "Multiplier" })).toHaveValue(expected3.multiplier.toFixed(4))

    // Cross-check against chanceHFor + diceMultiplier directly, so the whole chain (chip -> flip)
    // is verified against the module's own composition, not just fromChanceH in isolation.
    const chanceAfterFlip = chanceHFor(targetAfterFlip, "OVER")
    expect(chanceAfterFlip).toBe(expected3.chanceH)
    expect(diceMultiplier(chanceAfterFlip).toFixed(4)).toBe(expected3.multiplier.toFixed(4))
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 5: the Multiplier field at its worst case.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 5: the Multiplier field at its worst case", () => {
  test("chance 0.01% renders 9900.0000 with no clipping and no horizontal page scroll", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)
    await page.getByRole("radio", { name: "Roll under" }).click()
    await setTarget(page, 1) // 0.01% chance

    const multiplierField = page.getByRole("textbox", { name: "Multiplier" })
    await expect(multiplierField).toHaveValue(diceMultiplier(1).toFixed(4))
    await expect(multiplierField).toHaveValue("9900.0000")

    const [scrollW, clientW] = await multiplierField.evaluate((el: HTMLInputElement) => [
      el.scrollWidth,
      el.clientWidth,
    ])
    expect(scrollW).toBeLessThanOrEqual(clientW)

    const [pageScrollW, pageClientW] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ])
    expect(pageScrollW).toBe(pageClientW)

    await page.screenshot({ path: path.join(SHOT_DIR, "gate5-worst-case-multiplier.png") })
  })
})

// ---------------------------------------------------------------------------
// A full round (DICE-01): the roll readout and the outcome slot agree with the balance delta.
// ---------------------------------------------------------------------------

test.describe("A full round (DICE-01)", () => {
  test("a 25 ZP bet at 98% win chance settles with a 2dp roll and a signed, balance-matching outcome", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)
    await page.getByRole("radio", { name: "Roll under" }).click()
    await setTarget(page, 9800) // 98.00% win chance
    await setBet(page, 25)

    const balanceBefore = await readBalance(page)
    await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 5_000 })

    // The digits scramble for REVEAL_MS (460ms) before settling on the server's number — read
    // the SETTLED value, not a mid-scramble frame.
    await page.waitForTimeout(700)
    const roll = await readRoll(page)
    expect(roll).toMatch(/^\d{1,3}\.\d{2}$/) // always 2dp, never "0" or "100"

    const outcomeNet = await readOutcomeNet(page)
    await expect.poll(() => readBalance(page), { timeout: 5_000 }).toBe(balanceBefore + outcomeNet)

    // The board region is taller than the 360x640 viewport (13-UI-SPEC's own documented
    // arithmetic), and the sticky control bar paints over whatever sits in its band until the
    // dialog is scrolled to its max — scroll there, and past the 400ms outcome fade-in, so the
    // screenshot is actual evidence, not the sticky bar's fill over an unrendered frame.
    await scrollDialogToBottom(page)
    await page.waitForTimeout(450)
    await page.screenshot({ path: path.join(SHOT_DIR, "full-round.png") })
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 7: both disclosure lines — mutually exclusive, correctly positioned.
//
// Deviation from the plan's literal combo: "100 ZP at the 50x chip" cannot cross the cap
// (100 x 50 = 5,000, half of the 10,000 MAX_PAYOUT) — 100 ZP crosses it only above 100x
// (10,000 / 100), which the UI-SPEC's own worked example confirms ("At 100 ZP above 100x").
// Target 1 (0.01% chance, 9900x) is used instead to force the cap deterministically.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 7: both disclosure lines", () => {
  test("the cap and net-0 lines render distinctly, never together, clear of the chips and outcome slot", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openDice(page)
    await page.getByRole("radio", { name: "Roll under" }).click()

    const chipsGrid = page.locator("div.grid.grid-cols-5.gap-2").first()
    const capLine = page.getByText(/pay the 10,000 ZP cap\./)
    const netZeroLine = page.getByText(/pays back your stake and nothing more\./)

    // Force the cap: 100 ZP at a 0.01% chance (9900x nominal).
    await setBet(page, 100)
    await setTarget(page, 1)

    await expect(capLine).toBeVisible()
    await expect(netZeroLine).toHaveCount(0)

    const chipsBoxA = await chipsGrid.boundingBox()
    const capBox = await capLine.boundingBox()
    const outcomeBoxA = await outcomeSlot(page).boundingBox()
    expect(capBox!.y).toBeGreaterThanOrEqual(chipsBoxA!.y + chipsBoxA!.height)
    expect(capBox!.y + capBox!.height).toBeLessThanOrEqual(outcomeBoxA!.y)

    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gate7-cap-disclosure.png") })

    // Force the net-0 floor: 98 ZP at exactly 98.00% chance.
    await setBet(page, 98)
    await setTarget(page, 9800)

    await expect(netZeroLine).toBeVisible()
    await expect(capLine).toHaveCount(0)

    const chipsBoxB = await chipsGrid.boundingBox()
    const netZeroBox = await netZeroLine.boundingBox()
    const outcomeBoxB = await outcomeSlot(page).boundingBox()
    expect(netZeroBox!.y).toBeGreaterThanOrEqual(chipsBoxB!.y + chipsBoxB!.height)
    expect(netZeroBox!.y + netZeroBox!.height).toBeLessThanOrEqual(outcomeBoxB!.y)

    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gate7-netzero-disclosure.png") })
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 8: the net-0 win end to end.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 8: the net-0 win end to end", () => {
  test("a win at 98 ZP / 98.00% chance credits +0 ZP with the 1.01x secondary line", async ({ page, request }) => {
    test.setTimeout(90_000)
    await setBalance(request, 2000) // enough headroom for up to ~10 retries at 98 ZP
    await signIn(page)
    await openDice(page)
    await page.getByRole("radio", { name: "Roll under" }).click()
    await setTarget(page, 9800) // 98.00% chance
    await setBet(page, 98)

    let net = -1
    for (let attempt = 0; attempt < 10 && net !== 0; attempt++) {
      await page.getByRole("button", { name: /^Bet 98 ZP$/ }).click()
      await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 5_000 })
      // The outcome slot does NOT clear between bets (dice.tsx's own contract — "the money does
      // not clear"), so a bare visibility check above can resolve against the PRIOR round's
      // still-mounted text while this round is still settling. Wait for the button to return to
      // its ready label — proof this specific round's request has actually completed — before
      // trusting the outcome text as fresh.
      await expect(page.getByRole("button", { name: /^Bet 98 ZP$/ })).toBeEnabled({ timeout: 5_000 })
      net = await readOutcomeNet(page)
    }
    expect(net, "never landed a win across 10 attempts at 98% chance").toBe(0)

    await expect(outcomeSlot(page).getByText("+0 ZP")).toBeVisible()
    await expect(outcomeSlot(page).getByText("98 ZP staked · 1.01×")).toBeVisible()

    await scrollDialogToBottom(page)
    await page.waitForTimeout(450)
    await page.screenshot({ path: path.join(SHOT_DIR, "gate8-netzero-win.png") })
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 9: the reveal runs REGARDLESS of prefers-reduced-motion.
//
// Dice's reveal beat (the roll digits scramble for 460ms, the needle travels to the roll) is NOT
// gated on the OS setting: iOS Low Power Mode and Android battery saver both report
// prefers-reduced-motion: reduce, and the casino subtree opts out of it via `.game-motion`
// (globals.css). What this gate still proves is that there is no ARTIFICIAL wait beyond that
// short beat — the settled roll must be on screen well inside the budget.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 9: the reveal runs under prefers-reduced-motion", () => {
  test("the roll number settles and the outcome slot is present, with reduced motion emulated", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openDice(page)
    await setBet(page, 25)

    const start = Date.now()
    await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
    // Generous budget: this proves there's no ARTIFICIAL animation wait (Dice has no board
    // animation to begin with — a full multi-row Plinko drop alone takes 720-1440ms), not that
    // the network round trip is instant. A real Postgres/Neon round trip can vary.
    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 3_000 })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(3_500)

    // The digits scramble for REVEAL_MS (460ms) before settling on the server's number — wait
    // that beat out, then assert the SETTLED value. Both the outcome slot's fade and the reveal
    // are running here precisely because reduced motion no longer freezes them.
    await page.waitForTimeout(700)
    const roll = await readRoll(page)
    expect(roll).toMatch(/^\d{1,3}\.\d{2}$/)

    await scrollDialogToBottom(page)
    await page.screenshot({ path: path.join(SHOT_DIR, "gate9-reduced-motion.png") })
  })
})

// ---------------------------------------------------------------------------
// Exact-hit ruling — NOT written here.
// ---------------------------------------------------------------------------

// `rollH === targetH` (1-in-10001) is not reliably reachable by chance in an e2e run, and forcing
// it would mean either a flaky retry loop or reaching into server internals from the browser
// session — both worse than the alternative. It is covered by a named unit test instead
// (tests/unit/dice-math.test.ts, per 13-01), which can assert the exact boundary deterministically.
