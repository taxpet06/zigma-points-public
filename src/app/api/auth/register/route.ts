// POST /api/auth/register — JSON-based registration endpoint.
// Returns 201 on success, 409 on duplicate email, 400 on invalid input.
//
// NextAuth v5 has no built-in registration — this route fills that gap.
// It shares the same validation + hash + create logic as the signUp Server Action.
// Security: same ASVS V5/V6 controls (input validation, bcrypt cost 12).

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { isEmailApproved, NOT_APPROVED_ERROR } from "@/lib/approved-emails"

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 })
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 })
  }

  const { name, email, password } = body as Record<string, unknown>

  // ASVS V5: validate all fields before touching the database
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 })
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 })
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    )
  }

  const normalizedEmail = email.trim().toLowerCase()
  const normalizedName = name.trim()

  // Signup allowlist — closed registration. Checked before the duplicate lookup so
  // an unapproved address learns nothing about which emails already have accounts.
  if (!(await isEmailApproved(normalizedEmail))) {
    return NextResponse.json({ error: NOT_APPROVED_ERROR }, { status: 403 })
  }

  // 409 Conflict on duplicate email
  const existing = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    )
  }

  // ASVS V6 / T-01-08: hash with bcrypt cost 12 before storing
  const hashed = await bcrypt.hash(password, 12)

  const user = await db.user.create({
    data: {
      email: normalizedEmail,
      password: hashed,
      name: normalizedName,
      role: "USER",
    },
    select: { id: true, email: true, name: true, role: true },
  })

  return NextResponse.json({ user }, { status: 201 })
}
