// Drive the TESTING database in and out of downtime, reversibly.
//
//   node --env-file=.env.local tools/term-window.mjs status
//   node --env-file=.env.local tools/term-window.mjs close [days]   # gap; next term in N days (default 21)
//   node --env-file=.env.local tools/term-window.mjs close --no-next # gap with nothing scheduled
//   node --env-file=.env.local tools/term-window.mjs open            # restore the backup
//
// `close` snapshots every term row to .term-backup.json first, so `open` puts the table
// back exactly as it was — same ids, so the termId stamps on posts, runs and leaderboards
// still point at the right windows (they are plain columns, not foreign keys).
//
// Reads .env.local = the testing DB. Point it at prod only on purpose.

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL)
const BACKUP = ".term-backup.json"
const [cmd, arg] = process.argv.slice(2)

const iso = (d) => new Date(d).toISOString()
const days = (n) => new Date(Date.now() + n * 86_400_000)

async function terms() {
  return sql`SELECT id, name, "startsAt" AT TIME ZONE 'UTC' AS "startsAt",
                    "endsAt" AT TIME ZONE 'UTC' AS "endsAt", "winnerId", "createdAt"
             FROM terms ORDER BY "startsAt"`
}

async function status() {
  const rows = await terms()
  const now = Date.now()
  if (!rows.length) return console.log("no terms — app is OPEN (pre-term state)")
  for (const t of rows) {
    const s = new Date(t.startsAt).getTime()
    const e = new Date(t.endsAt).getTime()
    const state = now < s ? "future" : now > e ? "past" : "ACTIVE"
    console.log(`${state.padEnd(6)} ${t.name}  ${iso(t.startsAt)} → ${iso(t.endsAt)}`)
  }
  const active = rows.some((t) => now >= +new Date(t.startsAt) && now <= +new Date(t.endsAt))
  const next = rows.find((t) => +new Date(t.startsAt) > now)
  console.log(`\napp is ${active ? "OPEN" : "DOWN"}${!active && next ? ` until ${iso(next.startsAt)}` : ""}`)
  console.log(!active && !next ? "(downtime with no scheduled return)" : "")
}

async function close() {
  if (!existsSync(BACKUP)) {
    writeFileSync(BACKUP, JSON.stringify(await terms(), null, 2))
    console.log(`backed up terms → ${BACKUP}`)
  } else {
    console.log(`${BACKUP} exists — keeping the original snapshot`)
  }

  // End anything currently running one minute ago. Windows are only ever read for
  // "is it open?"; the termId stamps rows already carry are untouched by this.
  await sql`UPDATE terms SET "endsAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute'
            WHERE "startsAt" <= (now() AT TIME ZONE 'UTC')
              AND "endsAt"   >= (now() AT TIME ZONE 'UTC')`

  if (arg === "--no-next") {
    await sql`DELETE FROM terms WHERE "startsAt" > (now() AT TIME ZONE 'UTC')`
    console.log("closed — no next term scheduled")
  } else {
    const n = Number(arg ?? 21)
    const [future] = await sql`SELECT id FROM terms WHERE "startsAt" > (now() AT TIME ZONE 'UTC') LIMIT 1`
    if (!future) {
      await sql`INSERT INTO terms (id, name, "startsAt", "endsAt", "createdAt")
                VALUES (${"tw_" + Math.random().toString(36).slice(2, 10)}, ${"Next Term"},
                        ${iso(days(n))}, ${iso(days(n + 90))}, now())`
    }
    console.log(`closed — next term opens in ${n} day(s)`)
  }
  await status()
}

async function open() {
  if (!existsSync(BACKUP)) return console.log(`no ${BACKUP} — nothing to restore`)
  const rows = JSON.parse(readFileSync(BACKUP, "utf8"))
  await sql`DELETE FROM terms`
  for (const t of rows) {
    await sql`INSERT INTO terms (id, name, "startsAt", "endsAt", "winnerId", "createdAt")
              VALUES (${t.id}, ${t.name}, ${iso(t.startsAt)}, ${iso(t.endsAt)},
                      ${t.winnerId}, ${iso(t.createdAt)})`
  }
  rmSync(BACKUP)
  console.log(`restored ${rows.length} term(s) from backup`)
  await status()
}

const run = { status, close, open }[cmd]
if (!run) {
  console.error("usage: term-window.mjs status | close [days|--no-next] | open")
  process.exit(1)
}
await run()
