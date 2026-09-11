// Zigma Maxxer scoring — the pure half. No DB imports, so it is trivially testable
// and the weights can be read without tracing a query. lib/scoring-run.ts collects the
// raw numbers from Postgres and calls scoreUsers() below.
//
// THE MODEL. Every metric is normalised to a percentile among the scored field, then
// multiplied by its weight. Percentiles rather than raw values or min-max because the
// metrics live on wildly different scales (ZP in the thousands, cosmetics 0-30, JJ
// streak 0-70) and because one whale would flatten a min-max field to ~0 for everyone
// else. The cost is that a 10x lead scores the same as a 1 ZP lead — the right trade
// for a club award, where "you beat 84% of the field" is the sentence that has to
// survive being argued with.

/** Cosmetic rarity score — the TAME curve, not the inverse-odds one.
 *
 *  True inverse drop odds (RARITY_WEIGHT in lib/cosmetics.ts: 13.5/6/1) would make a
 *  legendary worth 13.5 commons, so a single lucky box decides the whole pillar. These
 *  are the sqrt-flattened equivalents: still ordered by scarcity, but a legendary is
 *  worth ~4 commons instead of ~14. */
export const RARITY_SCORE = { COMMON: 1, RARE: 1.5, LEGENDARY: 3.7 } as const

/** Weight of every metric, grouped by the pillar it rolls up into. Pillar totals are
 *  29/18/18/12/12/11 = 100. These are the v2 rubric's weights with the dropped
 *  execs-attendance pillar (15) redistributed proportionally across the survivors.
 *
 *  Adding a metric means adding it here AND to RawMetrics — the type makes the second
 *  half non-optional, so a metric can never be collected and silently not counted. */
export const WEIGHTS = {
  community: { postsAuthored: 9, postSuccess: 6, votesCast: 6, postsAboutYou: 5, replies: 3 },
  economy: { zpEarned: 10, zpBalance: 5, marketplace: 3 },
  games: { podiums: 8, gameBreadth: 5, dailyGames: 5 },
  consistency: { activeDays: 6, antiCrunch: 4, jjStreak: 2 },
  collection: { cosmeticRarity: 7, cosmeticDepth: 3, profile: 2 },
  betting: { poolsCreated: 5, betsPlayed: 3, casinoActivity: 2, casinoRoi: 1 },
} as const

export type Pillar = keyof typeof WEIGHTS

export const PILLARS = Object.keys(WEIGHTS) as Pillar[]

/** Every metric name across every pillar — the keys RawMetrics must supply. */
type MetricKey = { [P in Pillar]: keyof (typeof WEIGHTS)[P] }[Pillar]

/** One user's raw, un-normalised numbers for a term. Collected by lib/scoring-run.ts.
 *  Higher is always better for every field (casinoRoi can be negative; see percentiles). */
export type RawMetrics = Record<MetricKey, number> & {
  userId: string
  /** Admins are scored and ranked, but can never be the winner — they can set arbitrary
   *  balances via admin.updateBalance with no ledger row, so their ZP is unauditable. */
  isAdmin: boolean
  /** A Zigma Pooper: disqualified by an admin for this term. Scored and ranked like
   *  anyone else — being disqualified is a visible outcome, not an erasure — but never
   *  eligible to be the Maxxer. */
  isDisqualified: boolean
}

export type ScoredUser = {
  userId: string
  isAdmin: boolean
  isDisqualified: boolean
  rank: number
  total: number
  pillars: Record<Pillar, number>
  activeDays: number
  zpEarned: number
}

/**
 * Percentile of each value within its own field, as "fraction of the field you beat",
 * in [0, 1].
 *
 * Ties are averaged, so identical performance always scores identically. Two rules sit
 * on top of the textbook fractional rank:
 *
 *   - A value of 0 or less scores 0, even when others tie it. Averaging ties would
 *     otherwise hand 20-odd percent of a metric's weight to everyone who never touched
 *     it, purely for having company. Doing none of a thing earns none of its points.
 *     (This is also what makes a net-losing casinoRoi score 0 rather than negative.)
 *   - A field where every value is identical scores 0 for everyone: nobody
 *     differentiated themselves, so the metric carries no information and should not
 *     inflate the published out-of-100 total. Rankings are unaffected either way.
 *
 * ponytail: O(n^2). n is the member count of a club — a couple of dozen. Sort and
 * sweep if it ever runs on thousands.
 */
export function percentiles(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [values[0] > 0 ? 1 : 0]

  let lo = values[0]
  let hi = values[0]
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (lo === hi) return values.map(() => 0)

  return values.map((v) => {
    if (v <= 0) return 0
    let below = 0
    let equal = 0
    for (const other of values) {
      if (other < v) below++
      else if (other === v) equal++
    }
    return (below + 0.5 * (equal - 1)) / (n - 1)
  })
}

/**
 * Normalise, weight, and rank a whole term's field in one pass.
 *
 * Ordering is total desc, then the tiebreak chain: community pillar, then active days,
 * then ZP earned, then userId for a stable final answer (two users identical on all
 * four would otherwise rank by whatever order Postgres returned them in, and the same
 * term could score differently on a re-run).
 *
 * Returns every user including admins, ranked. Picking the winner is the caller's job
 * — see winnerOf().
 */
export function scoreUsers(raw: RawMetrics[]): ScoredUser[] {
  if (raw.length === 0) return []

  // Percentile each metric across the whole field, once, then read them back per user.
  const pct = {} as Record<MetricKey, number[]>
  for (const pillar of PILLARS) {
    for (const metric of Object.keys(WEIGHTS[pillar]) as MetricKey[]) {
      pct[metric] = percentiles(raw.map((r) => r[metric]))
    }
  }

  const scored = raw.map((r, i) => {
    const pillars = {} as Record<Pillar, number>
    let total = 0
    for (const pillar of PILLARS) {
      const weights: Record<string, number> = WEIGHTS[pillar]
      let sum = 0
      for (const metric of Object.keys(weights)) {
        sum += weights[metric] * pct[metric as MetricKey][i]
      }
      pillars[pillar] = round2(sum)
      // Accumulate the ROUNDED pillar, not the raw one, so the admin Podium's six
      // columns always add up to the total printed beside them. That table exists to
      // make a placing contestable, and "your numbers don't sum" is the first
      // objection it would otherwise invite.
      total += pillars[pillar]
    }
    return {
      userId: r.userId,
      isAdmin: r.isAdmin,
      isDisqualified: r.isDisqualified,
      rank: 0,
      total: round2(total),
      pillars,
      activeDays: r.activeDays,
      zpEarned: r.zpEarned,
    }
  })

  scored.sort(
    (a, b) =>
      b.total - a.total ||
      b.pillars.community - a.pillars.community ||
      b.activeDays - a.activeDays ||
      b.zpEarned - a.zpEarned ||
      a.userId.localeCompare(b.userId),
  )
  scored.forEach((s, i) => {
    s.rank = i + 1
  })
  return scored
}

/** The term's Zigma Maxxer: the highest-ranked user who is neither an admin nor a
 *  Zigma Pooper. Null when nobody qualifies — the term simply has no winner rather
 *  than crowning someone whose balance nobody can audit, or someone the admins
 *  disqualified. Both exclusions skip the user without changing anyone's rank: a
 *  disqualified account still occupies its place on the board. */
export function winnerOf(scored: ScoredUser[]): string | null {
  return scored.find((s) => !s.isAdmin && !s.isDisqualified)?.userId ?? null
}

/** Two decimals is the resolution the Podium renders at; storing more invites arguments
 *  about a difference nobody can see. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
