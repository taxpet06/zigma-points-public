// Lootbox mobile UAT — 18-05-PLAN.md Task 2, the Phase 18 gate. Mirrors
// tests/e2e/wheel-mobile-uat.spec.ts's harness verbatim (viewport, serial mode,
// signUp/signIn/setBalance against the live dev server + real Postgres).
//
// Gate D (reduced motion) MATCHES every casino mobile-UAT spec (by request):
// the lootbox reveal opts its subtree OUT of prefers-reduced-motion (globals.css
// exempts .lootbox-stage, like the casino's .game-motion) so the reveal still
// runs at full length under reduce — the bug
// they were fixing was games silently freezing on battery-saver phones. The
// lootbox modal has no such contract: UI-SPEC §9 requires reduced motion to
// SKIP the chest-shake/confetti theater and crossfade straight to the result.
// Do not copy the wheel/dice/mines assertion direction here.
//
// Gate E (forced rarity) has no analog anywhere in tests/ (18-PATTERNS.md "No
// Analog Found") — every catalog item is COMMON today, so a real Rare/Legendary
// roll cannot happen. It intercepts the tRPC HTTP response for shop.openBox via
// page.route() and rewrites rarity/isNew before the client parses it — test-only,
// zero production code path touched (T-18-11).

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Lootbox UAT",
  email: `lootboxuat${TS}@example.com`,
  password: "LootboxUAT123!",
}

const SHOT_DIR = path.join(
  process.cwd(),
  ".planning/phases/18-lootbox-reveal-modal-animations/uat-screenshots",
)

const RARITY_LABEL = { RARE: "Rare", LEGENDARY: "Legendary" } as const

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

// Opens the modal in its browsing state against the FIRST LootboxCard on the
// page — the Backgrounds section's 26x-background box (25 ZP), which renders
// before the Rings section in shop-grid.tsx.
async function openLootboxModal(page: Page) {
  await page.goto("/shop")
  await page.getByRole("button", { name: "Open" }).first().click()
  await expect(page.locator('[aria-label="Items in this box"]')).toBeVisible({ timeout: 10_000 })
  // The dialog's own enter transition (fade-in-0 + zoom-in-95, duration-200) is still running
  // the instant the carousel becomes visible — a bounding-box read taken then captures a
  // still-scaling frame (same precedent as wheel/dice/mines' own openX helpers).
  await page.waitForTimeout(300)
}

function stage(page: Page) {
  return page.locator(".lootbox-stage")
}

async function assertNoPageOverflow(page: Page) {
  const [scrollW, clientW] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scrollW).toBe(clientW)
}

async function assertNoHorizontalOverflow(page: Page) {
  await assertNoPageOverflow(page)
  const box = await page.locator('[aria-label="Items in this box"]').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(360)
}

// Records every data-phase value the .lootbox-stage element takes on, WITH a
// performance.now() timestamp, live in the browser via a MutationObserver —
// proof (not inference) of which beats the reveal timeline actually visited,
// and how long the JS setTimeout-driven arming beat itself took. Timestamping
// in-process (not wall-clock across a click) isolates the measurement from
// network/mutation round-trip jitter, which swamps the ~150ms RARE-vs-Common
// anticipation delta if measured end-to-end instead.
async function watchPhases(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector(".lootbox-stage")
    const w = window as unknown as { __phaseLog: { phase: string; t: number }[] }
    w.__phaseLog = []
    if (!el) return
    const obs = new MutationObserver(() => {
      w.__phaseLog.push({ phase: el.getAttribute("data-phase") ?? "", t: performance.now() })
    })
    obs.observe(el, { attributes: true, attributeFilter: ["data-phase"] })
  })
}

async function readPhaseLog(page: Page): Promise<{ phase: string; t: number }[]> {
  return page.evaluate(
    () => (window as unknown as { __phaseLog: { phase: string; t: number }[] }).__phaseLog ?? [],
  )
}

function phaseDurationMs(
  log: { phase: string; t: number }[],
  from: string,
  to: string,
): number | null {
  const fromEntry = log.find((e) => e.phase === from)
  const toEntry = log.find((e) => e.phase === to)
  if (!fromEntry || !toEntry) return null
  return toEntry.t - fromEntry.t
}

// Deep-walks a parsed tRPC batch response and rewrites rarity/isNew on the
// first object that carries both keys (the openBox result, wherever
// superjson's json/meta batching nests it) — test-only, no server change.
function forceRarity(node: unknown, rarity: "COMMON" | "RARE" | "LEGENDARY"): unknown {
  if (Array.isArray(node)) return node.map((n) => forceRarity(n, rarity))
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) next[k] = forceRarity(v, rarity)
    if ("rarity" in next && "isNew" in next) {
      next.rarity = rarity
      next.isNew = true
    }
    return next
  }
  return node
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
// Gate A: browsing carousel + no horizontal overflow (UI-SPEC §11 point 1).
// ---------------------------------------------------------------------------

test.describe("Gate A: browsing carousel + no overflow", () => {
  test("the carousel is visible with the right label, explainer, and nothing overflows 360px", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openLootboxModal(page)

    await expect(page.locator('[aria-label="Items in this box"]')).toBeVisible()
    await expect(stage(page)).toContainText("Duplicates refund half your ZP.")
    await assertNoHorizontalOverflow(page)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateA-browsing.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate B: the Common reveal runs end-to-end to a New result (UI-SPEC §11 point 2/3).
// A fresh signup owns nothing yet, so this — the file's first spend — is
// guaranteed isNew: true.
// ---------------------------------------------------------------------------

// The pure-JS arming→bursting duration for a Common reveal (ANTICIPATION_MS.COMMON
// = 300ms in lootbox-modal.tsx) — captured in-process so Gate E's escalation check
// can compare against it without cross-test network jitter.
let commonArmingMs = 0

test.describe("Gate B: Common reveal end-to-end", () => {
  test("Open runs the reveal to a New result with the won item, aria-live announcement, and Equip", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)
    // The 26X box now contains Rare + Legendary items too, so an unforced roll is
    // non-deterministic. Force COMMON to keep this the Common-reveal baseline
    // (and the commonArmingMs anchor Gate E compares against).
    await page.route("**/api/trpc/shop.openBox**", async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: forceRarity(body, "COMMON") })
    })
    await openLootboxModal(page)
    await watchPhases(page)

    await stage(page)
      .getByRole("button", { name: /^Open for \d+ ZP$/ })
      .click()
    await expect(page.getByText("New!", { exact: true })).toBeVisible({ timeout: 5_000 })
    commonArmingMs = phaseDurationMs(await readPhaseLog(page), "arming", "bursting") ?? 0

    const liveRegion = page.getByRole("dialog").locator('[aria-live="polite"]')
    await expect(liveRegion).toContainText("Common")
    await expect(liveRegion).toContainText("New!")

    await expect(stage(page).getByRole("button", { name: "Equip" })).toBeVisible()
    await assertNoPageOverflow(page)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateB-common-result.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate C: every interactive control (browsing CTA + Close, then Equip/Open
// again/Close in the result state) measures at least 44px tall.
// ---------------------------------------------------------------------------

test.describe("Gate C: touch targets", () => {
  test("every interactive control in the lootbox modal measures at least 44px tall", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)
    await openLootboxModal(page)

    for (const loc of [
      stage(page).getByRole("button", { name: /^Open for \d+ ZP$/ }),
      stage(page).getByRole("button", { name: "Close" }),
    ]) {
      const box = await loc.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await stage(page)
      .getByRole("button", { name: /^Open for \d+ ZP$/ })
      .click()
    await expect(page.locator('.lootbox-stage[data-phase="settled"]')).toBeVisible({ timeout: 5_000 })

    for (const loc of [
      stage(page).getByRole("button", { name: "Equip" }),
      stage(page).getByRole("button", { name: "Open again" }),
      stage(page).getByRole("button", { name: "Close" }),
    ]) {
      const box = await loc.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})

// ---------------------------------------------------------------------------
// Gate D: reduced motion still plays the FULL reveal — MATCHING the casino
// contract (by request, the reveal is the reward moment and animates for
// everyone). Proven two ways: (1) a live MutationObserver DOES record
// 'arming' and 'bursting' (so fireBurst — and therefore confetti — ran), and
// (2) the aria-live result still fires. .lootbox-stage is exempted from the
// global prefers-reduced-motion rule in globals.css, so the keyframes run
// unchanged and playReveal() no longer short-circuits under reduce.
// ---------------------------------------------------------------------------

test.describe("Gate D: reduced motion still plays the full reveal (matches casino)", () => {
  test("reduced motion runs arming + bursting (confetti fires) and announces via aria-live", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLootboxModal(page)
    await watchPhases(page)

    const start = Date.now()
    await stage(page)
      .getByRole("button", { name: /^Open for \d+ ZP$/ })
      .click()
    await expect(page.locator('.lootbox-stage[data-phase="settled"]')).toBeVisible({ timeout: 5_000 })
    const elapsed = Date.now() - start

    // The reveal ran its real timeline (anticipation 300ms + burst 130ms +
    // reveal 400ms), so this is NOT a sub-second fast path.
    expect(elapsed).toBeGreaterThan(500)

    const phases = (await readPhaseLog(page)).map((e) => e.phase)
    expect(phases).toContain("arming")
    expect(phases).toContain("bursting")

    const liveRegion = page.getByRole("dialog").locator('[aria-live="polite"]')
    await expect(liveRegion).toContainText(/New!|Duplicate/)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateD-reduced-motion-result.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate E: forcing rarity via page.route() interception of the openBox tRPC
// response visibly escalates the reveal (UI-SPEC §11 point 5) — proving the
// fully-built Rare/Legendary choreography works with zero further animation
// code, even though every real catalog item today is COMMON.
// ---------------------------------------------------------------------------

for (const rarity of ["RARE", "LEGENDARY"] as const) {
  test.describe(`Gate E: forced ${rarity} escalation`, () => {
    test(`intercepting openBox to force ${rarity} shows the ${RARITY_LABEL[rarity]} chip, a longer anticipation than Common, and no overflow`, async ({
      page,
      request,
    }) => {
      test.setTimeout(20_000)
      await setBalance(request, 500)
      await signIn(page)

      await page.route("**/api/trpc/shop.openBox**", async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: forceRarity(body, rarity) })
      })

      await openLootboxModal(page)
      await watchPhases(page)

      await stage(page)
        .getByRole("button", { name: /^Open for \d+ ZP$/ })
        .click()
      await expect(
        page.locator(`.lootbox-stage[data-rarity="${rarity.toLowerCase()}"][data-phase="settled"]`),
      ).toBeVisible({ timeout: 5_000 })

      // Escalation proof: the timeline visited 'bursting' (fireBurst/confetti ran),
      // and its own arming→bursting duration (a pure JS setTimeout, isolated from
      // network/mutation round-trip jitter — unlike an end-to-end wall-clock
      // comparison, which is too noisy to reliably clear RARE's tight +150ms
      // margin over Common) is longer than Gate B's measured Common baseline.
      const log = await readPhaseLog(page)
      const phases = log.map((e) => e.phase)
      expect(phases).toContain("bursting")
      const armingMs = phaseDurationMs(log, "arming", "bursting")
      if (commonArmingMs > 0 && armingMs !== null) {
        expect(armingMs).toBeGreaterThan(commonArmingMs)
      }

      await expect(stage(page).getByText(RARITY_LABEL[rarity], { exact: true })).toBeVisible()
      await assertNoPageOverflow(page)

      await page.screenshot({
        path: path.join(SHOT_DIR, `gateE-forced-${rarity.toLowerCase()}.png`),
      })
    })
  })
}
