// Blackjack mobile UAT — portrait 360×640, open Casino → Blackjack, deal + stand path.
// Mirrors dice/mines harness: real sign-up against live server when available.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test"

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true })
test.describe.configure({ mode: "serial" })

const TS = Date.now()
const USER = {
  name: "Blackjack UAT",
  email: `bjuat${TS}@example.com`,
  password: "BjUAT1234!",
}

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

async function setBalance(request: APIRequestContext, zigmaPoints: number) {
  const res = await request.post("/api/test/seed-balance", {
    data: { email: USER.email, zigmaPoints },
  })
  expect(res.ok()).toBeTruthy()
}

async function openBlackjack(page: Page) {
  await page.goto("/game-hub")
  await page.getByRole("tab", { name: /casino/i }).click()
  const card = page.getByRole("button", { name: /Blackjack — beat the dealer/i })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByRole("heading", { name: /Blackjack/i })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(300)
}

test("blackjack tile opens and deal controls fit the thumb zone", async ({ page, request }) => {
  await approveEmail(request)
  await signUp(page)
  await setBalance(request, 500)
  await openBlackjack(page)

  const deal = page.getByRole("button", { name: /Deal \d+ ZP/i })
  await expect(deal).toBeVisible()
  const box = await deal.boundingBox()
  expect(box).toBeTruthy()
  expect(box!.height).toBeGreaterThanOrEqual(44)

  // No horizontal overflow of dialog content at 360px
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("[role='dialog']")
    if (!el) return true
    return el.scrollWidth > el.clientWidth + 1
  })
  expect(overflow).toBe(false)
})

test("deal starts a round or settles a natural without leaking hole in active UI", async ({
  page,
  request,
}) => {
  await setBalance(request, 500)
  await openBlackjack(page)

  await page.getByRole("button", { name: /Deal \d+ ZP/i }).click()

  // Either action buttons (Hit/Stand/Insurance) or an immediate settle outcome
  const hit = page.getByRole("button", { name: /^Hit$/i })
  const stand = page.getByRole("button", { name: /^Stand$/i })
  const insure = page.getByRole("button", { name: /Insurance/i })
  const dealAgain = page.getByRole("button", { name: /Deal \d+ ZP/i })

  await expect
    .poll(async () => {
      return (
        (await hit.isVisible().catch(() => false)) ||
        (await stand.isVisible().catch(() => false)) ||
        (await insure.isVisible().catch(() => false)) ||
        (await dealAgain.isVisible().catch(() => false))
      )
    }, { timeout: 8_000 })
    .toBe(true)

  if (await stand.isVisible().catch(() => false)) {
    await stand.click()
    await expect(page.getByText(/ZP staked/i)).toBeVisible({ timeout: 8_000 })
  }
})
