import { chromium } from "playwright"
const out = "/tmp/claude-1000/-home-petros-Github-zigma-points/f0365446-ddf3-477f-8c7d-1b73186d0cb4/scratchpad"
const browser = await chromium.launch()

async function run(theme) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 880 } })
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme)
  const page = await ctx.newPage()
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle", timeout: 30000 })
  await page.fill('input[name="email"]', "user@zigma.local")
  await page.fill('input[name="password"]', "UserSecret!2026")
  await page.click('button[type="submit"]')
  await page.waitForTimeout(4000)
  console.log(theme, "url after login:", page.url())
  await page.screenshot({ path: `${out}/home-${theme}.png` })
  await ctx.close()
}
try { await run("light"); await run("dark") } catch (e) { console.error("ERR", e.message) }
await browser.close()
