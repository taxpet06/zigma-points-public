// Petris (code slug `tetris`) — E2E user-flow spec
//
// Auth pattern: local signUp/signIn helpers (same pattern as flappy.spec.ts,
// auth.spec.ts — no shared helpers file exists).
//
// Reconciled against the shipped UI (Plan 09-05): tetris.tsx (card + dialog),
// tetris-game.tsx (canvas + on-screen control pad). Petris is free to
// play (no ZP cost to start, unlike Flappy) — no balance seeding needed.
//
// Covers:
//   TET-E2E-01: game hub shows a "Petris" card that opens the dialog on its Ready screen (no run consumed until Start)
//   TET-E2E-02: on-screen control buttons (rotate, left, right, soft-drop, hard-drop) are present on the play view
//   TET-E2E-03: happy path — hard-drop repeatedly to top-out, see a "Run over" summary with a banked-ZP line, close, card hint flips to the paid-replay state

import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

const TS = Date.now()

const USER = {
  name: "Blocks Tester",
  email: `blockstester${TS}@example.com`,
  password: "BlocksTest123!",
}

// ---------------------------------------------------------------------------
// Helpers — inline, following the pattern in flappy.spec.ts / auth.spec.ts.
// ---------------------------------------------------------------------------

async function signUp(page: import("@playwright/test").Page) {
  // Closed registration (src/lib/approved-emails.ts) rejects any email not on
  // the allowlist — approve this run's generated test email first, mirroring
  // flappy.spec.ts's POST /api/test/seed-balance pattern (test-only route).
  const res = await page.request.post("/api/test/approve-email", { data: { email: USER.email } })
  expect(res.ok()).toBeTruthy()

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(USER.name)
  await page.getByLabel("Email").fill(USER.email)
  await page.getByLabel("Password").fill(USER.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(USER.email)
  await page.getByLabel("Password").fill(USER.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Setup — create the test user once.
// ---------------------------------------------------------------------------

test.describe("Setup — provision test user", () => {
  test("create test user", async ({ page }) => {
    await signUp(page)
  })
})

// ---------------------------------------------------------------------------
// TET-E2E-01: game hub card opens the dialog with a visible play canvas.
// ---------------------------------------------------------------------------

test.describe("TET-E2E-01: Petris card opens the dialog on its Ready screen", () => {
  test("card opens dialog on the Ready screen without auto-starting", async ({ page }) => {
    await signIn(page)
    await page.goto("/game-hub")
    // Petris lives in the hub's Competitive tab (leaderboard games).
    await page.getByRole("tab", { name: /competitive/i }).click()

    // GameCard renders as <button aria-label="Petris — stack lines, bank ZP">.
    const card = page.getByRole("button", { name: /Petris/i })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()

    // The dialog opens on a Ready screen — the game does NOT auto-start, so
    // opening consumes no run. The Start button gates the play canvas (which is
    // exercised in TET-E2E-02/03). This keeps opening free of run consumption.
    await expect(page.getByRole("button", { name: /start (free run|replay)/i })).toBeVisible({ timeout: 5_000 })
  })
})

// ---------------------------------------------------------------------------
// TET-E2E-02: on-screen control buttons are present on the play view.
// ---------------------------------------------------------------------------

test.describe("TET-E2E-02: on-screen control pad is present", () => {
  test("rotate, left, right, soft-drop, hard-drop buttons are visible", async ({ page }) => {
    await signIn(page)
    await page.goto("/game-hub")
    await page.getByRole("tab", { name: /competitive/i }).click()

    const card = page.getByRole("button", { name: /Petris/i })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()

    // Start the run so the play view (canvas + control pad) mounts.
    await page.getByRole("button", { name: /start (free run|replay)/i }).click()

    // Absolutely-positioned control pad below the canvas (tetris-game.tsx):
    // aria-label="Hold piece" / "Move left" / "Move right" / "Rotate" / "Soft drop" / "Hard drop".
    await expect(page.getByRole("button", { name: /^rotate$/i })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole("button", { name: /move left/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /move right/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /soft drop/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /hard drop/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /hold piece/i })).toBeVisible()

    // Close the dialog to end this run cleanly (the icon-only X is the only
    // "Close" while a run is active — no summary panel yet), rather than leaving
    // an ACTIVE run dangling for the 5-minute server sweep.
    await page.getByRole("button", { name: /^close$/i }).click()
  })
})

// ---------------------------------------------------------------------------
// TET-E2E-03: happy path — play a run to completion, see the summary.
// ---------------------------------------------------------------------------

test.describe("TET-E2E-03: full happy path — start, end, summary, hint updates", () => {
  test("hard-drop repeatedly to top-out, see 'Run over' with banked ZP, close, hint flips to replay", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/game-hub")
    await page.getByRole("tab", { name: /competitive/i }).click()

    const card = page.getByRole("button", { name: /Petris/i })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.click()

    // Start the run (explicit Start button), then the play view mounts.
    await page.getByRole("button", { name: /start (free run|replay)/i }).click()

    const canvas = page.getByLabel(/Petris game canvas/i)
    await expect(canvas).toBeVisible({ timeout: 5_000 })

    // The canvas itself has no click handler (input is keyboard/touch-gesture/
    // on-screen-button only — see tetris-game.tsx). Use the on-screen "Hard
    // drop" button: with no left/right movement every piece locks in the same
    // central column, reliably topping out the stack within a handful of drops
    // regardless of the exact 7-bag sequence.
    const hardDrop = page.getByRole("button", { name: /hard drop/i })
    await expect(hardDrop).toBeVisible({ timeout: 5_000 })

    const runOver = page.getByText("Run over")
    for (let i = 0; i < 40 && !(await runOver.isVisible()); i++) {
      try {
        // Bounded per-click timeout: once the run tops out, the control pad
        // unmounts (the view swaps to the summary panel) mid-loop, which
        // would otherwise hang the default action timeout waiting for a
        // button that's gone for good.
        await hardDrop.click({ timeout: 2_000 })
      } catch {
        break
      }
      await page.waitForTimeout(50)
    }

    // Structural facts, not exact numbers (score/lines/ZP are nondeterministic
    // given the seeded-but-unassert able piece sequence).
    await expect(runOver).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/ZP banked/i)).toBeVisible()

    // The dialog's own icon-only X button also has an accessible name of "Close"
    // (aria-label, no visible text) — scope to the summary panel's text-labeled
    // "Close" button specifically to avoid Playwright's strict-mode ambiguity.
    await page.getByRole("button", { name: /^Close$/i }).filter({ hasText: "Close" }).click()

    // After closing, the free run is spent — the card now offers a priced replay
    // (or "Back tomorrow" if the balance can't cover one).
    await expect(card).toContainText(/replay|back tomorrow/i, { timeout: 5_000 })
  })
})
