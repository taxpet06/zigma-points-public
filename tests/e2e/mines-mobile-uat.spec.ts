// Mines mobile UAT — 12-05-PLAN.md Task 2, the phase gate's eight desk-unprovable checks
// (12-UI-SPEC.md § UAT Gates). Mirrors tests/e2e/plinko-mobile-uat.spec.ts's harness verbatim:
// emulated 360x640 portrait (Chrome DevTools device emulation), local signUp/signIn/setBalance
// helpers, screenshots as evidence. Gate 1 is the decision point — it decides whether Mines
// ships as-is or needs the documented defaultMaximized fallback (12-UI-SPEC § The vertical
// arithmetic at 360x640).

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"

test.use({ viewport: { width: 360, height: 640 } })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Mines UAT",
  email: `minesuat${TS}@example.com`,
  password: "MinesUAT123!",
}

const SHOT_DIR = path.join(process.cwd(), ".planning/phases/12-mines/uat-screenshots")

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

async function openMines(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /casino/i }).click()
  const card = page.getByRole("button", { name: /Mines — find gems/i })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("button", { name: "Row 1, column 1" })).toBeVisible({ timeout: 5_000 })
  // The dialog's own enter transition (fade-in-0 + zoom-in-95, duration-200) is still running
  // the instant the tile becomes visible in the DOM — measuring a bounding box or taking a
  // screenshot mid-transition captures a translucent, still-scaling frame. Settle first.
  await page.waitForTimeout(300)
}

async function setMineCount(page: Page, target: number) {
  const presets = [1, 3, 5, 10, 24]
  if (presets.includes(target)) {
    await page.getByRole("button", { name: target === 1 ? "1 mine" : `${target} mines`, exact: true }).click()
    return
  }
  const valueLoc = page.locator('span[aria-live="off"]')
  const more = page.getByRole("button", { name: "More mines" })
  const fewer = page.getByRole("button", { name: "Fewer mines" })
  for (let guard = 0; guard < 30; guard++) {
    const current = Number.parseInt((await valueLoc.textContent()) ?? "0", 10)
    if (current === target) return
    if (current < target) await more.click()
    else await fewer.click()
  }
}

async function setBet(page: Page, amount: number) {
  const input = page.getByLabel("Bet amount in ZP")
  await input.click()
  await input.fill(String(amount))
  await input.blur()
}

// The 25 face-down tile buttons — revealed/hit tiles carry a modified accessible name (", gem",
// ", mine — you hit this one", ...) so this regex naturally excludes them as the round progresses.
const FACE_DOWN_NAME = /^Row \d, column \d$/
function faceDownTiles(page: Page) {
  return page.getByRole("button", { name: FACE_DOWN_NAME })
}

// The board's own grid — first grid-cols-5 gap-2 container in DOM order (the mine-preset row
// below shares the identical class string by design, 12-UI-SPEC § Rhythm, so scope to .first()).
function boardTiles(page: Page) {
  return page.locator("div.grid.grid-cols-5.gap-2").first().locator("button")
}

/** Clicks the first still-face-down tile and polls THAT SPECIFIC tile (by stable grid position,
 *  never by the CTA's "Cash out" text) until its own aria-label resolves away from the plain
 *  face-down pattern. "Cash out" is the wrong signal to race on: it stays visible for the whole
 *  rest of an ACTIVE round after the first safe reveal, so checking it again on reveal #2 (etc.)
 *  resolves instantly on stale state — before that reveal's own request has even been sent —
 *  and the loop races ahead, hammering a tile that's still mid-flight. */
async function revealNextTile(page: Page): Promise<"safe" | "bust"> {
  const tiles = boardTiles(page)
  const count = await tiles.count()
  let idx = -1
  for (let i = 0; i < count; i++) {
    const label = await tiles.nth(i).getAttribute("aria-label")
    if (label && FACE_DOWN_NAME.test(label)) {
      idx = i
      break
    }
  }
  if (idx === -1) throw new Error("no face-down tile left to reveal")

  const tile = tiles.nth(idx)
  await tile.click()
  await expect
    .poll(async () => (await tile.getAttribute("aria-label")) ?? "", {
      timeout: 8_000,
      message: "this specific tile's reveal never resolved",
    })
    .not.toMatch(FACE_DOWN_NAME)

  const finalLabel = (await tile.getAttribute("aria-label")) ?? ""
  return finalLabel.includes("mine — you hit this one") ? "bust" : "safe"
}

async function readBalance(page: Page): Promise<number> {
  const text = (await page.getByText(/^Balance /).textContent()) ?? ""
  const m = text.match(/Balance ([\d,]+) ZP/)
  if (!m) throw new Error(`could not parse balance: ${text}`)
  return Number.parseInt(m[1].replace(/,/g, ""), 10)
}

/** The readout's "Current {mult}× · {net} ZP" figures, parsed from the aria-live row that
 *  contains the word "Current" (the outcome slot's aria-live region never contains it). */
async function readCurrentFigures(page: Page): Promise<{ mult: string; net: string }> {
  const text = (await page.locator('[aria-live="polite"]').filter({ hasText: "Current" }).first().textContent()) ?? ""
  const m = text.match(/Current ([\d.]+)× · ([+−]\d+) ZP/)
  if (!m) throw new Error(`could not parse readout Current: ${text}`)
  return { mult: m[1], net: m[2] }
}

/** The BetButton sub-label's "{net} ZP · {mult}×" figures — same two numbers as the readout's
 *  Current line, printed in the opposite (outcome-forward) order (12-UI-SPEC Ruling 1). */
async function readSubLabelFigures(page: Page): Promise<{ mult: string; net: string }> {
  const text = (await page.getByRole("button", { name: /Cash out/ }).textContent()) ?? ""
  const m = text.match(/([+−]\d+) ZP · ([\d.]+)×/)
  if (!m) throw new Error(`could not parse sub-label: ${text}`)
  return { net: m[1], mult: m[2] }
}

// The outcome slot — CasinoShell's permanently-mounted h-16 container (casino-shell.tsx). Both
// it AND the readout row carry aria-live="polite", and once a round settles the readout reverts
// to showing "Next {mult}× · {net} ZP" for the next round, whose net figure matches the exact
// same anchored "+N ZP" pattern — h-16 is the one class unique to the outcome slot.
function outcomeSlot(page: Page) {
  return page.locator("div.h-16")
}

/** The outcome slot's net figure — "+74 ZP" / "−50 ZP", anchored so it never matches the
 *  longer sub-label string that also contains " ZP". */
async function readOutcomeNet(page: Page): Promise<number> {
  const text = (await outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/).textContent()) ?? ""
  const m = text.match(/^([+−])([\d,]+) ZP$/)
  if (!m) throw new Error(`could not parse outcome net: ${text}`)
  const magnitude = Number.parseInt(m[2].replace(/,/g, ""), 10)
  return m[1] === "−" ? -magnitude : magnitude
}

async function visibleRowCount(page: Page): Promise<number> {
  let count = 0
  for (let r = 1; r <= 5; r++) {
    const box = await page.getByRole("button", { name: `Row ${r}, column 1` }).boundingBox()
    if (box && box.y >= 0 && box.y + box.height <= 640) count++
  }
  return count
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
// UAT Gate 2: tile geometry at 1, 3 and 24 mines.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 2: tile geometry", () => {
  test("all 25 tiles >=44px at 1, 3 and 24 mines, no horizontal scroll", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)

    const tiles = faceDownTiles(page)
    await expect(tiles).toHaveCount(25)

    for (const n of [1, 3, 24]) {
      await setMineCount(page, n)
      const boxes = await Promise.all(Array.from({ length: 25 }, (_, i) => tiles.nth(i).boundingBox()))
      for (const box of boxes) {
        expect(box).not.toBeNull()
        expect(box!.width).toBeGreaterThanOrEqual(44)
        expect(box!.height).toBeGreaterThanOrEqual(44)
      }
      const widths = boxes.map((b) => b!.width)
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)

      const [scrollW, clientW] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(scrollW).toBe(clientW)

      await page.screenshot({ path: path.join(SHOT_DIR, `02-geometry-${n}mines.png`) })
    }
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 1 (the decision point): initial scroll position.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 1: initial scroll position — the maximize-fallback decision", () => {
  test("readout visible, >=4/5 rows visible at scroll top, sticky CTA position identical top vs bottom", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)

    const dialog = page.getByRole("dialog")
    await dialog.evaluate((el) => {
      el.scrollTop = 0
    })

    await expect(page.getByText(/^3 mines$/)).toBeVisible()

    const visibleRows = await visibleRowCount(page)
    console.log(`GATE1_VISIBLE_ROWS=${visibleRows}`)

    const ctaTop = page.getByRole("button", { name: /^Bet \d+ ZP$/ })
    await expect(ctaTop).toBeVisible()
    const boxTop = await ctaTop.boundingBox()
    expect(boxTop).not.toBeNull()
    expect(boxTop!.y).toBeGreaterThanOrEqual(0)
    expect(boxTop!.y + boxTop!.height).toBeLessThanOrEqual(640)

    await page.screenshot({ path: path.join(SHOT_DIR, "01-scrolltop-360x640.png") })

    await dialog.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const boxBottom = await page.getByRole("button", { name: /^Bet \d+ ZP$/ }).boundingBox()
    expect(boxBottom).not.toBeNull()
    expect(boxBottom!.y).toBe(boxTop!.y) // sticky — never moves

    await page.screenshot({ path: path.join(SHOT_DIR, "01-scrolledbottom-360x640.png") })

    expect(visibleRows).toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 3: BetInput <-> stake-line swap.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 3: BetInput <-> stake-line swap", () => {
  test("bet field present before, stake line only during, CTA disabled at both transitions", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 1) // near-certain safe first reveal (24/25)
    await setBet(page, 25)

    // Scoped to end in "mine(s)" — the outcome slot's own secondary line ("25 ZP staked ·
    // 1.03×") also contains the literal substring "ZP staked ·" but ends in a multiplier, not
    // a mine count, and stays permanently mounted after the round settles.
    const stakeLine = /\d+ ZP staked · \d+ mines?$/

    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(page.getByLabel("Bet amount in ZP")).toBeVisible()
      await expect(page.getByText(stakeLine)).toHaveCount(0)

      await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
      // Immediately after tapping Bet: disabled through Settling… and into Pick a tile (k=0).
      await expect(page.getByRole("button", { name: /Settling…|^Pick a tile$/ })).toBeDisabled({ timeout: 5_000 })
      await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })
      await expect(page.getByLabel("Bet amount in ZP")).toHaveCount(0)
      await expect(page.getByText("25 ZP staked · 1 mine")).toBeVisible()

      const result = await revealNextTile(page)
      if (result === "bust") continue // rare (1/25) — round settled, Bet button is back, retry

      await expect(page.getByRole("button", { name: /^Cash out/ })).toBeVisible()
      await page.getByRole("button", { name: /^Cash out/ }).click()
      // Immediately after tapping Cash out: disabled through Cashing out….
      await expect(page.getByRole("button", { name: "Cashing out…" })).toBeVisible({ timeout: 2_000 })
      await expect(page.getByRole("button", { name: "Cashing out…" })).toBeDisabled()

      await expect(page.getByLabel("Bet amount in ZP")).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText(stakeLine)).toHaveCount(0)
      return
    }
    throw new Error("could not land a safe reveal in 10 attempts")
  })
})

// ---------------------------------------------------------------------------
// Full round (MINE-01/02/03): the readout, the sub-label and the payout must agree.
// ---------------------------------------------------------------------------

test.describe("Full round (MINE-01/02/03)", () => {
  test("3 mines, 25 ZP — three safe reveals, readout == sub-label, cash out pays the shown net", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 3)
    await setBet(page, 25)

    for (let attempt = 0; attempt < 40; attempt++) {
      const balanceBefore = await readBalance(page)

      await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
      const pickTile = page.getByRole("button", { name: "Pick a tile", exact: true })
      await expect(pickTile).toBeVisible({ timeout: 5_000 })
      await expect(pickTile).toBeDisabled()

      let safe = 0
      let busted = false
      while (safe < 3) {
        const result = await revealNextTile(page)
        if (result === "bust") {
          busted = true
          break
        }
        safe++
        const subFig = await readSubLabelFigures(page)
        // The readout's Current figures now TICK to the new multiplier (~180ms rAF tween in
        // mines-controls.tsx) instead of snapping, so a single synchronous read can catch an
        // in-flight frame. The contract being gated is "the two readouts agree", not "they agree
        // on the very first frame" — poll until the tween lands. The sub-label is not tweened,
        // so it is still read once, exactly.
        await expect
          .poll(async () => await readCurrentFigures(page), {
            timeout: 3_000,
            message: `readout never converged on the sub-label after safe reveal #${safe}`,
          })
          .toEqual(subFig)
      }
      if (busted) continue

      const finalSub = await readSubLabelFigures(page)
      const expectedNet = finalSub.net.startsWith("−")
        ? -Number.parseInt(finalSub.net.slice(1), 10)
        : Number.parseInt(finalSub.net.replace("+", ""), 10)

      await page.getByRole("button", { name: /^Cash out/ }).click()
      await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({
        timeout: 5_000,
      })
      const outcomeNet = await readOutcomeNet(page)
      expect(outcomeNet).toBe(expectedNet)

      // invalidateBalance() only *schedules* the refetch (mines.tsx) — the outcome slot renders
      // synchronously in the same callback, so reading balance immediately can race the network
      // round trip and see the stale (mid-round, stake-debited-only) figure. Poll for it.
      await expect.poll(() => readBalance(page), { timeout: 5_000 }).toBe(balanceBefore + outcomeNet)
      return
    }
    throw new Error("could not complete 3 safe reveals within 40 attempts")
  })
})

// ---------------------------------------------------------------------------
// Bust (MINE-04): the end-of-round board distinguishes mines and unpicked gems.
// ---------------------------------------------------------------------------

test.describe("Bust (MINE-04)", () => {
  test("24 mines — the revealed board labels exactly one hit mine, 23 unhit mines, and unpicked gems", async ({
    page,
    request,
  }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 24)
    await setBet(page, 5)

    await page.getByRole("button", { name: /^Bet 5 ZP$/ }).click()
    await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })

    let safeCount = 0
    let result: "safe" | "bust" = "safe"
    for (let i = 0; i < 3 && result !== "bust"; i++) {
      result = await revealNextTile(page)
      if (result === "safe") safeCount++
    }
    expect(result).toBe("bust")

    await expect(page.getByRole("button", { name: /mine — you hit this one/ })).toHaveCount(1)
    await expect(page.getByRole("button", { name: /, mine$/ })).toHaveCount(23)
    await expect(page.getByRole("button", { name: /^Row \d, column \d, gem$/ })).toHaveCount(safeCount)
    await expect(page.getByRole("button", { name: /, gem, not picked$/ })).toHaveCount(1 - safeCount)

    const net = await readOutcomeNet(page)
    expect(net).toBeLessThan(0)

    await page.screenshot({ path: path.join(SHOT_DIR, "bust-24mines.png") })
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 8: resume across a hard refresh.
// ---------------------------------------------------------------------------

test.describe("UAT Gate 8: resume across a hard refresh", () => {
  test("emerald gems, resume line, locked selector and sub-label persist; cash out pays the pre-refresh multiplier", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 1)
    await setBet(page, 25)

    let subBeforeRefresh: { mult: string; net: string } | null = null
    for (let attempt = 0; attempt < 20 && !subBeforeRefresh; attempt++) {
      await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
      await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })
      let safe = 0
      let busted = false
      while (safe < 3) {
        const r = await revealNextTile(page)
        if (r === "bust") {
          busted = true
          break
        }
        safe++
      }
      if (busted) continue
      subBeforeRefresh = await readSubLabelFigures(page)
    }
    if (!subBeforeRefresh) throw new Error("could not reach 3 safe reveals for the resume gate")

    await page.reload()
    await openMines(page)

    await expect(page.getByText(/You had a round open —/)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole("button", { name: /^Row \d, column \d, gem$/ })).toHaveCount(3)

    const cashOutBtn = page.getByRole("button", { name: /^Cash out/ })
    await expect(cashOutBtn).toBeVisible()
    const subAfter = await readSubLabelFigures(page)
    expect(subAfter).toEqual(subBeforeRefresh)

    await expect(page.getByText("Locked until the round ends.")).toBeVisible()

    await page.screenshot({ path: path.join(SHOT_DIR, "gate8-resume.png") })

    const expectedNet = subBeforeRefresh.net.startsWith("−")
      ? -Number.parseInt(subBeforeRefresh.net.slice(1), 10)
      : Number.parseInt(subBeforeRefresh.net.replace("+", ""), 10)

    await cashOutBtn.click()
    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({ timeout: 5_000 })
    const outcomeNet = await readOutcomeNet(page)
    expect(outcomeNet).toBe(expectedNet)
  })
})

// ---------------------------------------------------------------------------
// UAT Gate 7: readout wrap at extreme multipliers (the 11-08 bug class).
// ---------------------------------------------------------------------------

test.describe("UAT Gate 7: readout wrap does not spill into the grid", () => {
  test("a 15-mine round pushed to a large multiplier wraps to two lines without overlapping row 1", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 15)
    await setBet(page, 25)

    const row1 = page.getByRole("button", { name: "Row 1, column 1" })
    let wrapped = false

    for (let attempt = 0; attempt < 120 && !wrapped; attempt++) {
      await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
      await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })

      for (let k = 0; k < 6; k++) {
        const result = await revealNextTile(page)
        if (result === "bust") break

        const readout = page.locator('[aria-live="polite"]').filter({ hasText: "Current" }).first()
        const readoutBox = await readout.boundingBox()
        const row1Box = await row1.boundingBox()
        if (readoutBox && readoutBox.height > 24) {
          // Wrapped to two lines — the gate: it must not overlap the first tile row.
          expect(row1Box).not.toBeNull()
          expect(readoutBox.y + readoutBox.height).toBeLessThanOrEqual(row1Box!.y)
          // Scroll back to the top for the screenshot — several reveal/cash-out cycles in this
          // loop can leave the dialog's internal scroll position drifted, and the evidence is
          // only useful with the wrapped readout actually in frame above the grid.
          await page.getByRole("dialog").evaluate((el) => {
            el.scrollTop = 0
          })
          await page.screenshot({ path: path.join(SHOT_DIR, "07-readout-wrap.png") })
          wrapped = true
          break
        }
      }
      // Whatever state the round is in (busted or still active, wrapped or not — including the
      // wrapped case itself), an ACTIVE round left open leaks into every later test on this
      // shared user (the mine selector locks, the resume line appears) — always settle it.
      const cashOutBtn = page.getByRole("button", { name: /^Cash out/ })
      if (await cashOutBtn.isVisible().catch(() => false)) {
        await cashOutBtn.click()
        await page.getByRole("button", { name: /^Bet \d+ ZP$/ }).waitFor({ state: "visible", timeout: 5_000 })
      }
    }

    expect(wrapped, "never reached a wrapped readout across 120 attempts").toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cap disclosure spot check.
// ---------------------------------------------------------------------------

test.describe("Cap disclosure spot check", () => {
  test("shows at 100 ZP with 3 mines, absent at 5 ZP with 1 mine", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)

    await setMineCount(page, 3)
    await setBet(page, 100)
    await expect(page.getByText(/pay the 10,000 ZP cap\./)).toBeVisible()

    await setMineCount(page, 1)
    await setBet(page, 5)
    await expect(page.getByText(/pay the 10,000 ZP cap\./)).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// UAT Gates 4/5/6: screenshot evidence — loss vs cash-out motion, dark mode, reduced motion.
// ---------------------------------------------------------------------------

test.describe("UAT Gates 4/6: loss reveal, cash-out reveal, dark mode — screenshot evidence", () => {
  test("captures a bust reveal", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 10)
    await setBet(page, 25)

    await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
    await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })
    let result: "safe" | "bust" = "safe"
    for (let i = 0; i < 25 && result !== "bust"; i++) result = await revealNextTile(page)
    expect(result).toBe("bust")
    await page.screenshot({ path: path.join(SHOT_DIR, "gate4-loss-reveal.png") })
  })

  test("captures a cash-out reveal", async ({ page, request }) => {
    test.setTimeout(60_000)
    await setBalance(request, 500)
    await signIn(page)
    await openMines(page)
    await setMineCount(page, 1)
    await setBet(page, 25)

    for (let attempt = 0; attempt < 15; attempt++) {
      await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
      await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })
      const r = await revealNextTile(page)
      if (r === "bust") continue
      await page.getByRole("button", { name: /^Cash out/ }).click()
      await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({
        timeout: 5_000,
      })
      await page.screenshot({ path: path.join(SHOT_DIR, "gate4-cashout-reveal.png") })
      return
    }
    throw new Error("could not land a cash-out for the gate 4 screenshot")
  })

  test("dark mode tile fill legibility", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ colorScheme: "dark" })
    await openMines(page)
    await setMineCount(page, 5)
    await page.screenshot({ path: path.join(SHOT_DIR, "gate6-darkmode.png") })
  })
})

test.describe("UAT Gate 5: prefers-reduced-motion", () => {
  test("complete board and outcome present with no animation wait", async ({ page, request }) => {
    await setBalance(request, 500)
    await signIn(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openMines(page)
    await setMineCount(page, 10)
    await setBet(page, 25)

    await page.getByRole("button", { name: /^Bet 25 ZP$/ }).click()
    await expect(page.getByRole("button", { name: "Pick a tile", exact: true })).toBeVisible({ timeout: 5_000 })
    const start = Date.now()
    let result: "safe" | "bust" = "safe"
    for (let i = 0; i < 25 && result !== "bust"; i++) result = await revealNextTile(page)
    expect(result).toBe("bust")
    await expect(outcomeSlot(page).getByText(/^[+−][\d,]+ ZP$/)).toBeVisible({
      timeout: 500,
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(3_000) // generous; dominated by network round trips, no fade wait
    await page.screenshot({ path: path.join(SHOT_DIR, "gate5-reduced-motion.png") })
  })
})
