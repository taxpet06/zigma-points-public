// Prisma v7 configuration file.
// - DIRECT_URL (unpooled) is used here for migrations only.
// - The runtime pooled URL (DATABASE_URL) is configured via the PrismaNeon adapter in src/lib/db.ts.
// Source: https://neon.com/docs/guides/prisma (verified 2026-06-13)
import { config as dotenvConfig } from "dotenv"
import { defineConfig, env } from "prisma/config"

// Next.js stores env vars in .env.local (not .env). Load it explicitly so
// prisma CLI commands (db push, migrate dev, generate) pick up DATABASE_URL/DIRECT_URL.
//
// Prod and testing databases are separated: .env.local is the testing DB (default),
// .env.production is the prod DB. Select with PRISMA_ENV=production (used by the
// db:studio:prod script). dotenv does NOT override already-set vars, so the FIRST
// file loaded wins each variable — load the selected env file before the fallback.
const envFile = process.env.PRISMA_ENV === "production" ? ".env.production" : ".env.local"
dotenvConfig({ path: envFile })
dotenvConfig({ path: ".env" }) // fallback for CI or environments using .env

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DIRECT_URL"), // unpooled — migrations and db push only
  },
})
