// ADMN-01, ADMN-02, ADMN-03, TASK-01, TASK-02, TASK-03: failing scaffold.
// These tests ARE EXPECTED TO FAIL until Wave 2/3 builds the UI (admin panel, tasks pages,
// task reply components). Run with --grep "ADMN-01" etc. to select individual requirement tests.

import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

// Seeded credentials (prisma/seed.ts) — do not create new admin (role cannot be self-assigned)
const ADMIN_USER = {
  email: "admin@zigma.local",
  password: "AdminSecret!2026",
}

const REGULAR_USER = {
  email: "user@zigma.local",
  password: "UserSecret!2026",
}

async function signIn(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/", { timeout: 10000 })
}

// ---------------------------------------------------------------------------
// ADMN-01: Admin views users table and edits a ZP balance
// ---------------------------------------------------------------------------

test.describe("ADMN-01: Admin user table + inline balance edit", () => {
  test("admin signs in, visits /admin, sees Users table, edits a ZP balance cell, sees updated value", async ({
    page,
  }) => {
    await signIn(page, ADMIN_USER)

    // Navigate to admin panel
    await page.goto("/admin")
    await expect(page).toHaveURL("/admin", { timeout: 10000 })

    // Users table should be visible
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole("columnheader", { name: /name|email/i }).first()).toBeVisible()

    // Find the regular user row and click their ZP balance cell to enter edit mode
    const userRow = page.getByRole("row").filter({ hasText: REGULAR_USER.email })
    const balanceCell = userRow.getByRole("button").first()
    const originalBalance = await balanceCell.textContent()
    await balanceCell.click()

    // Balance cell should become an input
    const balanceInput = userRow.locator('input[type="number"]')
    await expect(balanceInput).toBeVisible({ timeout: 5000 })

    // Enter a new balance
    const newBalance = 42
    await balanceInput.fill(String(newBalance))
    await balanceInput.press("Enter")

    // Updated balance should appear in the cell
    await expect(userRow.getByRole("button").filter({ hasText: String(newBalance) })).toBeVisible({
      timeout: 10000,
    })

    // Restore original balance to keep test state clean
    if (originalBalance !== null && originalBalance.trim() !== String(newBalance)) {
      const restored = userRow.getByRole("button").first()
      await restored.click()
      const restoreInput = userRow.locator('input[type="number"]')
      await restoreInput.fill(originalBalance.trim())
      await restoreInput.press("Enter")
    }
  })
})

// ---------------------------------------------------------------------------
// ADMN-02: Admin creates a Task Post
// ---------------------------------------------------------------------------

const TASK_TITLE = `E2E Task ${Date.now()}`

test.describe("ADMN-02: Admin creates a Task Post", () => {
  test("admin opens Create Task modal, fills title/description/zpReward, submits, task appears on /tasks", async ({
    page,
  }) => {
    await signIn(page, ADMIN_USER)

    // Navigate to admin panel where Create Task button lives
    await page.goto("/admin")
    await expect(page).toHaveURL("/admin", { timeout: 10000 })

    // Open Create Task modal
    await page.getByRole("button", { name: /create task/i }).click()
    const createTaskDialog = page.getByRole("dialog", { name: "Create Task" })
    await expect(createTaskDialog).toBeVisible({ timeout: 5000 })

    // Fill in task details
    await createTaskDialog.getByLabel(/title/i).fill(TASK_TITLE)
    await createTaskDialog.getByLabel(/description/i).fill("E2E test task description")
    await createTaskDialog.locator('input[type="number"]').fill("10")

    // Submit
    await createTaskDialog.getByRole("button", { name: /create task/i }).click()
    await expect(createTaskDialog).not.toBeVisible({ timeout: 10000 })

    // Task should appear on /tasks page
    await page.goto("/tasks")
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 15000 })
  })
})

// ---------------------------------------------------------------------------
// TASK-01: Authenticated user sees Tasks nav link, /tasks lists tasks, /tasks/[id] opens
// ---------------------------------------------------------------------------

test.describe("TASK-01: Tasks tab and task detail page", () => {
  test("any authenticated user sees Tasks nav link, /tasks lists the task, /tasks/[id] opens", async ({
    page,
  }) => {
    await signIn(page, REGULAR_USER)

    // Tasks nav link should be visible for authenticated users
    await expect(page.getByRole("link", { name: /tasks/i })).toBeVisible({ timeout: 10000 })

    // Navigate to /tasks via nav link
    await page.getByRole("link", { name: /tasks/i }).click()
    await expect(page).toHaveURL("/tasks", { timeout: 10000 })

    // Task list page should load
    await expect(page).toHaveURL("/tasks")

    // ADMN-02 runs before TASK-01 in serial mode, so the task must exist; assert unconditionally (WR-04)
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 10000 })
    const taskLink = page.locator('a[href^="/tasks/"]').first()
    await taskLink.click()
    await expect(page).toHaveURL(/\/tasks\//, { timeout: 10000 })
    await expect(page.getByText(TASK_TITLE)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// TASK-02: User replies to a Task Post
// ---------------------------------------------------------------------------

test.describe("TASK-02: User replies to a task post", () => {
  test("user can reply to a task post and the reply appears", async ({ page }) => {
    await signIn(page, REGULAR_USER)

    await page.goto("/tasks")
    await expect(page).toHaveURL("/tasks", { timeout: 10000 })

    // Navigate to a task detail page
    const taskLink = page.locator('a[href^="/tasks/"]').first()
    await expect(taskLink).toBeVisible({ timeout: 10000 })
    await taskLink.click()
    await expect(page).toHaveURL(/\/tasks\//, { timeout: 10000 })

    // Reply compose box should be visible
    const compose = page.getByPlaceholder("Write a reply…")
    await expect(compose).toBeVisible({ timeout: 10000 })

    // Submit a reply
    const replyText = `TASK-02 reply ${Date.now()}`
    await compose.fill(replyText)
    // Ensure button is enabled before clicking
    const postBtn = page.getByRole("button", { name: /post reply/i })
    await expect(postBtn).toBeEnabled({ timeout: 5000 })
    await postBtn.click()

    // Reply should appear in the Replies thread section (not just in the compose textarea)
    const repliesSection = page.getByRole("region", { name: "Replies" })
    await expect(repliesSection.getByText(replyText)).toBeVisible({ timeout: 15000 })
  })
})

// ---------------------------------------------------------------------------
// ADMN-03: Admin marks a task reply complete — "Awarded" badge appears
// ---------------------------------------------------------------------------

test.describe("ADMN-03: Admin marks task reply complete", () => {
  test("admin marks a task reply complete and an 'Awarded' badge appears", async ({ page }) => {
    await signIn(page, ADMIN_USER)

    await page.goto("/tasks")
    await expect(page).toHaveURL("/tasks", { timeout: 10000 })

    // Navigate to a task detail page
    const taskLink = page.locator('a[href^="/tasks/"]').first()
    await expect(taskLink).toBeVisible({ timeout: 10000 })
    await taskLink.click()
    await expect(page).toHaveURL(/\/tasks\//, { timeout: 10000 })

    // Admin should see "Mark Complete" button on a reply card
    const markCompleteButton = page.getByRole("button", { name: /mark complete/i }).first()
    await expect(markCompleteButton).toBeVisible({ timeout: 10000 })
    await markCompleteButton.click()

    // "Awarded" badge should appear on the reply card
    await expect(page.getByText(/awarded/i).first()).toBeVisible({ timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// TASK-03: Pending/Awarded status visible on task replies
// ---------------------------------------------------------------------------

test.describe("TASK-03: Completion status visible on task replies", () => {
  test("Pending or Awarded status badge is visible on task reply cards", async ({ page }) => {
    await signIn(page, REGULAR_USER)

    await page.goto("/tasks")
    await expect(page).toHaveURL("/tasks", { timeout: 10000 })

    const taskLink = page.locator('a[href^="/tasks/"]').first()
    await expect(taskLink).toBeVisible({ timeout: 10000 })
    await taskLink.click()
    await expect(page).toHaveURL(/\/tasks\//, { timeout: 10000 })

    // At least one reply with a status badge (Pending or Awarded) should be visible
    // After ADMN-03 runs, the awarded reply should show "Awarded"
    const statusBadge = page
      .getByText(/awarded/i)
      .or(page.getByText(/pending/i))
      .first()
    await expect(statusBadge).toBeVisible({ timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// TASK-02 (media): Skipped — requires real UPLOADTHING_TOKEN
// ---------------------------------------------------------------------------

test.describe("TASK-02: Media attachment on task reply", () => {
  test.skip(
    "TASK-02: user can attach media to a task reply — manual only (requires real UPLOADTHING_TOKEN in test env)",
    async () => {
      // Manual: navigate to /tasks/[id], use UploadButton in the ReplyCompose box to upload an image,
      // submit the reply, verify the reply appears in the thread with an <img> or <video> element.
    }
  )
})
