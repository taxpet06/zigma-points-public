// Seed script — proves a real write+read round-trip against Neon.
// Creates an ADMIN user and a regular USER user (idempotent via upsert).
// T-01-02 mitigation: passwords are hashed with bcrypt (cost 12) — never stored plaintext.
//
// Must load env BEFORE importing db because the PrismaNeon adapter reads DATABASE_URL
// at instantiation time. Use dynamic import to defer db import until after env setup.
import { config as dotenvConfig } from "dotenv"

// Load env vars — Next.js uses .env.local; fallback to .env for CI environments.
// This must happen before any module that reads process.env is imported.
dotenvConfig({ path: ".env.local" })
dotenvConfig({ path: ".env" })

import bcrypt from "bcryptjs"
import { db } from "../src/lib/db"

async function main() {
  const adminPassword = await bcrypt.hash("AdminSecret!2026", 12)
  const userPassword = await bcrypt.hash("UserSecret!2026", 12)

  await db.user.upsert({
    where: { email: "admin@zigma.local" },
    update: {},
    create: {
      email: "admin@zigma.local",
      name: "Zigma Admin",
      role: "ADMIN",
      password: adminPassword,
      zigmaPoints: 100,
    },
  })

  await db.user.upsert({
    where: { email: "user@zigma.local" },
    update: {},
    create: {
      email: "user@zigma.local",
      name: "Test User",
      role: "USER",
      password: userPassword,
      zigmaPoints: 0,
    },
  })

  // Read back to prove the write+read round-trip works
  const users = await db.user.findMany({
    select: { email: true, role: true, zigmaPoints: true },
  })

  console.log(`Seeded ${users.length} users:`)
  for (const u of users) {
    console.log(`  - ${u.email} (${u.role}, ${u.zigmaPoints} ZP)`)
  }

  console.log("\nSeed complete — DB connection verified.")
}

main()
  .catch((err) => {
    console.error("Seed failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
