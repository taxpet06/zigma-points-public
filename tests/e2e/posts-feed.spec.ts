// POST-01, POST-02, POST-04: automated. POST-03: test.skip — Uploadthing media upload requires real UPLOADTHING_TOKEN not available in CI.

import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

const AUTHOR = {
  name: "Feed Author",
  email: `feed-author-${Date.now()}@example.com`,
  password: "FeedAuthor123!",
  username: `feedauthor${Date.now()}`.slice(0, 20),
}

const TARGET = {
  name: "Feed Target",
  email: `feed-target-${Date.now()}@example.com`,
  password: "FeedTarget123!",
  username: `feedtarget${Date.now()}`.slice(0, 20),
}

async function signUp(page: import("@playwright/test").Page, user: typeof AUTHOR) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(user.name)
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10000 })
}

async function signIn(page: import("@playwright/test").Page, user: typeof AUTHOR) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10000 })
}

async function setUsername(page: import("@playwright/test").Page, username: string) {
  await page.goto("/profile/edit")
  const usernameField = page.getByLabel(/username/i)
  await usernameField.clear()
  await usernameField.fill(username)
  await page.getByRole("button", { name: /save/i }).click()
  await page.waitForTimeout(500)
}

test.describe("Setup — provision test users with usernames", () => {
  test("create author user with username", async ({ page }) => {
    await signUp(page, AUTHOR)
    await setUsername(page, AUTHOR.username)
  })

  test("create target user with username", async ({ page }) => {
    await signUp(page, TARGET)
    await setUsername(page, TARGET.username)
  })
})

test.describe("POST-04: Feed displays posts", () => {
  test("authenticated user sees the feed at /", async ({ page }) => {
    await signIn(page, AUTHOR)
    await page.goto("/")
    await expect(page.getByRole("button", { name: /create post/i }).first()).toBeVisible()
  })
})

test.describe("POST-01: Award post creation", () => {
  test("user can create an award post", async ({ page }) => {
    await signIn(page, AUTHOR)
    await page.goto("/")

    await page.getByRole("button", { name: /create post/i }).first().click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()

    // Award is default — type toggle already on Award
    await page.getByPlaceholder("Search users…").fill(TARGET.username.slice(0, 6))
    await page.getByText(`@${TARGET.username}`).click()

    await page.getByPlaceholder("What are you nominating them for?").fill("Test award title")
    await page.getByPlaceholder(/Describe/).fill("Test explanation for this award nomination.")
    await page.locator('input[type="number"]').fill("5")

    await page.getByRole("button", { name: /submit post/i }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText("Test award title").first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe("POST-02: Deduct post creation", () => {
  test("user can create a deduct post", async ({ page }) => {
    await signIn(page, AUTHOR)
    await page.goto("/")

    await page.getByRole("button", { name: /create post/i }).first().click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()

    await page.getByRole("button", { name: /deduct/i }).click()

    await page.getByPlaceholder("Search users…").fill(TARGET.username.slice(0, 6))
    await page.getByText(`@${TARGET.username}`).click()

    await page.getByPlaceholder("What are you nominating them for?").fill("Test deduct title")
    await page.getByPlaceholder(/Describe/).fill("Test explanation for this deduct nomination.")
    await page.locator('input[type="number"]').fill("3")

    await page.getByRole("button", { name: /submit post/i }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText("Test deduct title").first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe("POST-03: Media attachment", () => {
  test.skip("POST-03: user can attach media to a post — manual only (requires real UPLOADTHING_TOKEN in test env)", async () => {
    // Manual: open Create Post modal, use UploadButton to upload an image,
    // submit the form, verify the post in the feed shows an <img> element.
  })
})
