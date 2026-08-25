// Marketplace mobile UAT — 20-10-PLAN.md Task 1, the Phase 20 gate. Mirrors
// tests/e2e/lootbox-mobile-uat.spec.ts's harness verbatim (viewport, serial mode,
// signUp/signIn/setBalance against the live dev server + real Postgres), generalized
// to two accounts (a seller and a buyer) since this phase is the first to need a real
// cross-account sale.
//
// Assertions this file owns: V-16 (?tab=transfer / ?tab=exchange alias), V-17 (five
// Exchange triggers un-clipped/un-wrapped at 360px + /shop's two subtabs), V-18 (the
// lootbox strip's per-item circulation line), and V-19 (a real cross-account sale that
// leaves the slug's circulation figure unmoved). V-01 through V-15 are unit-level and
// already owned by tests/unit/listing-router.test.ts, tests/unit/transfer-router.test.ts,
// tests/unit/listing-schema.test.ts and tests/unit/marketplace-notify.test.ts — do not
// duplicate that coverage here.
//
// Gate D additionally proves the MKT-04 circulation invariant end-to-end (the one path no
// unit test can reach): mint a real copy, list it, have a SECOND real account buy it, and
// assert the slug's circulation figure is byte-identical before and after, on both the
// buyer's profile and the lootbox strip.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import path from "node:path"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

type UatUser = { name: string; email: string; password: string }

const TS = Date.now()
const SELLER: UatUser = {
  name: `Mkt UAT Seller ${TS}`,
  email: `mktuatseller${TS}@example.com`,
  password: "MktUatSeller123!",
}
const BUYER: UatUser = {
  name: `Mkt UAT Buyer ${TS}`,
  email: `mktuatbuyer${TS}@example.com`,
  password: "MktUatBuyer123!",
}

const SHOT_DIR = path.join(
  process.cwd(),
  ".planning/phases/20-marketplace-trading-exchange/uat-screenshots",
)

// Carried from Gate D to Gate E — the real minted copy both gates operate on. Module
// scope on purpose (same precedent as lootbox-mobile-uat.spec.ts's `commonArmingMs`):
// each gate is its own `test()`, but they share the one real database row.
let itemName = ""
let mintNumber = ""
let circulationBefore = ""
let listingPrice = 0
let sellerProfileUrl = ""

async function approveEmail(request: APIRequestContext, email: string) {
  const res = await request.post("/api/test/approve-email", { data: { email } })
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

async function setBalance(request: APIRequestContext, email: string, zigmaPoints: number) {
  const res = await request.post("/api/test/seed-balance", { data: { email, zigmaPoints } })
  expect(res.ok()).toBeTruthy()
}

// Opens the modal in its browsing state against the FIRST LootboxCard (Backgrounds,
// 26x-background) — same convention as lootbox-mobile-uat.spec.ts's own helper, with
// the button label updated to "View" (20-01-SUMMARY.md's shop card CTA rename).
async function openLootboxModal(page: Page) {
  await page.goto("/shop")
  await page.getByRole("button", { name: "View" }).first().click()
  await expect(page.locator('[aria-label="Items in this box"]')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(300)
}

// Equip/unequip toggles the caller's server row, then invalidates + router.refresh()es —
// under the live (non-local) Postgres this app runs against, a single client-cache read
// right after the mutation resolves isn't always a reliable proxy for "the write is now
// visible to the NEXT navigation" (observed as an intermittent stale read gating the
// collectible picker's equipped-block a few steps later). Reloading and re-checking a
// few times is the honest fix: it polls the real server state instead of trusting one
// optimistic-feeling client read.
async function waitForEquipButton(page: Page, label: "Equip" | "Unequip", attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const visible = await page
      .getByRole("button", { name: label })
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
    if (visible) return
    await page.reload()
  }
  await expect(page.getByRole("button", { name: label })).toBeVisible({ timeout: 5_000 })
}

// Clicks the current equip/unequip button, gives the mutation a moment to land over the
// network (a reload issued too early can abort the in-flight request), then forces a
// hard reload and polls until the NEW label is visible — never trusts the SPA's own
// post-mutation re-render as proof the write actually committed.
async function toggleEquipAndConfirm(page: Page, fromLabel: "Equip" | "Unequip") {
  const toLabel = fromLabel === "Equip" ? "Unequip" : "Equip"
  await page.getByRole("button", { name: fromLabel }).click()
  await page.waitForTimeout(800)
  await page.reload()
  await waitForEquipButton(page, toLabel)
}

// ---------------------------------------------------------------------------
// Setup — two timestamp-unique accounts, a seller and a buyer.
// ---------------------------------------------------------------------------

test.describe("Setup", () => {
  test("create seller test account", async ({ page, request }) => {
    await approveEmail(request, SELLER.email)
    await signUp(page, SELLER)
  })

  test("create buyer test account", async ({ page, request }) => {
    await approveEmail(request, BUYER.email)
    await signUp(page, BUYER)
  })
})

// ---------------------------------------------------------------------------
// Gate A: five-trigger Exchange control survives 360px + /shop shows both subtabs
// (V-17, XCHG-01, SHOP-06 — UI-SPEC §2.2 / §10 point 1).
// ---------------------------------------------------------------------------

test.describe("Gate A: five-trigger Exchange control + /shop subtabs at 360px", () => {
  test("all five Exchange triggers render un-clipped and un-wrapped; /shop shows Lootboxes and Listings", async ({
    page,
    request,
  }) => {
    await setBalance(request, SELLER.email, 500)
    await signIn(page, SELLER)
    await page.goto("/?tab=exchange")

    const tabsList = page.getByRole("tablist")
    await expect(tabsList).toBeVisible()
    const listBox = await tabsList.boundingBox()
    expect(listBox).not.toBeNull()

    const labels = ["Request", "Send", "Trade", "Pending", "Loans"]
    const ys: number[] = []
    for (const label of labels) {
      const trigger = page.getByRole("tab", { name: label })
      await expect(trigger).toBeVisible()
      const box = await trigger.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(0)
      // Un-clipped: the trigger's right edge never runs past the TabsList's own track.
      expect(box!.x + box!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width + 1)
      ys.push(Math.round(box!.y))
    }
    // Un-wrapped: every trigger sits on the same row.
    expect(new Set(ys).size).toBe(1)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateA-exchange-five-triggers.png") })

    await page.goto("/shop")
    await expect(page.getByRole("tab", { name: "Lootboxes" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Listings" })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Gate B: the legacy ?tab=transfer alias resolves to Exchange, never the feed (V-16).
// ---------------------------------------------------------------------------

test.describe("Gate B: legacy ?tab=transfer alias resolves to Exchange, not the feed", () => {
  test("?tab=transfer and ?tab=exchange both land on the Exchange pane", async ({ page, request }) => {
    await setBalance(request, SELLER.email, 500)
    await signIn(page, SELLER)

    await page.goto("/?tab=transfer")
    await expect(page.getByRole("tab", { name: "Request" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Exchange" })).toHaveAttribute("data-state", "active")
    await expect(page.getByRole("link", { name: "Posts" })).toHaveAttribute("data-state", "inactive")

    await page.goto("/?tab=exchange")
    await expect(page.getByRole("tab", { name: "Request" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Exchange" })).toHaveAttribute("data-state", "active")
    await expect(page.getByRole("link", { name: "Posts" })).toHaveAttribute("data-state", "inactive")
  })
})

// ---------------------------------------------------------------------------
// Gate C: the lootbox contents strip scrolls, shows each item once, and every item
// carries a circulation count (SHOP-07, V-18).
// ---------------------------------------------------------------------------

test.describe("Gate C: lootbox contents strip scrolls, no duplicates, per-item circulation", () => {
  test("the strip scrolls horizontally, has no duplicate items, and every item shows a circulation count", async ({
    page,
    request,
  }) => {
    await setBalance(request, SELLER.email, 500)
    await signIn(page, SELLER)
    await openLootboxModal(page)

    const strip = page.locator('[aria-label="Items in this box"]')
    const [scrollWidth, clientWidth] = await strip.evaluate((el) => [el.scrollWidth, el.clientWidth])
    expect(scrollWidth).toBeGreaterThan(clientWidth)

    const itemDivs = strip.locator("> div")
    const count = await itemDivs.count()
    expect(count).toBeGreaterThan(1)

    const names = new Set<string>()
    for (let i = 0; i < count; i++) {
      const item = itemDivs.nth(i)
      await expect(item).toContainText(/\d+ in circulation/)
      const name = (await item.locator("span").first().textContent())?.trim() ?? ""
      names.add(name)
    }
    // No duplicate render pass — the deleted `[...items, ...items]` clone would double this.
    expect(names.size).toBe(count)

    const before = await strip.evaluate((el) => el.scrollLeft)
    await strip.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    const after = await strip.evaluate((el) => el.scrollLeft)
    expect(after).toBeGreaterThan(before)

    await page.screenshot({ path: path.join(SHOT_DIR, "gateC-lootbox-strip.png") })
  })
})

// ---------------------------------------------------------------------------
// Gate D: list -> a second real account buys; the copy lands in their inventory,
// is equippable by them, and the slug's circulation figure never moves (V-19, MKT-04).
// ---------------------------------------------------------------------------

test.describe("Gate D: cross-account sale — circulation is unchanged", () => {
  test("a copy listed by the seller is bought by the buyer, lands in their inventory, is equippable, and circulation is identical before/after", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(60_000)
    await setBalance(request, SELLER.email, 500)
    await setBalance(request, BUYER.email, 500)
    await signIn(page, SELLER)

    // Mint a real copy to sell. A fresh signup owns nothing yet, so this first spend
    // is guaranteed isNew: true (same guarantee lootbox-mobile-uat.spec.ts relies on).
    await openLootboxModal(page)
    await page
      .locator(".lootbox-stage")
      .getByRole("button", { name: /^Open for \d+ ZP$/ })
      .click()
    await expect(page.locator('.lootbox-stage[data-phase="settled"]')).toBeVisible({ timeout: 5_000 })

    itemName = (await page.locator(".lootbox-stage p.text-base.font-semibold").textContent())?.trim() ?? ""
    expect(itemName).toBeTruthy()
    const serialText =
      (await page.locator(".lootbox-stage").getByText(/^#\d+ \/ \d+ in circulation$/).textContent())?.trim() ?? ""
    const serialMatch = serialText.match(/^#(\d+) \/ (\d+) in circulation$/)
    expect(serialMatch).not.toBeNull()
    mintNumber = serialMatch![1]
    circulationBefore = serialMatch![2]

    // Prove the fresh mint is equippable, then unequip immediately — an equipped slug
    // can't be listed (V-10), and Gate E needs this same copy free to trade.
    await page.locator(".lootbox-stage").getByRole("button", { name: "Equip" }).click()
    await expect(page.locator(".lootbox-stage").getByRole("button", { name: "Equipped" })).toBeVisible()
    await page.locator(".lootbox-stage").getByRole("button", { name: "Close" }).click()

    await page.goto("/?tab=people")
    await page.getByRole("link", { name: SELLER.name }).click()
    await expect(page.getByRole("heading", { name: SELLER.name })).toBeVisible()
    sellerProfileUrl = page.url()
    await toggleEquipAndConfirm(page, "Unequip")

    // List it.
    await page.goto("/shop")
    await page.getByRole("tab", { name: "Listings" }).click()
    await page.getByRole("button", { name: "Sell an item" }).click()
    await page.getByRole("button", { name: itemName }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText(new RegExp(`#${mintNumber} / ${circulationBefore}`))).toBeVisible()

    listingPrice = 137 + (TS % 300)
    await page.locator("#listing-price").fill(String(listingPrice))
    await page.getByRole("button", { name: "List it" }).click()
    await expect(page.getByText("Listed.")).toBeVisible()

    // Your listings: Take down, never a Buy button — scoped to that section only, since
    // the live database may carry unrelated listings from other users/runs.
    const yourListings = page
      .getByRole("heading", { name: "Your listings" })
      .locator("xpath=following-sibling::*[1]")
    await expect(yourListings.getByRole("button", { name: "Take down" })).toBeVisible()
    await expect(yourListings.getByRole("button", { name: /^Buy/ })).toHaveCount(0)

    // Listed pill on the seller's own profile.
    await page.goto(sellerProfileUrl)
    await expect(page.getByText("Listed", { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(SHOT_DIR, "gateD-seller-listed.png") })

    // A second, independently signed-in account buys it.
    const buyerContext = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true })
    const buyerPage = await buyerContext.newPage()
    await signIn(buyerPage, BUYER)

    await buyerPage.goto("/shop")
    await buyerPage.getByRole("tab", { name: "Listings" }).click()
    const allListings = buyerPage
      .getByRole("heading", { name: "All listings" })
      .locator("xpath=following-sibling::*[1]")
    const listingCard = allListings
      .locator("div")
      .filter({ hasText: SELLER.name })
      .filter({ hasText: `${listingPrice} ZP` })
      .first()
    await listingCard.getByRole("button", { name: /^Buy/ }).click()
    await expect(buyerPage.getByText("Bought.")).toBeVisible()

    // Buyer's inventory: same #mint serial, equippable by them.
    await buyerPage.goto("/?tab=people")
    await buyerPage.getByRole("link", { name: BUYER.name }).click()
    await expect(buyerPage.getByRole("heading", { name: BUYER.name })).toBeVisible()
    const profileSerial = buyerPage.getByText(new RegExp(`^#${mintNumber} / \\d+$`)).first()
    await expect(profileSerial).toBeVisible()
    const profileSerialText = (await profileSerial.textContent())?.trim() ?? ""
    const profileMatch = profileSerialText.match(/^#(\d+) \/ (\d+)$/)
    expect(profileMatch).not.toBeNull()
    // Explicit equality: the circulation figure recorded at mint time, read again on the
    // buyer's profile after the sale — MKT-04's whole point.
    expect(profileMatch![2]).toBe(circulationBefore)

    await toggleEquipAndConfirm(buyerPage, "Equip")
    await buyerPage.screenshot({ path: path.join(SHOT_DIR, "gateD-buyer-inventory.png") })
    // Unequip again so Gate E can trade this same copy back.
    await toggleEquipAndConfirm(buyerPage, "Unequip")

    // Circulation is unchanged on the lootbox strip too — a catalog-wide figure, not a
    // per-owner one.
    await openLootboxModal(buyerPage)
    const stripAfter = buyerPage.locator('[aria-label="Items in this box"]')
    const afterItemDivs = stripAfter.locator("> div")
    const afterCount = await afterItemDivs.count()
    let circAfter: string | null = null
    for (let i = 0; i < afterCount; i++) {
      const div = afterItemDivs.nth(i)
      const name = (await div.locator("span").first().textContent())?.trim()
      if (name === itemName) {
        const circText = (await div.getByText(/in circulation$/).textContent())?.trim() ?? ""
        circAfter = circText.match(/^(\d+) in circulation$/)?.[1] ?? null
        break
      }
    }
    expect(circAfter).toBe(circulationBefore)

    await buyerContext.close()
  })
})

// ---------------------------------------------------------------------------
// Gate E: two-way Pending inbox — trade offer, both-sides visibility, and cancel
// releasing the copy with no pill (XCHG-02, XCHG-03, TRDE-01).
// ---------------------------------------------------------------------------

test.describe("Gate E: trade offer, two-way Pending visibility, and cancel", () => {
  test("the buyer offers the copy back to the seller; both sides see the deal; cancelling returns the copy with no pill", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000)
    await signIn(page, BUYER)

    // Compose the offer: the copy bought in Gate D, offered back to the seller.
    await page.goto("/?tab=exchange")
    await page.getByRole("tab", { name: "Trade" }).click()
    await page.getByRole("button", { name: "Choose a collectible" }).click()
    await page.getByRole("button", { name: itemName }).click()
    await page.getByRole("button", { name: "OK" }).click()

    await page.getByPlaceholder("Search users…").fill(SELLER.name)
    await page.getByRole("option", { name: new RegExp(SELLER.name) }).click()

    const tradePrice = 8
    await page.locator("#trade-price").fill(String(tradePrice))
    await page.getByRole("button", { name: "Send offer" }).click()
    await expect(page.getByText("Offer sent.")).toBeVisible()

    // Buyer's own Pending: "Waiting on them" + Cancel, item thumbnail + serial.
    await page.getByRole("tab", { name: "Pending" }).click()
    await expect(page.getByRole("heading", { name: "Waiting on them" })).toBeVisible()
    const buyerRow = page
      .locator("div")
      .filter({ hasText: itemName })
      .filter({ has: page.getByRole("button", { name: "Cancel" }) })
      .first()
    await expect(buyerRow).toContainText(`#${mintNumber} / ${circulationBefore}`)
    const buyerThumb = buyerRow.locator("> div").last()
    const buyerThumbBox = await buyerThumb.boundingBox()
    expect(buyerThumbBox).not.toBeNull()
    expect(buyerThumbBox!.width).toBeGreaterThan(0)

    // Seller's side, an independently signed-in second account: "Waiting on you" +
    // Approve/Reject, same thumbnail + serial.
    const sellerContext = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true })
    const sellerPage = await sellerContext.newPage()
    await signIn(sellerPage, SELLER)
    await sellerPage.goto("/?tab=exchange")
    await sellerPage.getByRole("tab", { name: "Pending" }).click()
    await expect(sellerPage.getByRole("heading", { name: "Waiting on you" })).toBeVisible()
    const sellerRow = sellerPage
      .locator("div")
      .filter({ hasText: itemName })
      .filter({ has: sellerPage.getByRole("button", { name: "Approve" }) })
      .first()
    await expect(sellerRow).toContainText(`#${mintNumber} / ${circulationBefore}`)
    await expect(sellerRow.getByRole("button", { name: "Approve" })).toBeVisible()
    await expect(sellerRow.getByRole("button", { name: "Reject" })).toBeVisible()
    const sellerThumb = sellerRow.locator("> div").last()
    const sellerThumbBox = await sellerThumb.boundingBox()
    expect(sellerThumbBox).not.toBeNull()
    expect(sellerThumbBox!.width).toBeGreaterThan(0)
    await sellerContext.close()

    // Cancel from the buyer's side: the row disappears and the copy returns with no pill.
    await buyerRow.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByText("Cancelled.")).toBeVisible()
    await expect(buyerRow).toHaveCount(0)

    await page.goto("/?tab=people")
    await page.getByRole("link", { name: BUYER.name }).click()
    await expect(page.getByRole("heading", { name: BUYER.name })).toBeVisible()
    await expect(page.getByText("Offered", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Listed", { exact: true })).toHaveCount(0)
    await waitForEquipButton(page, "Equip")
  })
})
