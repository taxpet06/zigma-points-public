// Zross mobile UAT — 19-08-PLAN.md Task 1, the Phase 19 gate. Mirrors
// tests/e2e/lootbox-mobile-uat.spec.ts / wheel-mobile-uat.spec.ts's harness verbatim
// (viewport, serial mode, signUp/signIn/setBalance against the live dev server and real
// Postgres, screenshot directory convention). Zross lives in the Competitive tab
// (tests/e2e/tetris.spec.ts is the precedent for that tab + the "start (free run|
// replay)" button regex), not Casino.
//
// Gate C's fourth button (out-of-runs Close) forces zross.getStatus via page.route()
// deep-walk rewrite — the same technique as lootbox-mobile-uat.spec.ts's forceRarity,
// generalized to whatever key identifies the getStatus payload (runsRemaining + canPlay
// both present) instead of assuming an exact batch/superjson nesting shape. T-19-14:
// interception is test-only and touches no production code path.
//
// Gate D (reduced motion) is the OPPOSITE assertion direction from the lootbox reveal
// (which deliberately exempts itself from prefers-reduced-motion, per its own leading
// comment, so the reveal still runs at full length under reduce). Zross mutes
// decoration but keeps the simulation running (UI-SPEC §7: "reduced motion mutes
// decoration, never simulation"). Do not copy the lootbox/casino specs' "motion still
// runs at full length" direction here.
//
// Every real-run test seeds a 500 ZP balance up front so Zross's single free play/day
// (FREE_PLAYS_PER_DAY=1) never gates a later gate's own start() call behind a balance
// this fresh test user doesn't have — every start after the first costs the 5 ZP
// COMPETITIVE_REPLAY_COST, which 500 ZP affords for the whole file.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Zross UAT",
  email: `zrossuat${TS}@example.com`,
  password: "ZrossUAT123!",
}

// Gate D (below) is the row 19-VALIDATION.md's Per-Task Verification Map pins to its
// own isolated command (`-g "reduced motion"`) — a Playwright `-g` filter drops any
// test/describe title that doesn't match the pattern, INCLUDING the shared "Setup"
// block above that provisions USER. Running that command alone would sign in as a
// user that was never signed up. Gate D therefore provisions its own dedicated user
// inline instead of depending on Setup/USER, so it's genuinely runnable standalone.
const MOTION_USER = {
  name: "Zross Motion UAT",
  email: `zrossmotionuat${TS}@example.com`,
  password: "ZrossMotionUAT123!",
}

const SHOT_DIR = path.join(
  process.cwd(),
  ".planning/phases/19-zross-neon-crossing-mini-game/uat-screenshots",
)

async function approveEmail(request: APIRequestContext, user: typeof USER = USER) {
  const res = await request.post("/api/test/approve-email", { data: { email: user.email } })
  expect(res.ok()).toBeTruthy()
}

async function signUp(page: Page, user: typeof USER = USER) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(user.name)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function signIn(page: Page, user: typeof USER = USER) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function setBalance(request: APIRequestContext, zigmaPoints: number, user: typeof USER = USER) {
  const res = await request.post("/api/test/seed-balance", {
    data: { email: user.email, zigmaPoints },
  })
  expect(res.ok()).toBeTruthy()
}

const ZROSS_CARD_NAME = /Zross — swipe or tap to hop, snag logos to earn/i

async function openZross(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /competitive/i }).click()
  const card = page.getByRole("button", { name: ZROSS_CARD_NAME })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("button", { name: /start (free run|replay)/i })).toBeVisible({ timeout: 5_000 })
  // The dialog's own enter transition (fade-in-0 + zoom-in-95) is still running the
  // instant the Start button becomes visible — same 300ms settle precedent as every
  // other mobile-UAT openX helper in this repo (lootbox/wheel).
  await page.waitForTimeout(300)
}

async function startRun(page: Page) {
  await page.getByRole("button", { name: /start (free run|replay)/i }).click()
  const board = page.getByLabel("Zross game canvas")
  await expect(board).toBeVisible({ timeout: 5_000 })
  // ResizeObserver's syncCanvasSize settling window (zross-game.tsx) — mirrors the
  // 300ms transition-settle precedent used throughout this file.
  await page.waitForTimeout(300)
  return board
}

/** Ends the currently-active run the same way a real player would (the dialog's
 *  icon-only X — the only "Close" control rendered during active play; the
 *  text-labeled Close variants only render in the summary/error/out-of-runs states).
 *  Mirrors tetris.spec.ts's own reasoning: leaving an ACTIVE row dangling just makes
 *  the 5-minute server sweep do the work this close already does for free. */
async function closeActiveRun(page: Page) {
  await page.getByRole("button", { name: "Close" }).click()
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5_000 })
  // Let the mutation's fetch actually land before the test (and its page/context)
  // tears down — onEnd() fires from the unmount cleanup, which is fire-and-forget.
  await page.waitForTimeout(500)
}

/** Deterministic death, independent of the run's random seed. Lane 0 is
 *  unconditionally forced "plaza" (engine.ts's createWorld — a run never opens on a
 *  hazard) and hop() rejects a "down" target below lane 0 (laneAt returns undefined —
 *  no lane is ever generated there), so a single "down" press starts the sim clock
 *  (requestHop always flips hasStartedRef, even when the resulting hop() call itself
 *  no-ops) while pinning the frog on a lane with zero lethal hazard types — plaza never
 *  kills via checkAtRestHazards. The camera (cameraRateFor) still advances every frame
 *  regardless of the frog's own hazard exposure, so a "camera" death is guaranteed
 *  within a few seconds (~5s: CAMERA_TRAILING_MARGIN=2 rows / CAMERA_RATE_BASE=0.4
 *  rows/sec) — the same math holds for every seed, since it depends only on engine
 *  constants, never on generated lane content. */
async function forceCameraDeath(page: Page) {
  await page.keyboard.press("ArrowDown")
  await expect(page.getByText("Run over")).toBeVisible({ timeout: 15_000 })
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
// Gate A (ZCTL-04): 360x640 fit — board, HUD and pad, no page scroll during active
// play.
// ---------------------------------------------------------------------------

test.describe("Gate A: 360x640 fit — board, HUD and pad, no page scroll", () => {
  test("the board, HUD overlay and on-screen pad all sit inside the viewport with no page scroll during active play", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)
    await openZross(page)
    const board = await startRun(page)

    // "No page scroll" means the DIALOG itself needs no internal scroll — Radix Dialog
    // (components/ui/dialog.tsx) is `max-h-[calc(100dvh-2rem)] overflow-y-auto` and
    // scroll-locks the page behind it while open, so document.documentElement's own
    // scrollHeight (the full game-hub page behind the modal, which is naturally taller
    // than one viewport and is exactly what the scroll-lock exists to hide) is the
    // wrong thing to measure — it stays > innerHeight regardless of whether Zross
    // itself fits, and asserting on it produced a false failure here during this
    // gate's own development. The dialog's own scrollHeight vs. its clientHeight is
    // what UI-SPEC §11 point 5 actually means by "no page or dialog scroll".
    const dialog = page.getByRole("dialog")
    const [dialogScrollHeight, dialogClientHeight] = await dialog.evaluate((el) => [
      el.scrollHeight,
      el.clientHeight,
    ])
    expect(dialogScrollHeight).toBeLessThanOrEqual(dialogClientHeight)

    const boardBox = await board.boundingBox()
    expect(boardBox).not.toBeNull()
    expect(boardBox!.y).toBeGreaterThanOrEqual(0)
    expect(boardBox!.y + boardBox!.height).toBeLessThanOrEqual(640)

    // HUD overlay — the "Distance <n>m" line is unique to the HUD during active play
    // (the ready screen's ZpRules panel isn't mounted once a run has started).
    const distanceLine = page.getByText(/^Distance \d+m$/)
    await expect(distanceLine).toBeVisible()
    const hudBox = await distanceLine.boundingBox()
    expect(hudBox).not.toBeNull()
    expect(hudBox!.y + hudBox!.height).toBeLessThanOrEqual(640)

    // On-screen pad — "Hop back" is the pad's bottom row, the lowest of the four
    // direction buttons.
    const padBottom = page.getByRole("button", { name: "Hop back" })
    await expect(padBottom).toBeVisible()
    const padBox = await padBottom.boundingBox()
    expect(padBox).not.toBeNull()
    expect(padBox!.y + padBox!.height).toBeLessThanOrEqual(640)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateA-fit-360x640.png") })

    await closeActiveRun(page)
  })
})

// ---------------------------------------------------------------------------
// Gate B (ZCTL-04, ZRSS-02): board geometry — 7/9 aspect ratio, height inside the
// UI-SPEC §6 derived band (288px at 360x640).
// ---------------------------------------------------------------------------

test.describe("Gate B: board geometry — 7/9 aspect ratio at the derived 288px height", () => {
  test("the canvas measures a 7/9 aspect ratio and ~288px height at 360x640", async ({ page, request }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)
    await openZross(page)
    const board = await startRun(page)

    const box = await board.boundingBox()
    expect(box).not.toBeNull()

    // UI-SPEC §6 derivation: height = max(260, min(100dvh-22rem, 360)) = 288px at
    // 360x640; width auto-derives via aspect-ratio: 7/9 (≈224px). A few px of
    // tolerance for subpixel canvas layout rounding.
    expect(Math.abs(box!.height - 288)).toBeLessThanOrEqual(3)
    expect(box!.height).toBeGreaterThanOrEqual(260)
    expect(box!.height).toBeLessThanOrEqual(360)

    const ratio = box!.width / box!.height
    expect(Math.abs(ratio - 7 / 9)).toBeLessThanOrEqual(0.02)

    await closeActiveRun(page)
  })
})

// ---------------------------------------------------------------------------
// Gate C (ZCTL-03 accessibility floor / UI-SPEC §10): every dialog button measures
// >=44px tall, including the out-of-runs Close ordinary manual testing will not reach.
// ---------------------------------------------------------------------------

test.describe("Gate C: touch targets — summary buttons (Play again / Close)", () => {
  test("both summary-screen buttons measure at least 44px tall", async ({ page, request }) => {
    test.setTimeout(30_000)
    await setBalance(request, 500)
    await signIn(page)
    await openZross(page)
    await startRun(page)
    await forceCameraDeath(page)

    const playAgain = page.getByRole("button", { name: /^Play again/ })
    const summaryClose = page.getByRole("button", { name: "Close" }).filter({ hasText: "Close" })

    for (const btn of [playAgain, summaryClose]) {
      const box = await btn.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await page.screenshot({ path: path.join(SHOT_DIR, "gateC-summary-buttons.png") })
  })
})

test.describe("Gate C: touch targets — error state Close", () => {
  test("the error-state Close button measures at least 44px tall", async ({ page, request }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)

    // Force statusQ.isError by making the getStatus request fail outright — test-only,
    // no production code path touched. A plain "**/api/trpc/zross.getStatus**" glob
    // looked right but doesn't reliably match: the game hub's httpBatchLink coalesces
    // every OTHER game card's own status query fired on the same tick into one
    // comma-joined URL (e.g. "/api/trpc/znake.getStatus,zross.getStatus,..."), so
    // "zross.getStatus" isn't always the first/only segment right after "trpc/" — a
    // regex that allows anything before it within the trpc path is what actually
    // matches regardless of batch order.
    await page.route(/\/api\/trpc\/.*zross\.getStatus/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "[]" }),
    )

    await page.goto("/game-hub")
    await page.getByRole("tab", { name: /competitive/i }).click()
    const card = page.getByRole("button", { name: ZROSS_CARD_NAME })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()

    await expect(page.getByText(/Couldn.t load your runs/i)).toBeVisible({ timeout: 10_000 })
    // The dialog's own enter transition (zoom-in-95 → 100, duration-200) is still
    // running the instant its content becomes visible — a bounding-box read taken
    // then captures a still-scaling (and so under-height) frame, same precedent as
    // every other openX helper's 300ms settle in this file.
    await page.waitForTimeout(300)
    const errorClose = page.getByRole("button", { name: "Close" }).filter({ hasText: "Close" })
    const box = await errorClose.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
})

// Deep-walks a parsed tRPC response and rewrites the getStatus payload wherever it
// lands in superjson's json/meta batching — identified by carrying BOTH
// runsRemaining and canPlay, rather than assuming an exact nesting shape (same
// technique as lootbox-mobile-uat.spec.ts's forceRarity).
function forceOutOfRuns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((n) => forceOutOfRuns(n))
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) next[k] = forceOutOfRuns(v)
    if ("runsRemaining" in next && "canPlay" in next) {
      next.runsRemaining = 0
      next.canAffordReplay = false
      next.canPlay = false
    }
    return next
  }
  return node
}

test.describe("Gate C: touch targets — out-of-runs Close (forced, unreachable by ordinary manual testing)", () => {
  test("the out-of-runs Close button measures at least 44px tall", async ({ page, request }) => {
    test.setTimeout(20_000)
    await setBalance(request, 500)
    await signIn(page)

    // See the error-state Gate C test above for why this needs a regex rather than a
    // "**/api/trpc/zross.getStatus**" glob (httpBatchLink batch-order coalescing).
    await page.route(/\/api\/trpc\/.*zross\.getStatus/, async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: forceOutOfRuns(body) })
    })

    await page.goto("/game-hub")
    await page.getByRole("tab", { name: /competitive/i }).click()
    const card = page.getByRole("button", { name: ZROSS_CARD_NAME })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()

    await expect(page.getByText(/Your free run is used/i)).toBeVisible({ timeout: 10_000 })
    // Same dialog-transition settle as the error-state Gate C test above.
    await page.waitForTimeout(300)
    const outOfRunsClose = page.getByRole("button", { name: "Close" }).filter({ hasText: "Close" })
    const box = await outOfRunsClose.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateC-out-of-runs-close.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate D (ZCTL-03): reduced motion mutes decoration, keeps the simulation running.
// ---------------------------------------------------------------------------

test.describe("Gate D: reduced motion mutes decoration, keeps simulation running", () => {
  test("reduced motion sets the client's own data-reduced-motion flag, a hop still advances Distance, and the run still resolves to a death + summary", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    // Self-contained sign-up (see MOTION_USER's comment above) — this test must pass
    // when run alone via `-g "reduced motion"`, which drops the shared Setup block.
    // signUp() itself lands the page authenticated at "/" (session cookie already
    // set on THIS page/context) — a further signIn() call here would hit the
    // sign-in form while already logged in and redirected away from it.
    await approveEmail(request, MOTION_USER)
    await signUp(page, MOTION_USER)
    await setBalance(request, 500, MOTION_USER)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openZross(page)
    const board = await startRun(page)

    // Proof the client's own prefersReducedMotion const (the SAME value every
    // particle/shake/banner/pulse function above branches on) evaluated true — not a
    // second, independent media query guessed at from the test side.
    await expect(board).toHaveAttribute("data-reduced-motion", "true")

    const distanceLine = page.getByText(/^Distance \d+m$/)
    const before = await distanceLine.textContent()

    // A single forward hop is enough to land on lane 1 and bump world.distance — proof
    // the SIMULATION (not just decoration) responds to input under reduced motion.
    // ZCTL-03: reduced motion must never freeze gameplay, only mute its decoration.
    // "Up" alone flaked here during this gate's own development: engine.ts's startHop
    // silently rejects a hop into a wall or a randomly-placed plaza blocker column,
    // and on some seeds lane 1's blocker sat directly under the frog's start column.
    // Cycling through every direction that can't wall-clamp from the frog's centre
    // start column (Right/Left/Up — Down is structurally a no-op on the very first
    // hop, see forceCameraDeath's own comment) makes landing on SOME new lane a
    // near-certainty regardless of any one lane's blocker placement.
    let after = before
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp"]) {
      if (after !== before) break
      await page.keyboard.press(key)
      await page.waitForTimeout(200) // HOP_MS (140ms) + a frame's margin
      after = await distanceLine.textContent()
    }
    expect(after).not.toBe(before)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateD-reduced-motion-active.png") })

    // Whether that hop landed on a safe lane or an instantly fatal one, forcing the
    // deterministic camera-catch path below still resolves the run — proving the
    // reduced-motion death sequence (shakeDur/vignetteDur are still SET under reduce;
    // only their amplitude/shake branch itself reads prefersReducedMotion — see the
    // `!prefersReducedMotion && shakeDur > 0` guard in zross-game.tsx) reaches
    // onEnd()/the summary screen instead of freezing mid-death.
    await page.keyboard.press("ArrowDown")
    await expect(page.getByText("Run over")).toBeVisible({ timeout: 15_000 })
  })
})
