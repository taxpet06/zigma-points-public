// Monkey Test mobile UAT — 21-10-PLAN.md Task 1, the Phase 21 gate. Mirrors
// tests/e2e/zross-mobile-uat.spec.ts's harness verbatim (viewport, serial mode,
// signUp/signIn/setBalance against the live dev server + real Postgres, screenshot
// directory convention). Monkey Test lives in the Competitive tab
// (game-hub-tabs.tsx), same as Znake/Zross/Tetris.
//
// Naming: "Monkey Test" is the player-facing name; the directory, router key, Prisma
// model and `sr-*` CSS prefix all stay `sequence-recall`. Same display-vs-internal
// split as Tetris shipping as "Petris" (src/lib/tetris-prizes.ts).
//
// This game's anti-cheat contract lets a real Playwright test independently
// re-derive what the client is SUPPOSED to show: targetForRound(seed, tier, round)
// (src/components/game-hub/sequence-recall/engine.ts) is a pure function with zero
// React/DOM/Prisma imports, so it can be imported directly into this Node-side test
// file (same precedent as tests/e2e/dice-mobile-uat.spec.ts / wheel-mobile-uat.spec.ts
// importing pure lib modules straight from src/). Every gate below that needs to know
// "which tile is actually correct" captures the run's real seed by reading through
// (never rewriting) the sequenceRecall.start response via page.route(), then calls
// targetForRound with that seed — never a hardcoded/guessed tile index.
//
// Gate D (reduced motion blink) installs a MutationObserver on document.body BEFORE
// the run starts (not after the board mounts) — the first tile's blink-on class swap
// can fire within a few ms of mount (window.setTimeout(..., 0)), so an observer
// attached only after confirming the board is visible risks missing it. Every
// class-attribute mutation on a `Tile N, ...`-labelled button is logged with a
// performance.now() timestamp (the Phase 18-05 methodology: an in-process phase log,
// not a wall-clock read, isolates the ~240ms BLINK_ON_MS proof from network jitter).
//
// Gate E (reduced motion confetti suppression) forces `tierCleared: true` on the
// submitRound response via the same page.route() deep-walk-rewrite technique as
// lootbox-mobile-uat.spec.ts's forceRarity / zross-mobile-uat.spec.ts's
// forceOutOfRuns (test-only, zero production code path touched — T-21-46). Reading
// the scoped canvas's toDataURL() to prove "no confetti drew" is safe here
// specifically BECAUSE canvas-confetti's fire() returns before ever touching the
// canvas when `disableForReducedMotion && preferLessMotion` (confirmed by reading
// node_modules/canvas-confetti/dist/confetti.module.mjs directly this session,
// lines 614-622) — the worker's `transferControlToOffscreen()` handoff (which would
// make toDataURL() throw afterward) never runs on that early-return path, so the
// canvas stays a normal, readable, untouched main-thread canvas the whole test.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"
import { targetForRound } from "@/components/game-hub/sequence-recall/engine"
import { GRID_SIZE, TILE_COUNT, BLINK_ON_MS } from "@/components/game-hub/sequence-recall/constants"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

type UatUser = { name: string; email: string; password: string }

const TS = Date.now()
const USER: UatUser = { name: "SeqRecall UAT", email: `seqrecalluat${TS}@example.com`, password: "SeqRecallUAT123!" }
const KEYBOARD_USER: UatUser = {
  name: "SeqRecall Keyboard UAT",
  email: `seqrecallkbuat${TS}@example.com`,
  password: "SeqRecallKbUAT123!",
}
const MOTION_USER: UatUser = {
  name: "SeqRecall Motion UAT",
  email: `seqrecallmotionuat${TS}@example.com`,
  password: "SeqRecallMotionUAT123!",
}
const CONFETTI_USER: UatUser = {
  name: "SeqRecall Confetti UAT",
  email: `seqrecallconfettiuat${TS}@example.com`,
  password: "SeqRecallConfettiUAT123!",
}

const SHOT_DIR = path.join(
  process.cwd(),
  ".planning/phases/21-sequence-recall-competitive-memory-game-escalating-tile-sequ/uat-screenshots",
)

const CARD_NAME = /Monkey Test — memorize the blinking tiles/i

async function approveEmail(request: APIRequestContext, user: UatUser) {
  const res = await request.post("/api/test/approve-email", { data: { email: user.email } })
  expect(res.ok()).toBeTruthy()
}

async function signUp(page: Page, user: UatUser) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(user.name)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function signIn(page: Page, user: UatUser) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function setBalance(request: APIRequestContext, user: UatUser, zigmaPoints: number) {
  const res = await request.post("/api/test/seed-balance", { data: { email: user.email, zigmaPoints } })
  expect(res.ok()).toBeTruthy()
}

async function openSequenceRecall(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /competitive/i }).click()
  const card = page.getByRole("button", { name: CARD_NAME })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("button", { name: /start (free run|replay)/i })).toBeVisible({ timeout: 5_000 })
  // The dialog's own enter transition (fade-in-0 + zoom-in-95) is still running the
  // instant the Start button becomes visible — same 300ms settle precedent as every
  // other mobile-UAT openX helper in this repo.
  await page.waitForTimeout(300)
}

function tileLocator(page: Page, index: number) {
  const tileNum = index + 1
  const row = Math.floor(index / GRID_SIZE) + 1
  const col = (index % GRID_SIZE) + 1
  return page.getByRole("button", { name: new RegExp(`^Tile ${tileNum}, row ${row} column ${col}`) })
}

// Deep-walks a parsed tRPC batch response and returns the first `seed` value found
// alongside a sibling `runId` key (the sequenceRecall.start payload shape, wherever
// superjson's json/meta batching nests it) — read-only, never mutates the response.
function findSeed(node: unknown): number | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findSeed(n)
      if (r !== null) return r
    }
    return null
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    if ("seed" in obj && "runId" in obj && typeof obj.seed === "number") return obj.seed
    for (const v of Object.values(obj)) {
      const r = findSeed(v)
      if (r !== null) return r
    }
  }
  return null
}

// Clicks Start, intercepting (read-through, not rewriting) the sequenceRecall.start
// response to capture the run's real server-issued seed — the anti-cheat's sole
// source of truth for which tile sequence the round actually requires. Resolves once
// the board's first tile is on screen, which cannot happen before start() resolved.
async function startRunCapturingSeed(page: Page): Promise<number> {
  let seed: number | null = null
  await page.route(/\/api\/trpc\/.*sequenceRecall\.start/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    seed = findSeed(body)
    await route.fulfill({ response, json: body })
  })
  await page.getByRole("button", { name: /start (free run|replay)/i }).click()
  await expect(tileLocator(page, 0)).toBeVisible({ timeout: 5_000 })
  await page.unroute(/\/api\/trpc\/.*sequenceRecall\.start/)
  if (seed === null) throw new Error("Could not capture seed from sequenceRecall.start response")
  return seed
}

async function waitArmed(page: Page) {
  // Blink playback (up to BLINK_ON_MS+BLINK_GAP_MS per tile) + the beginRound
  // round-trip must complete before the window arms — generous timeout for a live
  // dev-server request.
  await expect(page.getByText("Your turn")).toBeVisible({ timeout: 8_000 })
}

// Installs a MutationObserver on document.body BEFORE any run starts — the first
// tile's blink-on class swap can fire within milliseconds of the board mounting, so
// installing only after confirming the board is visible risks missing it entirely.
// Uses addInitScript (not evaluate) because openSequenceRecall()'s page.goto()
// navigation below is a full document reload that would otherwise wipe out an
// evaluate()-installed observer before it ever saw a mutation — addInitScript
// re-injects on every new document in this page, including that navigation.
async function installBlinkWatcher(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __srBlinkLog: { label: string; on: boolean; t: number }[] }
    w.__srBlinkLog = []
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target as HTMLElement
        if (el.tagName !== "BUTTON") continue
        const label = el.getAttribute("aria-label") ?? ""
        if (!label.startsWith("Tile ")) continue
        const cls = el.className
        if (cls.includes("sr-tile-on")) {
          w.__srBlinkLog.push({ label, on: true, t: performance.now() })
        } else if (cls.includes("sr-tile-off")) {
          w.__srBlinkLog.push({ label, on: false, t: performance.now() })
        }
      }
    })
    // addInitScript runs at document-creation time, before the parser has produced
    // ANY element — document.documentElement is still null then (confirmed this
    // session: observe() throws "parameter 1 is not of type 'Node'" if pointed at
    // it here). `document` itself is a Node that always exists synchronously, and
    // MutationObserver's subtree option walks the live tree at mutation time, not
    // a snapshot taken at observe()-call time — so observing `document` with
    // subtree:true still catches every later mutation once <body> and the React
    // tree are attached beneath it.
    obs.observe(document, { attributes: true, attributeFilter: ["class"], subtree: true })
  })
}

async function readBlinkLog(page: Page): Promise<{ label: string; on: boolean; t: number }[]> {
  return page.evaluate(
    () => (window as unknown as { __srBlinkLog: { label: string; on: boolean; t: number }[] }).__srBlinkLog ?? [],
  )
}

// Deep-walks a parsed tRPC batch response and forces the submitRound payload's
// tierCleared true (keeping runEnded false so the client's celebrateTierClear
// branch — not the failure branch — fires) — test-only, no server change (T-21-46).
function forceTierCleared(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((n) => forceTierCleared(n))
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) next[k] = forceTierCleared(v)
    if ("tierCleared" in next && "runEnded" in next) {
      next.tierCleared = true
      next.runEnded = false
    }
    return next
  }
  return node
}

// Ends the currently-active run the same way a real player would (the dialog's
// icon-only X — the only "Close" control rendered during active play).
async function closeActiveRun(page: Page) {
  await page.getByRole("button", { name: "Close" }).first().click()
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.describe("Setup", () => {
  test("create test user", async ({ page, request }) => {
    await approveEmail(request, USER)
    await signUp(page, USER)
  })
})

// ---------------------------------------------------------------------------
// Gate A: 360x640 fit — HUD (both rows) + 5x5 grid, no page/dialog scroll during
// active play (21-UI-SPEC.md §11 point 7).
// ---------------------------------------------------------------------------

test.describe("Gate A: 360x640 fit — HUD + grid, no dialog scroll", () => {
  test("the dialog needs no internal scroll and all 25 tiles are visible simultaneously at the tallest (armed) HUD state", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await setBalance(request, USER, 500)
    await signIn(page, USER)
    await openSequenceRecall(page)
    await startRunCapturingSeed(page)
    // Measure at the armed state — the countdown number + bar (§4) is the tallest
    // the two-row HUD ever gets, so this is the worst case for no-scroll.
    await waitArmed(page)

    const dialog = page.getByRole("dialog")
    const [dialogScrollHeight, dialogClientHeight] = await dialog.evaluate((el) => [el.scrollHeight, el.clientHeight])
    expect(dialogScrollHeight).toBeLessThanOrEqual(dialogClientHeight)

    for (let i = 0; i < TILE_COUNT; i++) {
      const box = await tileLocator(page, i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(640)
    }

    await page.screenshot({ path: path.join(SHOT_DIR, "gateA-fit-360x640.png") })

    await closeActiveRun(page)
  })
})

// ---------------------------------------------------------------------------
// Gate B: every tile and every dialog button measures at least 44px on the short
// axis (21-UI-SPEC.md §11 point 7, §6's clamp floor).
// ---------------------------------------------------------------------------

test.describe("Gate B: touch targets — 44px floor on tiles and every dialog button", () => {
  test("the ready-screen Start button, all 25 tiles, and the summary buttons all measure at least 44px", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await setBalance(request, USER, 500)
    await signIn(page, USER)
    await openSequenceRecall(page)

    const startBtn = page.getByRole("button", { name: /start (free run|replay)/i })
    const startBox = await startBtn.boundingBox()
    expect(startBox).not.toBeNull()
    expect(startBox!.height).toBeGreaterThanOrEqual(44)

    const seed = await startRunCapturingSeed(page)
    const target = targetForRound(seed, 1, 1)

    for (let i = 0; i < TILE_COUNT; i++) {
      const box = await tileLocator(page, i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }

    await waitArmed(page)
    // A deliberately wrong tap (never the seed-derived correct tile) — deterministic
    // failure, so the summary screen is reachable without waiting out the 5s window.
    const wrongIndex = (target[0] + 1) % TILE_COUNT
    await tileLocator(page, wrongIndex).click()
    await expect(page.getByText("Run over", { exact: true })).toBeVisible({ timeout: 8_000 })

    const playAgain = page.getByRole("button", { name: /^Play again/ })
    const summaryClose = page.getByRole("button", { name: "Close" }).filter({ hasText: "Close" })
    for (const btn of [playAgain, summaryClose]) {
      const box = await btn.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await page.screenshot({ path: path.join(SHOT_DIR, "gateB-touch-targets.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate C: Tab reaches the tiles with a visible focus ring, Enter activates a tile
// exactly like a tap, and no role="grid"/"gridcell" ARIA is present
// (21-UI-SPEC.md §5/§8/§11 point 8).
// ---------------------------------------------------------------------------

test.describe("Gate C: keyboard — Tab focus ring, Enter activation, no grid ARIA", () => {
  test("Tab focuses a tile with a visible ring and Enter registers a tap identically to a click", async ({
    page,
    request,
  }) => {
    test.setTimeout(20_000)
    await approveEmail(request, KEYBOARD_USER)
    // signUp() itself lands the page authenticated at "/" (session cookie already
    // set on THIS page) — a further signIn() call here would hit the sign-in form
    // while already logged in and time out waiting for fields that never render
    // (same precedent as zross-mobile-uat.spec.ts's MOTION_USER comment).
    await signUp(page, KEYBOARD_USER)
    await setBalance(request, KEYBOARD_USER, 500)
    await openSequenceRecall(page)

    const seed = await startRunCapturingSeed(page)
    const target = targetForRound(seed, 1, 1)
    // Pick a tile index that is guaranteed WRONG for this round, so pressing Enter
    // on it has a single deterministic outcome (no race with a correct tap
    // completing the round and resetting tile state before the assertion reads it).
    const wrongIndex = target[0] === 0 ? 1 : 0

    await waitArmed(page)

    // Native <button> Tab order over the 25 tiles is row-major — press Tab forward
    // (from wherever the dialog's own focus currently sits) until landing on the
    // exact tile under test.
    let landed = false
    for (let i = 0; i < 40 && !landed; i++) {
      await page.keyboard.press("Tab")
      const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? null)
      landed = !!label && label.startsWith(`Tile ${wrongIndex + 1},`)
    }
    expect(landed).toBe(true)

    // No role="grid"/"gridcell" ARIA anywhere on the board — native <button> Tab
    // order over 25 real buttons already gives correct semantics for free
    // (21-UI-SPEC.md §5/§10).
    expect(await page.locator('[role="grid"], [role="gridcell"]').count()).toBe(0)

    // Visible focus ring: the focused tile's computed box-shadow must differ from
    // an unfocused idle tile's (both carry the same baseline inset bevel; only the
    // focused one additionally carries the focus-visible ring layer).
    const focusedBoxShadow = await page.evaluate(() => getComputedStyle(document.activeElement as Element).boxShadow)
    const controlIndex = (wrongIndex + 2) % TILE_COUNT
    const controlBoxShadow = await tileLocator(page, controlIndex).evaluate((el) => getComputedStyle(el).boxShadow)
    expect(focusedBoxShadow).not.toBe(controlBoxShadow)

    await page.keyboard.press("Enter")
    // A wrong tap flashes the tile's aria-label to include ", wrong" before the
    // ~600ms defer to the summary screen — same registration Gate B's click-based
    // wrong tap produces.
    await expect(tileLocator(page, wrongIndex)).toHaveAttribute("aria-label", /wrong/, { timeout: 2_000 })

    await page.screenshot({ path: path.join(SHOT_DIR, "gateC-keyboard-focus.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate D: with prefers-reduced-motion enabled, the blink sequence is still fully
// visible, in order, and correctly timed (21-UI-SPEC.md §7, T-21-45).
// ---------------------------------------------------------------------------

test.describe("Gate D: reduced motion — blink stays visible, ordered, and JS-timed", () => {
  test("each tile in the round's sequence still visibly turns on then off, in the seed's exact order, for close to BLINK_ON_MS", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await approveEmail(request, MOTION_USER)
    await signUp(page, MOTION_USER)
    await setBalance(request, MOTION_USER, 500)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await installBlinkWatcher(page)
    await openSequenceRecall(page)

    const seed = await startRunCapturingSeed(page)
    const target = targetForRound(seed, 1, 1)

    await waitArmed(page)

    const log = await readBlinkLog(page)
    const onEntries = log.filter((e) => e.on)
    // (a) at least one tile enters the ON state — the blink is not silently skipped.
    expect(onEntries.length).toBeGreaterThanOrEqual(target.length)
    // (b) the ON states occur in the order the sequence requires.
    for (let i = 0; i < target.length; i++) {
      expect(onEntries[i].label.startsWith(`Tile ${target[i] + 1},`)).toBe(true)
    }
    // (c) each ON window's measured duration is within a generous tolerance of
    // BLINK_ON_MS — proof JS still owns the timing though the CSS ease is stripped.
    const firstLabelPrefix = `Tile ${target[0] + 1},`
    const onEvt = log.find((e) => e.on && e.label.startsWith(firstLabelPrefix))
    expect(onEvt).toBeTruthy()
    const offEvt = log.find((e) => !e.on && e.label.startsWith(firstLabelPrefix) && e.t > onEvt!.t)
    expect(offEvt).toBeTruthy()
    const durationMs = offEvt!.t - onEvt!.t
    expect(durationMs).toBeGreaterThan(BLINK_ON_MS * 0.4)
    expect(durationMs).toBeLessThan(BLINK_ON_MS * 2.5)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateD-reduced-motion-blink.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate E: with prefers-reduced-motion enabled, the tier-clear confetti does not
// fire while the Tier banner still appears (21-UI-SPEC.md §7, T-21-46).
// ---------------------------------------------------------------------------

test.describe("Gate E: reduced motion — Tier banner appears, confetti canvas stays blank", () => {
  test("forcing a tier clear under reduced motion shows the Tier N banner but draws nothing on the scoped confetti canvas", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await approveEmail(request, CONFETTI_USER)
    await signUp(page, CONFETTI_USER)
    await setBalance(request, CONFETTI_USER, 500)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openSequenceRecall(page)

    const seed = await startRunCapturingSeed(page)
    const target = targetForRound(seed, 1, 1)

    await page.route(/\/api\/trpc\/.*sequenceRecall\.submitRound/, async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: forceTierCleared(body) })
    })

    await waitArmed(page)
    // The real, seed-correct tap — submitRound's genuine response is a normal
    // round-clear; the interception above only flips tierCleared afterward.
    await tileLocator(page, target[0]).click()

    const banner = page.locator(".sr-tier-banner")
    await expect(banner).toBeVisible({ timeout: 5_000 })
    await expect(banner).toContainText(/^Tier \d+$/)

    // The scoped canvas never got resized/drawn/transferred-to-worker on this
    // early-return path (see file header comment) — a byte-identical toDataURL to
    // a fresh, same-sized, untouched canvas is direct proof nothing was drawn.
    const canvas = page.locator("canvas[aria-hidden='true']")
    await page.waitForTimeout(300)
    const actualDataUrl = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())
    const blankDataUrl = await canvas.evaluate((el: HTMLCanvasElement) => {
      const fresh = document.createElement("canvas")
      fresh.width = el.width
      fresh.height = el.height
      return fresh.toDataURL()
    })
    expect(actualDataUrl).toBe(blankDataUrl)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateE-reduced-motion-tier-banner.png") })
  })
})
