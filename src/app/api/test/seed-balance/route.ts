import { NextResponse } from "next/server"
import { db } from "@/lib/db"

// Test-only endpoint — blocked in all Vercel environments (preview + production).
// Sets a user's zigmaPoints balance directly so E2E specs can test ZP-gated flows.
export async function POST(req: Request) {
  if (process.env.VERCEL_ENV) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { email, zigmaPoints } = (await req.json()) as {
    email: string
    zigmaPoints: number
  }

  await db.user.update({
    where: { email },
    data: { zigmaPoints },
  })

  return NextResponse.json({ ok: true })
}
