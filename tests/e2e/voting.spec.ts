// VOTE-01, VOTE-02: voting behavior E2E

import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

const VOTE_AUTHOR = {
  name: "Vote Author",
  email: `voteauthor-${Date.now()}@example.com`,
  password: "VoteAuthor123!",
  username: `voteauthor${Date.now()}`.slice(0, 20),
}

const VOTER = {
  name: "Test Voter",
  email: `testvoter-${Date.now()}@example.com`,
  password: "TestVoter123!",
  username: `testvoter${Date.now()}`.slice(0, 20),
}

const POST_TITLE = `Vote test ${Date.now()}`

async function signUp(page: import("@playwright/test").Page, user: typeof VOTE_AUTHOR) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(user.name)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10000 })
}

async function signIn(page: import("@playwright/test").Page, user: typeof VOTE_AUTHOR) {
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

test.describe("Setup — create users and a voteable post", () => {
  test("create vote author with username", async ({ page }) => {
    await signUp(page, VOTE_AUTHOR)
    await setUsername(page, VOTE_AUTHOR.username)
  })

  test("create voter user with username", async ({ page }) => {
    await signUp(page, VOTER)
    await setUsername(page, VOTER.username)
  })

  test("author creates a post targeting voter", async ({ page }) => {
    await signIn(page, VOTE_AUTHOR)
    await page.goto("/")
    await page.getByRole("button", { name: /create post/i }).first().click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()

    await page.getByPlaceholder("Search users…").fill(VOTER.username.slice(0, 6))
    await page.getByText(`@${VOTER.username}`).click()

    await page.getByPlaceholder("What are you nominating them for?").fill(POST_TITLE)
    await page.getByPlaceholder(/Describe/).fill("E2E vote test explanation.")
    await page.locator('input[type="number"]').fill("10")

    await page.getByRole("button", { name: /submit post/i }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText(POST_TITLE).first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe("VOTE-02: vote counts are visible", () => {
  test("agree and disagree counts are visible on the post", async ({ page }) => {
    await signIn(page, VOTER)
    await page.goto("/")
    const card = await getPostCard(page, POST_TITLE)
    // Vote buttons show "Agree (N votes)" and "Disagree (N votes)"
    await expect(card.getByRole("button", { name: /Agree/ })).toBeVisible()
    await expect(card.getByRole("button", { name: /Disagree/ })).toBeVisible()
  })
})

test.describe("VOTE-01: voting interactions", () => {
  test("user can cast an agree vote", async ({ page }) => {
    await signIn(page, VOTER)
    await page.goto("/")
    const card = await getPostCard(page, POST_TITLE)
    const agreeBtn = card.getByRole("button", { name: /Agree/ })
    await agreeBtn.click()
    // Optimistic update: aria-pressed becomes true immediately
    await expect(agreeBtn).toHaveAttribute("aria-pressed", "true", { timeout: 5000 })
  })

  test("user can flip vote from agree to disagree", async ({ page }) => {
    await signIn(page, VOTER)
    await page.goto("/")
    const card = await getPostCard(page, POST_TITLE)

    // Cast agree first
    const agreeBtn = card.getByRole("button", { name: /Agree/ })
    const disagreeBtn = card.getByRole("button", { name: /Disagree/ })
    await agreeBtn.click()
    await expect(agreeBtn).toHaveAttribute("aria-pressed", "true", { timeout: 5000 })

    // Flip to disagree
    await disagreeBtn.click()
    await expect(disagreeBtn).toHaveAttribute("aria-pressed", "true", { timeout: 5000 })
    await expect(agreeBtn).toHaveAttribute("aria-pressed", "false", { timeout: 5000 })
  })

  test("user can retract vote by clicking active button", async ({ page }) => {
    await signIn(page, VOTER)
    await page.goto("/")
    const card = await getPostCard(page, POST_TITLE)

    // Cast agree first
    const agreeBtn = card.getByRole("button", { name: /Agree/ })
    await agreeBtn.click()
    await expect(agreeBtn).toHaveAttribute("aria-pressed", "true", { timeout: 5000 })

    // Click active button to retract
    await agreeBtn.click()
    await expect(agreeBtn).toHaveAttribute("aria-pressed", "false", { timeout: 5000 })
  })

  test("vote buttons are hidden on posts authored by current user", async ({ page }) => {
    await signIn(page, VOTE_AUTHOR)
    await page.goto("/")
    const card = await getPostCard(page, POST_TITLE)
    // Author cannot vote on own post — buttons hidden, count-only text shown
    await expect(card.getByRole("button", { name: /Agree/ })).not.toBeVisible()
    await expect(card.getByText(/Agree: \d+/)).toBeVisible()
  })
})
