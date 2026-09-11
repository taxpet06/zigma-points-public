// The term boundary wipe — everyone starts a term on zero.
//
// A balance means "what you have earned THIS term", so it cannot survive the term. At
// BOTH boundaries of every term, every balance goes to zero and everything still holding
// ZP mid-flight is closed out:
//
//   - END: closes the term. Runs after the term is scored (see ORDERING below).
//   - START: runs START_LEAD_MS BEFORE startsAt, while the app is still closed. The end
//     wipe alone was not enough: an admin can reopen the app during the break, and
//     whatever is earned then would otherwise carry into the new term (26F opened on
//     90k ZP of break-time balances). It fires early rather than late because the first
//     tick AFTER startsAt can be up to 15 minutes into the term, and would erase real
//     activity from inside it.
//
// ORDERING IS LOAD-BEARING. This runs from the settle cron AFTER scoreEndedTerms, because
// scoring reads User.zigmaPoints as the zpBalance metric. Wipe first and every balance
// scores as zero.
//
// IDEMPOTENT BY MARKER. The cron fires every 15 minutes; Term.zpResetStartedAt /
// zpResetEndedAt make each boundary fire exactly once. Without them the wipe would
// re-run on every tick for the whole break — which is invisible while the app is closed
// and destructive the moment an admin reopens it, since anything earned would be erased
// minutes later.

import { db } from "@/lib/db"

/** How far back a boundary can be and still fire, mirroring AUTO_SCORE_WINDOW_DAYS.
 *
 *  This is what stops the FIRST deploy from wiping balances on behalf of boundaries that
 *  passed months ago. Terms whose start or end is older than this are treated as history
 *  and are never reset — no migration backfill needed, and the rule reads the same way as
 *  the scoring window next to it. */
export const TERM_RESET_WINDOW_DAYS = 30

/** How early the START wipe fires. One cron interval, so some tick is guaranteed to land
 *  in [startsAt - lead, startsAt) — i.e. before the app opens. If the cron misses that
 *  tick the wipe still runs, just late, on the first tick after. */
export const START_LEAD_MS = 15 * 60 * 1000

type Marker = "zpResetStartedAt" | "zpResetEndedAt"

/**
 * Close out everything still holding ZP, then zero every balance.
 *
 * Cancelling comes first and is not optional. Each of these outlives a wipe and would
 * otherwise move ZP in the NEXT term against a pot that no longer exists:
 *
 *   - Unsettled betting pools. The stake left each backer's balance when the bet was
 *     placed; settling later would credit payouts out of nothing. Cancelled the same way
 *     bet.cancelBet does it — betSettledAt set, winningChoice left null, payout = amount
 *     as the refund marker the UI already reads.
 *   - Active listings. A copy sits escrowed while listed, so an uncancelled listing
 *     strands the cosmetic as unusable and untradeable forever.
 *   - Pending transfers and trade offers. No ZP has moved yet (that is what PENDING
 *     means), so rejecting them costs nobody anything — but approving one next term would
 *     move ZP that no longer relates to anything.
 *   - Outstanding loans. dueAt is in the future and the sweep collects on that date, so a
 *     forgiven-looking debt would quietly push a borrower negative in a term they did not
 *     borrow in. Marked repaid, which is the only "do not collect" signal the schema has.
 *
 * No refund CREDITS are issued anywhere above: every balance is zeroed three statements
 * later, so crediting first would be arithmetic with no observable effect.
 *
 * Sends no notifications. This is a mass event during a break, and the app is closed.
 */
async function wipe(termId: string, marker: Marker, now: Date) {
  await db.$transaction([
    // Refund marker, written by the SAME predicate that closes the pools below rather
    // than from a list read beforehand — a bet placed between a read and the write would
    // otherwise be cancelled without its marker and render as a loss rather than a
    // refund. Prisma cannot set a column from another column, so this writes 0; the
    // stake is not credited back either way (every balance is zeroed below), and
    // winningChoice staying null is what marks the pool cancelled.
    db.taskBet.updateMany({
      where: { task: { kind: "BET", betSettledAt: null } },
      data: { payout: 0 },
    }),
    db.task.updateMany({
      where: { kind: "BET", betSettledAt: null },
      data: { betSettledAt: now }, // winningChoice stays null — that IS "cancelled"
    }),
    db.listing.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "CANCELLED", resolvedAt: now },
    }),
    db.transfer.updateMany({
      where: { status: "PENDING" },
      data: { status: "REJECTED", respondedAt: now },
    }),
    db.transfer.updateMany({
      where: { status: "APPROVED", dueAt: { not: null }, repaidAt: null },
      data: { repaidAt: now },
    }),
    // Every listing and trade offer above is now terminal, so nothing legitimately holds
    // a copy in escrow. Clearing the flag wholesale beats chasing each claim's id.
    db.cosmeticPurchase.updateMany({ where: { escrowed: true }, data: { escrowed: false } }),
    // The wipe itself. Admins included — a clean slate that exempts someone is not one,
    // and an admin can set their own balance from the portal anyway.
    db.user.updateMany({ data: { zigmaPoints: 0 } }),
    db.term.update({ where: { id: termId }, data: { [marker]: now } }),
  ])
}

type TermBoundaries = {
  id: string
  name: string
  startsAt: Date
  endsAt: Date
  zpResetStartedAt: Date | null
  zpResetEndedAt: Date | null
}

/** Which boundary to wipe next, or undefined. Pure, so the selection rule — the part
 *  that decides whether real balances get zeroed — is testable without a database. */
export function nextDueBoundary(terms: TermBoundaries[], now: Date, cutoff: Date) {
  return terms
    .flatMap((t) => {
      const startAt = new Date(t.startsAt.getTime() - START_LEAD_MS)
      // Back-to-back terms: if an earlier term is still running at the start wipe's
      // fire time, wiping then would zero it before it is scored (the cron's scoring
      // gate only sees ENDED terms). Its own end wipe gives this term the clean slate.
      const overlapped = terms.some((o) => o.startsAt < t.startsAt && o.endsAt > startAt)
      return [
        ...(overlapped
          ? []
          : [{ termId: t.id, marker: "zpResetStartedAt" as Marker, label: `${t.name}:start`, at: startAt, done: t.zpResetStartedAt }]),
        { termId: t.id, marker: "zpResetEndedAt" as Marker, label: `${t.name}:end`, at: t.endsAt, done: t.zpResetEndedAt },
      ]
    })
    // Oldest first: if several boundaries passed unwiped, they run in the order they fell.
    .filter((b) => b.done === null && b.at <= now && b.at >= cutoff)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0]
}

/**
 * Run any term boundary that has passed and not yet been wiped.
 *
 * At most ONE boundary per invocation, oldest first — the same budget discipline
 * scoreEndedTerms uses, since this shares the settle cron's function timeout. The next
 * tick picks up the next one.
 *
 * Returns a label per boundary processed, for the cron's JSON response.
 */
export async function resetPassedTermBoundaries(now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - TERM_RESET_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  // ponytail: every term, unfiltered — a few rows a year, and nextDueBoundary needs the
  // neighbours for its back-to-back check. Add a where clause if this ever grows.
  const terms = await db.term.findMany({
    select: { id: true, name: true, startsAt: true, endsAt: true, zpResetStartedAt: true, zpResetEndedAt: true },
  })

  const next = nextDueBoundary(terms, now, cutoff)
  if (!next) return []
  await wipe(next.termId, next.marker, now)
  return [next.label]
}
