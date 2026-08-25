import { test, expect } from "@playwright/test"

/**
 * AUTH-04 E2E Test Suite — Admin Role Guard
 *
 * Requires seeded users (run `npm run db:seed`):
 *   regular: user@zigma.local / UserSecret!2026   (role: USER)
 *   admin:   admin@zigma.local / AdminSecret!2026  (role: ADMIN)
 */

// Regular user — seeded by prisma/seed.ts
const REGULAR_USER = {
  email: "user@zigma.local",
  password: "UserSecret!2026",
}

// Admin user — seeded by prisma/seed.ts
const ADMIN_USER = {
  email: "admin@zigma.local",
  password: "AdminSecret!2026",
}

test.describe("AUTH-04: Admin route enforcement", () => {
  test("regular user is redirected away from /admin", async ({ page }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email").fill(REGULAR_USER.email)
    await page.getByLabel("Password").fill(REGULAR_USER.password)
    await page.getByRole("button", { name: /sign in/i }).click()

    await expect(page).toHaveURL("/", { timeout: 10000 })

    await page.goto("/admin")

    await expect(page).not.toHaveURL("/admin")
    await expect(page).toHaveURL("/")
  })

  test("admin user can access /admin page", async ({ page }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email").fill(ADMIN_USER.email)
    await page.getByLabel("Password").fill(ADMIN_USER.password)
    await page.getByRole("button", { name: /sign in/i }).click()

    await expect(page).toHaveURL("/", { timeout: 10000 })

    await page.goto("/admin")

    await expect(page).toHaveURL("/admin")
    await expect(page.getByRole("heading", { name: /admin/i })).toBeVisible()
  })
})
