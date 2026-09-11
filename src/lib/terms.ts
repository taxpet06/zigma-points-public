// Term helpers — the one place "which term is it?" is answered.
//
// A term is a fixed calendar window (schema.prisma § Terms). There is no isCurrent
// flag: it is derived from the dates, because a flag is a second source of truth that
// can disagree with them.
//
// "Current" turned out to be TWO questions, so there are two functions below and using
// the wrong one is the bug this file exists to prevent:
//   currentTerm()       — what new activity BELONGS to. Moves to the next term the
//                         instant one ends, which is what closes the old term's posts,
//                         leaderboards and lootboxes during the gap.
//   latestStartedTerm() — what the UI should SHOW. Keeps returning the term that just
//                         ended, so its podium and boards stay readable through the gap
//                         and the header can render "Term Ended" for it.
//
// Rows that belong to a term carry a `termId` stamped AT CREATION from stampTermId()
// below. They are never re-derived from dates at read time: an admin editing a term's
// window afterwards would otherwise reshuffle a finished leaderboard, and a settled
// board must stay settled. That stamp is the only thing every term-scoped query filters
// on.

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { db } from "@/lib/db"
import { dayKey } from "@/lib/day-key"

const TERM_SELECT = { id: true, name: true, startsAt: true, endsAt: true } as const

/**
 * The term running RIGHT NOW, or NULL between terms — the gate.
 *
 * "No active term" is a real, first-class state, not a fallback to some nearby term.
 * Every action that only makes sense inside a term asks this and refuses on null:
 * posting, opening a betting pool, replying, minting a lootbox. A break is therefore
 * read-only by construction rather than by a list of special cases someone has to
 * remember to extend.
 *
 * Deliberately NOT "the most recent started term" (that is latestStartedTerm, which
 * answers what the UI should SHOW) and deliberately NOT "the next term" (an earlier
 * attempt at this — it made a break belong to a term that had not begun, so a run
 * played then was invisible on the board it was played on).
 */
export function currentTerm() {
  const now = new Date()
  return db.term.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: "desc" },
    select: TERM_SELECT,
  })
}

/**
 * Throw unless a term is running. The one guard every term-only action shares, so
 * "which actions need a term?" is answered by grepping this rather than by reading
 * every router.
 *
 * Returns the active term, so callers that then need its id do not query twice.
 */
export async function requireActiveTerm() {
  const term = await currentTerm()
  if (!term) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No term is running right now — this reopens when the next term starts.",
    })
  }
  return term
}

/**
 * The most recent term that has already STARTED — a UI question, not a gating one.
 *
 * This is what a board, a countdown or a term picker should default to: the last term
 * there is something to LOOK AT for. During a break that is the term that just ended
 * (its podium, its leaderboards, its history), while currentTerm() has already moved on
 * to the next one. The two deliberately disagree between terms; before this split a
 * single value had to answer both and got the break wrong.
 */
export function latestStartedTerm() {
  return db.term.findFirst({
    where: { startsAt: { lte: new Date() } },
    orderBy: { startsAt: "desc" },
    select: TERM_SELECT,
  })
}

/**
 * What a NEW row gets stamped with — the term it will show up under.
 *
 * This is latestStartedTerm, NOT currentTerm, and the difference only shows during a
 * break. A run played in a reopened break must land on the board the player is actually
 * looking at, and every leaderboard, feed filter and podium shows the term that just
 * ended (see latestStartedTerm). Stamping such a run with the NEXT term filed it under a
 * term that had not begun: invisible on the board it was played on, and silently
 * counting toward a term it was not played in.
 *
 * So the two rules divide cleanly:
 *   stampTermId()  — which term does this activity BELONG to (the visible one)
 *   currentTerm()  — is that term OPEN for interaction (no, during a break)
 *
 * Inside a term they are the same term, so none of this is visible in normal operation.
 * During a break everything you do counts toward the term that just ended, and that term
 * is closed — which is why old posts lock and lootboxes stop minting while games, whose
 * boards are live, keep working.
 */
export async function stampTermId(): Promise<string | null> {
  const term = await latestStartedTerm()
  return term?.id ?? null
}

/**
 * Who wears the 💩 — the Poopers of the most recent started term that HAS any.
 *
 * The mirror of the crown, which stays on the last Maxxer until the next one takes it.
 * Keyed to latestStartedTerm instead, the poop vanished the moment a new term began,
 * i.e. for the whole term after the one it was earned in.
 */
export async function poopHolderIds(): Promise<string[]> {
  // ponytail: whole table — a handful of rows per term. Filter in SQL if it ever grows.
  const rows = await db.termPooper.findMany({ select: { termId: true, userId: true } })
  if (rows.length === 0) return []
  const term = await db.term.findFirst({
    where: { id: { in: [...new Set(rows.map((r) => r.termId))] }, startsAt: { lte: new Date() } },
    orderBy: { startsAt: "desc" },
    select: { id: true },
  })
  return term ? rows.filter((r) => r.termId === term.id).map((r) => r.userId) : []
}

// Leaderboard scopes. "term" defaults to the current term when termId is omitted, so a
// client can render the board before the term list has loaded.
export const leaderboardScopeSchema = z.object({
  scope: z.enum(["today", "term", "all-time"]),
  termId: z.string().nullish(),
})
export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>

/**
 * Prisma `where` fragment for a leaderboard scope, spread into a run query.
 *
 * Returns null when a term board was asked for but no term exists — the caller must
 * ship an empty board. It must NOT fall through to `{}` (that would silently serve
 * the all-time board as a term board) and must NOT filter `termId: null` (that would
 * match every pre-term run, the opposite of "this term").
 */
export async function leaderboardScopeWhere(
  input: LeaderboardScope,
): Promise<{ day?: string; termId?: string } | null> {
  if (input.scope === "all-time") return {}
  if (input.scope === "today") return { day: dayKey() }
  // stampTermId, not currentTerm: the default "Term" board must be the one runs are
  // being written to, or during a break the board would silently switch to a term that
  // has not started while runs kept landing on the previous one.
  const termId = input.termId ?? (await stampTermId())
  return termId ? { termId } : null
}

/**
 * True when `termId` names the term that is OPEN for interaction — the single rule
 * behind "a past term's content is read-only".
 *
 * With no term running this is false for everything, so a break locks the whole app's
 * content without needing to know what any row is stamped with.
 *
 * The ONE exception is a database with no terms at all: a fresh dev checkout, CI, or a
 * restored dump. downtimeState() already refuses to call that state downtime, for the
 * same reason — the app would boot open but inert, with nobody able to create the term
 * that would fix it. So with zero terms nothing is locked.
 *
 * This gates INTERACTION, never visibility: old posts, threads and pools stay fully
 * readable, exactly as a closed term's leaderboard and lootboxes do.
 */
export async function isCurrentTerm(termId: string | null): Promise<boolean> {
  const term = await currentTerm()
  if (term) return termId === term.id
  return (await db.term.count()) === 0
}
