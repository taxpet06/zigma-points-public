// E2E Profile tests — PROF-01, PROF-02, PROF-03
//
// PROF-01: User has a display name and avatar visible on profile page and in the nav header
// PROF-02: User can write a short bio (about text) on their profile
// PROF-03: User can view any other user's public profile showing their ZP balance and post history
//
// NOTE: Avatar image assertions are intentionally omitted from required paths — the UserCircle
// fallback icon is acceptable without an UPLOADTHING_TOKEN configured (test environment).
// Avatar upload assertions would require a real UPLOADTHING_TOKEN to be set.
//
// Test strategy: use unique email/username per test run via timestamp suffix to avoid
// conflicts in the shared test DB.

import { test, expect } from "@playwright/test"

// Unique suffix per test run to avoid username/email collisions
const TS = `${Date.now()}`

// ---- helpers ----------------------------------------------------------------

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string
) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: /sign in/i }).click()
  await expect(page).toHaveURL("/")
}

async function signUp(
  page: import("@playwright/test").Page,
  name: string,
  email: string,
  password: string
) {
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: /create account/i }).click()
  await expect(page).toHaveURL("/")
  // NextAuth v5 + server actions: after a server action redirect, the client-side
  // SessionProvider does not immediately pick up the new session cookie.
  // A reload forces NextAuth to re-fetch the session from the JWT cookie.
  await page.reload()
  await page.waitForLoadState("networkidle")
}

// ---- PROF-01 ----------------------------------------------------------------

test.describe("PROF-01: Display name and avatar visible on profile", () => {
  test("authenticated user sees nav avatar link and their display name on their profile page", async ({
    page,
  }) => {
    const email = `prof01_${TS}@example.com`
    const name = "Profile One User"
    const username = `prof01usr${TS}`.slice(0, 20)

    // Sign up a fresh user
    await signUp(page, name, email, "TestPassword123!")

    // Nav avatar should be present and link to /profile/edit (no username yet)
    // Wait for the authenticated state — the header loads session async
    const navAvatar = page.getByRole("link", { name: /view your profile/i })
    await expect(navAvatar).toBeVisible({ timeout: 10000 })
    await expect(navAvatar).toHaveAttribute("href", "/profile/edit")

    // Claim a username via /profile/edit (ClaimUsernameForm is shown when username is null)
    await page.goto("/profile/edit")
    await expect(page.getByRole("heading", { name: /edit profile/i })).toBeVisible()

    // Fill in the claim form
    await page.getByLabel("Username").fill(username)
    await page.getByRole("button", { name: /claim username/i }).click()

    // After claiming, redirected to /u/[username]
    await expect(page).toHaveURL(`/u/${username}`)

    // Profile page shows the display name
    await expect(page.getByRole("heading", { name: name })).toBeVisible()

    // Nav avatar now links to /u/[username] — wait for getMe to refetch after claim
    const updatedNavAvatar = page.getByRole("link", { name: /view your profile/i })
    await expect(updatedNavAvatar).toHaveAttribute("href", `/u/${username}`, { timeout: 10000 })
  })
})

// ---- PROF-02 ----------------------------------------------------------------

test.describe("PROF-02: User can write and save a bio", () => {
  test("user can save a bio and it appears on their profile page", async ({
    page,
  }) => {
    const email = `prof02_${TS}@example.com`
    const name = "Profile Two User"
    const username = `prof02usr${TS}`.slice(0, 20)

    // Sign up a fresh user
    await signUp(page, name, email, "TestPassword123!")

    // Go to edit profile and claim a username first
    await page.goto("/profile/edit")
    await page.getByLabel("Username").fill(username)
    await page.getByRole("button", { name: /claim username/i }).click()
    await expect(page).toHaveURL(`/u/${username}`)

    // Go to edit profile and fill in bio
    await page.goto("/profile/edit")
    await expect(page.getByRole("heading", { name: /edit profile/i })).toBeVisible()
    // Wait for getMe to load and pre-populate the form before interacting
    await page.waitForLoadState("networkidle")

    const bio = "This is a test bio for PROF-02. It should appear on the profile page."
    await page.getByLabel(/bio/i).fill(bio)
    await page.getByRole("button", { name: /save changes/i }).click()

    // Wait for save to complete — the mutation is fast on localhost so just wait
    // for the button to remain in "Save changes" (not be stuck in loading)
    await expect(page.getByRole("button", { name: /save changes/i })).toBeEnabled({ timeout: 10000 })

    // Navigate to the profile page and assert bio text appears
    await page.goto(`/u/${username}`)
    await page.waitForLoadState("networkidle")
    await expect(page.getByText(bio)).toBeVisible({ timeout: 10000 })
  })
})

// ---- PROF-03 ----------------------------------------------------------------

test.describe("PROF-03: Authenticated user can view another user's public profile", () => {
  test("authenticated user sees ZP balance and Sent/Received tabs on another user's profile", async ({
    page,
  }) => {
    // Create "other user" with a username
    const otherEmail = `prof03other_${TS}@example.com`
    const otherName = "Other Profile User"
    const otherUsername = `prof03oth${TS}`.slice(0, 20)

    await signUp(page, otherName, otherEmail, "TestPassword123!")
    await page.goto("/profile/edit")
    await page.getByLabel("Username").fill(otherUsername)
    await page.getByRole("button", { name: /claim username/i }).click()
    await expect(page).toHaveURL(`/u/${otherUsername}`)

    // Sign out
    // Click the dropdown trigger (▾ button)
    await page.getByRole("button", { name: /user menu/i }).click()
    await page.getByRole("menuitem", { name: /sign out/i }).click()
    await expect(page).toHaveURL("/sign-in")

    // Sign in as a different user (viewer)
    const viewerEmail = `prof03viewer_${TS}@example.com`
    await signUp(page, "Viewer User", viewerEmail, "TestPassword123!")

    // Visit the other user's profile
    await page.goto(`/u/${otherUsername}`)

    // ZP balance should be visible — seeded new users start with 0 ZP
    await expect(page.getByText(/0 ZP/)).toBeVisible()

    // Sent/Received tabs should be present (PostHistoryTabs component)
    await expect(page.getByRole("tab", { name: /sent/i })).toBeVisible()
    await expect(page.getByRole("tab", { name: /received/i })).toBeVisible()
  })
})
