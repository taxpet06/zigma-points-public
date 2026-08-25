// MineZweeper E2E — the two things that can't be proven at the desk: that a real
// play-through produces no runtime errors, and that clearing the board actually moves the
// balance by MINEZWEEPER_ZP.
//
// Harness mirrors tests/e2e/mines-mobile-uat.spec.ts verbatim (360x640 portrait, local
// signUp/signIn against the live dev server + real Postgres). The board is computed here
// with the SAME board.ts the app imports — that's the point of board.ts being shared, and
// it's what lets the test solve a 40-mine board deterministically instead of guessing.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import { boardForDay, CELLS } from "@/components/game-hub/minezweeper/board"
import { dayKey } from "@/lib/day-key"
import { MINEZWEEPER_ZP } from "@/lib/game-economy"

test.use({ viewport: { width: 360, height: 640 } })

/** The tap that opens the board. Mid-board, so its 3x3 is fully in-bounds. */
const FIRST = 136

/** One play a day is the whole point, so every test needs a user that hasn't played —
 *  sharing one account would lock every test after the first out of its own board. */
function freshUser(tag: string) {
  return {
    name: `MZ ${tag}`,
    email: `mzuat-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    password: "MzUAT123!",
  }
}

type User = ReturnType<typeof freshUser>

async function signUp(page: Page, request: APIRequestContext, user: User, zp: number) {
  // Registration is closed — the email has to be on the allowlist BEFORE the form is
  // submitted, or signUp 403s NOT_APPROVED. (The older game UAT specs approve after
  // signing up, which no longer works.)
  const approved = await request.post("/api/test/approve-email", { data: { email: user.email } })
  expect(approved.ok()).toBeTruthy()

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(user.name)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 15_000 })

  const seeded = await request.post("/api/test/seed-balance", {
    data: { email: user.email, zigmaPoints: zp },
  })
  expect(seeded.ok()).toBeTruthy()
  await page.reload()
}

/** Pre-existing, app-wide and NOT this game's: next-auth's SessionProvider polls
 *  /api/auth/session, and the sign-up flow's Gmail SMTP call fails slowly in dev, which
 *  strands that fetch. Reproduced identically by opening Wordle through this same harness,
 *  so filtering it here keeps the assertion meaningful instead of permanently red. */
const KNOWN_UNRELATED = [/ClientFetchError: Failed to fetch/]

/** Every console error, uncaught exception and failed request for the whole test. */
function collectErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() !== "error") return
    if (KNOWN_UNRELATED.some((re) => re.test(m.text()))) return
    errors.push(`console.error: ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  page.on("requestfailed", (r) => {
    // Chromium reports aborted navigations/prefetches as failures; only care about the app's own calls.
    const f = r.failure()?.errorText ?? ""
    if (!f.includes("ERR_ABORTED")) errors.push(`requestfailed: ${r.url()} — ${f}`)
  })
  return errors
}

async function openGame(page: Page) {
  await page.goto("/game-hub")
  const card = page.getByRole("button", { name: /MineZweeper/i })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.click()
  await expect(page.getByRole("button", { name: "Row 1, column 1, hidden" })).toBeVisible({
    timeout: 10_000,
  })
}

const cellBtn = (page: Page, i: number) => page.locator(`[data-cell="${i}"]`)

/** The header's ZP readout — nav/header.tsx renders user.getMe's zigmaPoints, which
 *  claim() invalidates, so this reflects the server rather than local state. */
async function readBalance(page: Page): Promise<number> {
  const text = (await page.getByText(/^\d[\d,]* ZP$/).first().textContent()) ?? ""
  const m = text.match(/([\d,]+) ZP/)
  if (!m) throw new Error(`could not parse balance: ${text}`)
  return Number.parseInt(m[1].replace(/,/g, ""), 10)
}

test.describe("MineZweeper", () => {
  test("clears the board, pays MINEZWEEPER_ZP, and logs no errors", async ({ page, request }) => {
    const errors = collectErrors(page)

    await signUp(page, request, freshUser("win"), 100)
    await openGame(page)

    // The long-press instruction must be on screen without scrolling or hovering —
    // it's the only way anyone discovers flagging.
    await expect(page.getByText("Hold to flag")).toBeVisible()
    await expect(page.getByText("Tap to reveal")).toBeVisible()

    // ---- first tap is safe and opens a cascade -----------------------------
    await cellBtn(page, FIRST).click()
    await expect(cellBtn(page, FIRST)).toHaveAttribute("aria-label", /empty/, { timeout: 5_000 })

    const revealedAfterFirst = await page.locator("[data-cell]").evaluateAll(
      (els) => els.filter((e) => !/hidden|flagged/.test(e.getAttribute("aria-label") ?? "")).length,
    )
    expect(revealedAfterFirst, "first tap opens a zero-cascade, not a lone cell").toBeGreaterThan(1)

    // ---- solve it ----------------------------------------------------------
    // Same board.ts the app just used, so this is the real solution, not a guess.
    const { mines } = boardForDay(dayKey(), FIRST)
    const safe = [...Array(CELLS).keys()].filter((i) => !mines.has(i))

    for (const i of safe) {
      const hidden = await cellBtn(page, i).evaluate((el) =>
        /hidden/.test(el.getAttribute("aria-label") ?? ""),
      )
      if (hidden) await cellBtn(page, i).click()
    }

    // ---- the payout --------------------------------------------------------
    await expect(page.getByText(`Cleared it — +${MINEZWEEPER_ZP} ZP`)).toBeVisible({
      timeout: 15_000,
    })

    // No mine may have been revealed by a solve.
    const minesShown = await page.locator("[data-cell]").evaluateAll(
      (els) => els.filter((e) => /, mine$/.test(e.getAttribute("aria-label") ?? "")).length,
    )
    expect(minesShown, "a clean solve reveals no mines").toBe(0)

    // Balance actually moved. The header reads user.getMe, which claim() invalidates —
    // so this is the server's number, not an optimistic local one.
    await expect
      .poll(() => readBalance(page), { timeout: 15_000 })
      .toBe(100 + MINEZWEEPER_ZP)

    // ---- once a day --------------------------------------------------------
    await page.reload()
    const card = page.getByRole("button", { name: /MineZweeper/i })
    await expect(card).toContainText(/Cleared it/i, { timeout: 15_000 })

    expect(errors, `runtime errors during play:\n${errors.join("\n")}`).toEqual([])
  })

  test("long-press flags, and a flag blocks the reveal", async ({ page, request }) => {
    const errors = collectErrors(page)
    await signUp(page, request, freshUser("flag"), 100)
    await openGame(page)

    const target = cellBtn(page, 5)
    const box = await target.boundingBox()
    expect(box).not.toBeNull()

    // Press and hold past LONG_PRESS_MS (450ms) without moving.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(520)
    // What a real touch long-press does and a synthetic mouse one doesn't: the browser
    // fires contextmenu mid-press, just after our timer flagged. Untreated, that second
    // toggle unflags — the mobile bug where the counter moves but no flag lands.
    await target.dispatchEvent("contextmenu")
    await page.waitForTimeout(180)
    await page.mouse.up()

    await expect(target).toHaveAttribute("aria-label", /flagged/, { timeout: 5_000 })
    await expect(page.getByLabel(/mines left to flag/)).toContainText("39")

    // The trailing synthetic click must not reveal the cell we just flagged.
    await page.waitForTimeout(500)
    await expect(target).toHaveAttribute("aria-label", /flagged/)

    // A short tap on a flagged cell does nothing.
    await target.click()
    await expect(target).toHaveAttribute("aria-label", /flagged/)

    expect(errors, `runtime errors during flagging:\n${errors.join("\n")}`).toEqual([])
  })

  test("a finished board the server has no record of is handed back", async ({ page, request }) => {
    const errors = collectErrors(page)
    await signUp(page, request, freshUser("restore"), 100)

    // A lost board left in storage with no matching result row — what an offline claim, or
    // an admin handing the day back, leaves behind. This account has never played.
    await page.goto("/game-hub")
    await page.evaluate(
      ([key, day]) =>
        localStorage.setItem(
          key,
          JSON.stringify({ day, first: 136, revealed: [136], flags: [], status: "lost" }),
        ),
      ["zigma-minezweeper", dayKey()],
    )
    await page.reload()

    const card = page.getByRole("button", { name: /MineZweeper/i })
    await expect(card).toContainText(/New board ready/i, { timeout: 15_000 })

    // And it's genuinely playable, not just relabelled.
    await openGame(page)
    await cellBtn(page, FIRST).click()
    await expect(cellBtn(page, FIRST)).not.toHaveAttribute("aria-label", /hidden/)

    expect(errors, `runtime errors during hand-back:\n${errors.join("\n")}`).toEqual([])
  })

  test("a drag pans the board instead of revealing a cell", async ({ page, request }) => {
    const errors = collectErrors(page)
    await signUp(page, request, freshUser("pan"), 100)
    await openGame(page)

    const target = cellBtn(page, 40)
    const box = await target.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    // Well past TAP_SLOP (8px), in steps so pointermove actually fires.
    await page.mouse.move(box!.x + 60, box!.y + 40, { steps: 8 })
    await page.mouse.up()

    await expect(target).toHaveAttribute("aria-label", /hidden/)
    expect(errors, `runtime errors during pan:\n${errors.join("\n")}`).toEqual([])
  })

  test("renders correctly with prefers-reduced-motion", async ({ page, request }) => {
    const errors = collectErrors(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await signUp(page, request, freshUser("rm"), 100)
    await openGame(page)

    await cellBtn(page, FIRST).click()
    await expect(cellBtn(page, FIRST)).toHaveAttribute("aria-label", /empty/, { timeout: 5_000 })

    // The reduced-motion collapse must not leave revealed cells invisible — that's the
    // one way the mz-* animation work can silently break the board.
    await page.waitForTimeout(300)
    const invisible = await page.locator("[data-cell]").evaluateAll((els) =>
      els
        .filter((e) => !/hidden|flagged/.test(e.getAttribute("aria-label") ?? ""))
        .filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length,
    )
    expect(invisible, "revealed cells must be fully opaque under reduced motion").toBe(0)

    expect(errors, `runtime errors under reduced motion:\n${errors.join("\n")}`).toEqual([])
  })
})
