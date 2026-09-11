// VOTE-04: outcome display E2E — seeds concluded posts via test API, not via external scheduler

import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

const OUTCOME_AUTHOR = {
  name: "Outcome Author",
  email: `outcomeauthor-${Date.now()}@example.com`,
  password: "OutcomeAuthor123!",
  username: `outcomeauth${Date.now()}`.slice(0, 20),
}

const OUTCOME_TARGET = {
  name: "Outcome Target",
  email: `outcometarget-${Date.now()}@example.com`,
  password: "OutcomeTarget123!",
  username: `outcometgt${Date.now()}`.slice(0, 20),
}

const AWARDED_TITLE = `Awarded post ${Date.now()}`
const REJECTED_TITLE = `Rejected post ${Date.now()}`
let awardedPostId: string
let rejectedPostId: string

async function signUp(page: import("@playwright/test").Page, user: typeof OUTCOME_AUTHOR) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(user.name)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10000 })
}

async function signIn(page: import("@playwright/test").Page, user: typeof OUTCOME_AUTHOR) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10000 })
}

async function setUsername(page: import("@playwright/test").Page, username: string) {
  await page.goto("/profile/edit")
  const field = page.getByLabel(/username/i)
  await field.clear()
  await field.fill(username)
  await page.getByRole("button", { name: /save/i }).click()
  await page.waitForTimeout(500)
}

async function getPostCard(page: import("@playwright/test").Page, title: string) {
  return page.locator("div.rounded-lg.border").filter({ hasText: title }).first()
}

test.describe("Setup — provision users and concluded posts", () => {
  test("create outcome author with username", async ({ page }) => {
    await signUp(page, OUTCOME_AUTHOR)
    await setUsername(page, OUTCOME_AUTHOR.username)
  })

  test("create outcome target with username", async ({ page }) => {
    await signUp(page, OUTCOME_TARGET)
    await setUsername(page, OUTCOME_TARGET.username)
  })

  test("seed an Awarded post and a Rejected post via test API", async ({ request }) => {
    const awardedRes = await request.post("/api/test/seed-post", {
      data: {
        outcome: "Awarded",
        authorEmail: OUTCOME_AUTHOR.email,
        targetEmail: OUTCOME_TARGET.email,
        title: AWARDED_TITLE,
      },
    })
    expect(awardedRes.ok()).toBeTruthy()
    awardedPostId = (await awardedRes.json()).id

    const rejectedRes = await request.post("/api/test/seed-post", {
      data: {
        outcome: "Rejected",
        authorEmail: OUTCOME_AUTHOR.email,
        targetEmail: OUTCOME_TARGET.email,
        title: REJECTED_TITLE,
      },
    })
    expect(rejectedRes.ok()).toBeTruthy()
    rejectedPostId = (await rejectedRes.json()).id
  })
})

test.describe("VOTE-04: outcome badges on concluded posts", () => {
  test("concluded post with outcome Awarded shows Awarded badge", async ({ page }) => {
    await signIn(page, OUTCOME_TARGET)
    await page.goto("/")
    const card = await getPostCard(page, AWARDED_TITLE)
    await expect(card.getByText("Awarded")).toBeVisible({ timeout: 10000 })
  })

  test("concluded post with outcome Rejected shows Rejected badge", async ({ page }) => {
    await signIn(page, OUTCOME_TARGET)
    await page.goto("/")
    const card = await getPostCard(page, REJECTED_TITLE)
    await expect(card.getByText("Rejected")).toBeVisible({ timeout: 10000 })
  })

  test("concluded post shows count-only display without interactive vote buttons", async ({ page }) => {
    await signIn(page, OUTCOME_TARGET)
    await page.goto("/")
    const card = await getPostCard(page, AWARDED_TITLE)
    // No interactive vote buttons on concluded posts
    await expect(card.getByRole("button", { name: /Agree/ })).not.toBeVisible()
    // Count-only text is displayed instead
    await expect(card.getByText(/Agree: \d+/)).toBeVisible()
  })
})

test.describe("Teardown — clean up seeded posts", () => {
  test("delete seeded test posts", async ({ request }) => {
    if (awardedPostId) {
      await request.delete("/api/test/seed-post", { data: { id: awardedPostId } })
    }
    if (rejectedPostId) {
      await request.delete("/api/test/seed-post", { data: { id: rejectedPostId } })
    }
  })
})
