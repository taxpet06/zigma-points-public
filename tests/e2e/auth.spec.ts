import { test, expect } from "@playwright/test"

/**
 * AUTH E2E Test Suite — AUTH-01, AUTH-02, AUTH-03
 *
 * Serial mode: AUTH-01 creates the test user; AUTH-02 and AUTH-03 sign in with it.
 * Parallel execution breaks this because the user won't exist when AUTH-02 runs.
 */

test.describe.configure({ mode: "serial" })

// Test user credentials — created during AUTH-01, reused by AUTH-02/03
const TEST_USER = {
  name: "Test User",
  email: `testuser-${Date.now()}@example.com`,
  password: "TestPassword123!",
}

test.describe("AUTH-01: User can sign up", () => {
  test("user can sign up with name, email, and password", async ({ page }) => {
    await page.goto("/sign-up")

    await page.getByLabel("Name").fill(TEST_USER.name)
    await page.getByLabel("Email").fill(TEST_USER.email)
    await page.getByLabel("Password").fill(TEST_USER.password)

    // Button text is "Create account" (not "Sign up")
    await page.getByRole("button", { name: /create account/i }).click()

    await expect(page).toHaveURL("/", { timeout: 10000 })
  })
})

test.describe("AUTH-02: User can log in", () => {
  test("user can log in with email and password", async ({ page }) => {
    await page.goto("/sign-in")

    await page.getByLabel("Email").fill(TEST_USER.email)
    await page.getByLabel("Password").fill(TEST_USER.password)
    await page.getByRole("button", { name: /sign in/i }).click()

    await expect(page).toHaveURL("/", { timeout: 10000 })
  })
})

test.describe("AUTH-03: Session persists across refresh", () => {
  test("session persists after page reload", async ({ page }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email").fill(TEST_USER.email)
    await page.getByLabel("Password").fill(TEST_USER.password)
    await page.getByRole("button", { name: /sign in/i }).click()

    await expect(page).toHaveURL("/", { timeout: 10000 })

    await page.reload()

    await expect(page).toHaveURL("/")
  })
})
