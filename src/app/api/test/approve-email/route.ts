import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { normalizeEmail } from "@/lib/approved-emails"

// Test-only endpoint — blocked in production by a POSITIVE signal: any Vercel
// environment (preview + production) AND any non-Vercel production build
// (self-host / `next start`, where NODE_ENV === "production"). It stays available
// only in dev/test, where the E2E suite runs against `npm run dev`. Adds an email
// to the closed-registration allowlist so specs can sign up a freshly generated
// test user (src/lib/approved-emails.ts — signUp() 403s NOT_APPROVED otherwise).
const bodySchema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 })
  }

  await db.approvedEmail.upsert({
    where: { email: normalizeEmail(parsed.data.email) },
    update: {},
    create: { email: normalizeEmail(parsed.data.email) },
  })

  return NextResponse.json({ ok: true })
}
