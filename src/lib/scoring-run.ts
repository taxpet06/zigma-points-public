// Zigma Maxxer scoring — the DB half. Collects every raw metric for a term, hands the
// field to lib/scoring.ts to normalise and rank, writes the board to term_scores, and
// crowns the winner. lib/scoring.ts holds the weights and the maths; nothing here
// decides what anything is worth.
//
// SHAPE. Every collector below aggregates across ALL users in one query rather than
// looping per user, so the query count is fixed (~30) no matter how many members the
// club has. They run in parallel batches — the whole thing has to finish inside
// Vercel's 10s function budget, since it is called from the settle cron.
//
// TERM FILTERING. Post, Task and the six competitive run tables carry a termId stamp,
// so they filter on indexed equality. Everything else (votes, replies, transfers,
// listings, casino bets, cosmetics, the day-keyed dailies) predates the stamp and
// filters on createdAt — or on the `day` string for the day-keyed tables — against the
// term's window. Getting that split wrong is silent, so each collector says which it is.

import { db } from "@/lib/db"
import { dayKey } from "@/lib/day-key"
import { getCosmetic } from "@/lib/cosmetics"
import { RARITY_SCORE, scoreUsers, winnerOf, type RawMetrics, type ScoredUser } from "@/lib/scoring"

type Window = { termId: string; startsAt: Date; endsAt: Date }

/** What the six competitive run tables yield, fetched ONCE per scoreTerm and shared by
 *  the economy and games collectors. Querying them twice was 6 redundant round trips —
 *  measurable against production, where the whole pass shares a cron timeout budget. */
type RunTotals = Awaited<ReturnType<typeof runEarnings>>

/** Accumulator: userId -> running number. Missing means zero. */
type Tally = Map<string, number>

function add(t: Tally, userId: string | null | undefined, n: number) {
  if (!userId || !Number.isFinite(n)) return
  t.set(userId, (t.get(userId) ?? 0) + n)
}

function get(t: Tally, userId: string): number {
  return t.get(userId) ?? 0
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

/** Community. Posts authored are quality-weighted per post rather than by an overall
 *  pass rate: a rate needs a denominator, and REGULAR posts have no verdict to divide
 *  by. An Awarded post is worth 1.5, a Rejected one 0.5, anything unsettled or REGULAR
 *  1.0 — so posting well beats posting often, without punishing plain social posts. */
async function collectCommunity(w: Window) {
  const [posts, votesCast, targeted, repliesWritten] = await Promise.all([
    // termId-stamped
    db.post.findMany({
      where: { termId: w.termId },
      select: {
        authorId: true,
        outcome: true,
        votes: { select: { type: true, userId: true } },
      },
    }),
    // createdAt-windowed
    db.vote.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: w.startsAt, lte: w.endsAt } },
      _count: { _all: true },
    }),
    // termId-stamped via the post; distinct AUTHORS, so one person posting about you
    // fifteen times counts once.
    db.postTarget.findMany({
      where: { post: { termId: w.termId } },
      select: { userId: true, post: { select: { authorId: true } } },
    }),
    // createdAt-windowed
    db.reply.groupBy({
      by: ["authorId"],
      where: { createdAt: { gte: w.startsAt, lte: w.endsAt } },
      _count: { _all: true },
    }),
  ])

  const authored: Tally = new Map()
  const success: Tally = new Map()
  for (const p of posts) {
    add(authored, p.authorId, p.outcome === "Awarded" ? 1.5 : p.outcome === "Rejected" ? 0.5 : 1)
    let net = 0
    const voters = new Set<string>()
    for (const v of p.votes) {
      net += v.type === "AGREE" ? 1 : -1
      voters.add(v.userId)
    }
    // Net agreement AND reach: a post nobody looked at and a post that split the room
    // are both less successful than one that pulled a crowd and won it.
    add(success, p.authorId, net + voters.size)
  }

  const aboutAuthors = new Map<string, Set<string>>()
  for (const t of targeted) {
    if (!aboutAuthors.has(t.userId)) aboutAuthors.set(t.userId, new Set())
    aboutAuthors.get(t.userId)!.add(t.post.authorId)
  }
  const about: Tally = new Map()
  for (const [userId, authors] of aboutAuthors) about.set(userId, authors.size)

  // Replies received: replies by OTHER people on your posts and your betting pools.
  // Counted from the same windowed reply set, attributed to the content's owner.
  const received: Tally = new Map()
  const inbound = await db.reply.findMany({
    where: { createdAt: { gte: w.startsAt, lte: w.endsAt } },
    select: {
      authorId: true,
      post: { select: { authorId: true } },
      task: { select: { adminId: true } },
    },
  })
  for (const r of inbound) {
    const owner = r.post?.authorId ?? r.task?.adminId
    if (owner && owner !== r.authorId) add(received, owner, 1)
  }

  const written: Tally = new Map(repliesWritten.map((r) => [r.authorId, r._count._all]))
  const votes: Tally = new Map(votesCast.map((v) => [v.userId, v._count._all]))

  return { authored, success, votes, about, written, received }
}

/** Economy. zpEarned is inflow reconstructed from every source that MINTS ZP, because
 *  there is no ZP ledger — User.zigmaPoints is a mutable counter that admin.updateBalance
 *  can set to anything with no row written anywhere. Balance alone would also punish
 *  everyone who actually spent their ZP on lootboxes, bets and replays, which is most of
 *  the point of having it. Admin adjustments are unrecoverable and simply not counted.
 *
 *  Peer transfers and cosmetic sales are excluded on purpose — see the comment at the
 *  marketplace tally below. */
async function collectEconomy(w: Window, runs: RunTotals) {
  const win = { createdAt: { gte: w.startsAt, lte: w.endsAt } }
  const days = { day: { gte: dayKey(w.startsAt), lte: dayKey(w.endsAt) } }

  const [
    awarded,
    completions,
    wordle,
    minez,
    axa,
    betPayouts,
    casinoPayouts,
    transfers,
    listingsSold,
    listingsBought,
    users,
  ] = await Promise.all([
    // AWARD posts that passed pay zpAmount to EACH target. DEDUCT posts move ZP the
    // other way and are not inflow, so they are not counted here.
    db.postTarget.findMany({
      where: { post: { termId: w.termId, type: "AWARD", outcome: "Awarded" } },
      select: { userId: true, post: { select: { zpAmount: true } } },
    }),
    db.taskCompletion.groupBy({
      by: ["userId"],
      where: { ...win, status: "AWARDED" },
      _sum: { awardedZp: true },
    }),
    db.wordleResult.groupBy({ by: ["userId"], where: days, _sum: { zp: true } }),
    db.minezweeperResult.groupBy({ by: ["userId"], where: days, _sum: { zp: true } }),
    db.bombAxaWin.groupBy({ by: ["userId"], where: days, _sum: { zp: true } }),
    db.taskBet.groupBy({ by: ["userId"], where: win, _sum: { payout: true } }),
    db.casinoBet.groupBy({ by: ["userId"], where: win, _sum: { payout: true, wager: true } }),
    // Both directions in one read — marketplace needs the counterparty on each row,
    // which a groupBy by one side cannot give.
    db.transfer.findMany({
      where: { ...win, status: "APPROVED" },
      select: { fromUserId: true, toUserId: true, repaidAt: true },
    }),
    db.listing.groupBy({ by: ["sellerId"], where: { ...win, status: "SOLD" }, _count: { _all: true } }),
    db.listing.groupBy({ by: ["buyerId"], where: { ...win, status: "SOLD" }, _count: { _all: true } }),
    // Only people who already existed when the term ended are on its board. An account
    // created afterwards did not compete in it, and every extra zero in the field pushes
    // everyone else's percentile up, inflating published totals as the club grows.
    db.user.findMany({
      where: { createdAt: { lte: w.endsAt } },
      select: { id: true, zigmaPoints: true, role: true },
    }),
  ])

  const earned: Tally = new Map()
  for (const t of awarded) add(earned, t.userId, t.post.zpAmount)
  for (const c of completions) add(earned, c.userId, c._sum.awardedZp ?? 0)
  // Slot-machine ZP is NOT counted. The spin is uncapped, so gross slot payout ranks
  // people by how many times they pulled the lever — 645,507 times, in one case, which
  // is a script rather than a player. Every other source here is bounded by something
  // real (one board a day, one settled post, one run's score), so they stay.
  for (const rows of [wordle, minez, axa]) {
    for (const r of rows) add(earned, r.userId, r._sum.zp ?? 0)
  }
  for (const [userId, zp] of runs.earned) add(earned, userId, zp)
  for (const b of betPayouts) add(earned, b.userId, b._sum.payout ?? 0)
  for (const c of casinoPayouts) add(earned, c.userId, c._sum.payout ?? 0)
  // Peer transfers and cosmetic sales are deliberately NOT inflow. Both are MOVES, not
  // earnings: nothing is minted, and counting the receiving side gross made zpEarned —
  // the single heaviest metric at 10 points — farmable by two people bouncing the same
  // ZP back and forth all evening. A gift is also not something you earned.

  // Marketplace = participation in the player-to-player economy, counted as DISTINCT
  // COUNTERPARTIES rather than events, for the same reason pools count distinct backers
  // and posts-about-you counts distinct authors: round-tripping with one friend is one
  // relationship however many times you do it.
  const partners = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!partners.has(a)) partners.set(a, new Set())
    partners.get(a)!.add(b)
  }
  const marketplace: Tally = new Map()
  for (const t of transfers) {
    link(t.fromUserId, t.toUserId)
    link(t.toUserId, t.fromUserId)
    // A loan the borrower cleared — repaidAt set means the cron collected it, which is
    // the only repayment signal the schema has. Reliability bonus, one per loan.
    if (t.repaidAt) add(marketplace, t.toUserId, 1)
  }
  for (const [userId, others] of partners) add(marketplace, userId, others.size)
  for (const l of listingsSold) add(marketplace, l.sellerId, l._count._all)
  for (const l of listingsBought) add(marketplace, l.buyerId, l._count._all)

  const balance: Tally = new Map(users.map((u) => [u.id, u.zigmaPoints]))
  const casinoNet: Tally = new Map(
    casinoPayouts.map((c) => [c.userId, (c._sum.payout ?? 0) - (c._sum.wager ?? 0)]),
  )

  return { earned, balance, marketplace, casinoNet, users }
}

/** The six competitive run tables, which all share a shape: termId stamp, zpEarned,
 *  and a dailyPrizeZp that is non-null exactly when the run took an end-of-day podium. */
async function runEarnings(w: Window) {
  const where = { termId: w.termId }
  const select = { userId: true, zpEarned: true, dailyPrizeZp: true }
  const [flappy, tetris, znake, zross, sequence, insa] = await Promise.all([
    db.flappyRun.findMany({ where, select }),
    db.tetrisRun.findMany({ where, select }),
    db.znakeRun.findMany({ where, select }),
    db.zrossRun.findMany({ where, select }),
    db.sequenceRecallRun.findMany({ where, select }),
    db.insamotherfuckingllahRun.findMany({ where, select }),
  ])

  const earned: Tally = new Map()
  const podiums: Tally = new Map()
  const played = new Map<string, Set<number>>() // userId -> which of the six games
  const tables = [flappy, tetris, znake, zross, sequence, insa]

  tables.forEach((rows, gameIndex) => {
    for (const r of rows) {
      add(earned, r.userId, r.zpEarned + (r.dailyPrizeZp ?? 0))
      if (r.dailyPrizeZp !== null) add(podiums, r.userId, 1)
      if (!played.has(r.userId)) played.set(r.userId, new Set())
      played.get(r.userId)!.add(gameIndex)
    }
  })

  return { earned, podiums, played }
}

/** Games. Breadth counts DISTINCT games touched — the six competitive runs, the four
 *  dailies, each casino game, and JJ — so trying everything beats farming one thing.
 *
 *  dailyGames counts DISTINCT DAYS PLAYED, never raw plays. These are daily games:
 *  FREE_PLAYS_PER_DAY is 1 and Wordle/MineZweeper/Bomb AXA enforce that with a
 *  @@unique([userId, day]), so for them a row IS a day. Only the slot machine allows
 *  unlimited paid replays, and counting its rows made the metric a lever-pull leaderboard
 *  — one account logged 645,507 spins against a field median under 60. Showing up daily
 *  is the thing worth scoring; sitting on the button is not. */
async function collectGames(w: Window, runs: RunTotals) {
  const days = { day: { gte: dayKey(w.startsAt), lte: dayKey(w.endsAt) } }
  const win = { createdAt: { gte: w.startsAt, lte: w.endsAt } }

  const [wordle, minez, axa, daily, casino, pets] = await Promise.all([
    db.wordleResult.groupBy({ by: ["userId"], where: days, _count: { _all: true } }),
    db.minezweeperResult.groupBy({ by: ["userId"], where: days, _count: { _all: true } }),
    db.bombAxaWin.groupBy({ by: ["userId"], where: days, _count: { _all: true } }),
    // by day as well as user: the slot machine is the one daily game that allows
    // unlimited paid replays, so its row count is a lever-pull count, not a days-played
    // count. Grouping by day collapses a thousand spins on one day back to one day.
    db.dailyReward.groupBy({ by: ["userId", "day"], where: days }),
    db.casinoBet.groupBy({ by: ["userId", "game"], where: win, _count: { _all: true } }),
    db.jjPet.findMany({ select: { userId: true, streak: true, alive: true } }),
  ])

  const dailyGames: Tally = new Map()
  const breadth = new Map<string, Set<string>>()
  // daily is grouped by (userId, day), so one entry per user per day played.
  const touch = (userId: string, game: string) => {
    if (!breadth.has(userId)) breadth.set(userId, new Set())
    breadth.get(userId)!.add(game)
  }

  for (const [userId, games] of runs.played) {
    for (const g of games) touch(userId, `run:${g}`)
  }
  // Wordle / MineZweeper / Bomb AXA are one row per user per day by constraint, so
  // their row count already IS a days-played count.
  const oncePerDay: [string, { userId: string; _count: { _all: number } }[]][] = [
    ["wordle", wordle],
    ["minezweeper", minez],
    ["bombaxa", axa],
  ]
  for (const [name, rows] of oncePerDay) {
    for (const r of rows) {
      add(dailyGames, r.userId, r._count._all)
      touch(r.userId, name)
    }
  }
  // Slots: one (userId, day) group = one day played, however many times the lever moved.
  for (const r of daily) {
    add(dailyGames, r.userId, 1)
    touch(r.userId, "slots")
  }
  for (const c of casino) touch(c.userId, `casino:${c.game}`)
  for (const p of pets) if (p.streak > 0) touch(p.userId, "jj")

  const gameBreadth: Tally = new Map()
  for (const [userId, games] of breadth) gameBreadth.set(userId, games.size)

  // JJ's streak is the CURRENT run ending at lastFedDay — JjPet keeps no per-day rows,
  // so a max streak is simply not reconstructable. A 40-day run broken in week 9 reads
  // as a small number here. That lossiness is why the metric only carries 2 points.
  const jjStreak: Tally = new Map(pets.map((p) => [p.userId, p.streak + (p.alive ? 1 : 0)]))

  return { podiums: runs.podiums, gameBreadth, dailyGames, jjStreak }
}

/** Consistency. One raw UNION over every timestamped table beats a dozen round trips,
 *  and the day bucket has to be computed in RESET_TZ so it agrees with the `day` string
 *  columns the daily games already key off.
 *
 *  BOTH `AT TIME ZONE` clauses are load-bearing and the order matters. Prisma maps
 *  DateTime to `timestamp WITHOUT time zone` holding UTC, so a single
 *  `AT TIME ZONE 'America/New_York'` would READ the naive value as New York wall time
 *  and shift it the wrong way — 18:00 UTC came out as 22:00, pushing everything logged
 *  after 20:00 UTC (peak usage) onto the next calendar day. `AT TIME ZONE 'UTC'` first
 *  stamps it as the UTC instant it actually is; the second renders that instant in
 *  RESET_TZ. Verified against the DB: 18:00 UTC -> 14:00 New York. */
async function collectConsistency(w: Window) {
  const crunchFrom = new Date(w.endsAt.getTime() - 3 * 24 * 60 * 60 * 1000)

  // GROUP BY in Postgres, not in JS. Returning one row per activity EVENT meant
  // streaming 753,794 rows out of production for a 28-person club — 4.3s of a ~4.6s
  // scoring pass, on a route that shares a cron timeout budget. The three numbers this
  // collector actually needs are all aggregates, so they are computed server-side and
  // come back as one row per user.
  const rows = await db.$queryRaw<
    { userId: string; active_days: string; total: string; late: string }[]
  >`
    SELECT "userId",
           count(DISTINCT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) AS active_days,
           count(*) AS total,
           count(*) FILTER (WHERE "createdAt" >= ${crunchFrom}) AS late
    FROM (
      SELECT "authorId" AS "userId", "createdAt" FROM posts
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM votes
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "authorId", "createdAt" FROM replies
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM casino_bets
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM task_bets
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM daily_rewards
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM wordle_results
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM minezweeper_results
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM bomb_axa_wins
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "createdAt" FROM cosmetic_purchases
        WHERE "createdAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "startedAt" FROM "FlappyRun"
        WHERE "startedAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "startedAt" FROM "TetrisRun"
        WHERE "startedAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "startedAt" FROM "ZnakeRun"
        WHERE "startedAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "startedAt" FROM "ZrossRun"
        WHERE "startedAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "startedAt" FROM "SequenceRecallRun"
        WHERE "startedAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
      UNION ALL
      SELECT "userId", "startedAt" FROM "InsamotherfuckingllahRun"
        WHERE "startedAt" BETWEEN ${w.startsAt} AND ${w.endsAt}
    ) AS activity
    GROUP BY "userId"
  `

  const activeDays: Tally = new Map()
  const antiCrunch: Tally = new Map()
  for (const r of rows) {
    // count() is bigint, which the Neon driver hands back as a string.
    const total = Number(r.total)
    activeDays.set(r.userId, Number(r.active_days))
    // Share of the term's activity that happened BEFORE the final three days. Someone
    // who played all term scores ~1; someone who binged the last weekend scores ~0.
    // A share, not a count, so it measures spread rather than volume — volume is
    // already scored by activeDays and by every pillar above.
    if (total > 0) antiCrunch.set(r.userId, (total - Number(r.late)) / total)
  }

  return { activeDays, antiCrunch }
}

/** Collection. Ownership is a SNAPSHOT at scoring time, not a term-windowed event log:
 *  "cosmetics owned out of 30" is a state, and copies change hands. Scoring a term long
 *  after it closed can therefore shift this pillar — acceptable, since scoring runs
 *  automatically the moment the term ends. */
async function collectCollection() {
  const [copies, users] = await Promise.all([
    db.cosmeticPurchase.findMany({ select: { userId: true, slug: true, mintNumber: true } }),
    db.user.findMany({
      select: {
        id: true,
        username: true,
        image: true,
        bio: true,
        equippedBackground: true,
        equippedRing: true,
        equippedTitle: true,
      },
    }),
  ])

  const slugsByUser = new Map<string, Set<string>>()
  const depth: Tally = new Map()
  for (const c of copies) {
    if (!slugsByUser.has(c.userId)) slugsByUser.set(c.userId, new Set())
    const seen = slugsByUser.get(c.userId)!
    if (seen.has(c.slug)) add(depth, c.userId, 1) // a duplicate copy
    seen.add(c.slug)
    if (c.mintNumber <= 3) add(depth, c.userId, 1) // an early mint of anything
  }

  const cosmeticRarity: Tally = new Map()
  for (const [userId, slugs] of slugsByUser) {
    let sum = 0
    for (const slug of slugs) {
      const cosmetic = getCosmetic(slug)
      if (cosmetic) sum += RARITY_SCORE[cosmetic.rarity]
    }
    cosmeticRarity.set(userId, sum)
  }

  // 0-6 checklist. Saturates fast, which is the intent: it lifts the floor for anyone
  // who actually set their account up rather than separating the top of the field.
  const profile: Tally = new Map(
    users.map((u) => [
      u.id,
      [u.username, u.image, u.bio?.trim(), u.equippedBackground, u.equippedRing, u.equippedTitle]
        .filter(Boolean).length,
    ]),
  )

  return { cosmeticRarity, depth, profile }
}

/** Betting. A pool is scored by the DISTINCT BACKERS it attracted, not by existing —
 *  otherwise spinning up twenty dead pools is the cheapest metric in the rubric. */
async function collectBetting(w: Window, casinoNet: Tally) {
  const win = { createdAt: { gte: w.startsAt, lte: w.endsAt } }

  const [pools, bets, casino] = await Promise.all([
    db.task.findMany({
      where: { termId: w.termId, kind: "BET" },
      select: { adminId: true, _count: { select: { bets: true } } },
    }),
    db.taskBet.findMany({ where: win, select: { userId: true, payout: true } }),
    db.casinoBet.groupBy({ by: ["userId", "game"], where: win, _count: { _all: true } }),
  ])

  const poolsCreated: Tally = new Map()
  for (const p of pools) add(poolsCreated, p.adminId, p._count.bets)

  const betsPlayed: Tally = new Map()
  for (const b of bets) {
    add(betsPlayed, b.userId, 1)
    if ((b.payout ?? 0) > 0) add(betsPlayed, b.userId, 1) // winning counts twice
  }

  // Volume is capped so a whale dumping their balance into Plinko on the last night
  // cannot buy the metric; breadth of games tried is added on top.
  const CASINO_CAP = 200
  const volume: Tally = new Map()
  const gamesTried: Tally = new Map()
  for (const c of casino) {
    add(volume, c.userId, c._count._all)
    add(gamesTried, c.userId, 1)
  }
  const casinoActivity: Tally = new Map()
  for (const [userId, n] of volume) {
    casinoActivity.set(userId, Math.min(n, CASINO_CAP) + get(gamesTried, userId))
  }

  return { poolsCreated, betsPlayed, casinoActivity, casinoRoi: casinoNet }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** True when `termId` is the most recently ENDED term — the only term entitled to own
 *  the global crown. Scoring or re-scoring anything older must leave the current
 *  Maxxer's crown alone; without this, an admin previewing a term from March would
 *  quietly take the crown off the person who just won August. */
async function ownsGlobalCrown(termId: string, now: Date): Promise<boolean> {
  const latest = await db.term.findFirst({
    where: { endsAt: { lte: now } },
    orderBy: { endsAt: "desc" },
    select: { id: true },
  })
  return latest?.id === termId
}

/**
 * Score one term end to end: collect, rank, persist, and — only for the most recently
 * ended term — crown.
 *
 * Idempotent by REPLACEMENT, not by refusal — the whole term's rows are deleted and
 * rewritten inside one transaction, so a re-run (the admin button) always leaves
 * exactly one consistent board and never a half-updated one. The caller is what
 * decides whether a re-run is allowed; see scoreEndedTerms().
 *
 * Sends no notification of any kind. The winner is read out of the DB by hand.
 */
export async function scoreTerm(
  termId: string,
  /** Collect and rank, but write NOTHING. Used to verify a term's board against real
   *  data before committing to it — including against production, where a plain run
   *  would set winnerId and move the crown. */
  opts: { dryRun?: boolean } = {},
): Promise<{ scored: number; winnerId: string | null; board: ScoredUser[] }> {
  const term = await db.term.findUnique({
    where: { id: termId },
    select: { id: true, startsAt: true, endsAt: true },
  })
  if (!term) throw new Error(`scoreTerm: no term ${termId}`)
  const w: Window = { termId: term.id, startsAt: term.startsAt, endsAt: term.endsAt }

  // The six run tables feed both the economy and games pillars — fetch them once and
  // hand the same result to both, rather than paying for 6 duplicate queries.
  const runs = await runEarnings(w)
  const disqualified = new Set(
    (await db.termPooper.findMany({ where: { termId }, select: { userId: true } })).map(
      (p) => p.userId,
    ),
  )

  const [community, economy, games, consistency, collection] = await Promise.all([
    collectCommunity(w),
    collectEconomy(w, runs),
    collectGames(w, runs),
    collectConsistency(w),
    collectCollection(),
  ])
  const betting = await collectBetting(w, economy.casinoNet)

  const raw: RawMetrics[] = economy.users.map((u) => ({
    userId: u.id,
    isAdmin: u.role === "ADMIN",
    isDisqualified: disqualified.has(u.id),
    postsAuthored: get(community.authored, u.id),
    postSuccess: get(community.success, u.id),
    votesCast: get(community.votes, u.id),
    postsAboutYou: get(community.about, u.id),
    replies: 0.7 * get(community.written, u.id) + 0.3 * get(community.received, u.id),
    zpEarned: get(economy.earned, u.id),
    zpBalance: get(economy.balance, u.id),
    marketplace: get(economy.marketplace, u.id),
    podiums: get(games.podiums, u.id),
    gameBreadth: get(games.gameBreadth, u.id),
    dailyGames: get(games.dailyGames, u.id),
    activeDays: get(consistency.activeDays, u.id),
    antiCrunch: get(consistency.antiCrunch, u.id),
    jjStreak: get(games.jjStreak, u.id),
    cosmeticRarity: get(collection.cosmeticRarity, u.id),
    cosmeticDepth: get(collection.depth, u.id),
    profile: get(collection.profile, u.id),
    poolsCreated: get(betting.poolsCreated, u.id),
    betsPlayed: get(betting.betsPlayed, u.id),
    casinoActivity: get(betting.casinoActivity, u.id),
    casinoRoi: get(betting.casinoRoi, u.id),
  }))

  const scored = scoreUsers(raw)
  const winnerId = winnerOf(scored)
  if (opts.dryRun) return { scored: scored.length, winnerId, board: scored }

  // A term still in progress gets a BOARD but no winner. term.runScoring deliberately
  // allows a mid-term standings preview, and Term.winnerId is not a private note: it
  // feeds User.termsWon, which renders a MaxxerTrophy on that user's profile and on
  // every People card. Writing it early hands out a trophy for a term nobody has won.
  const now = new Date()
  const termEnded = term.endsAt <= now
  const crowns = termEnded && (await ownsGlobalCrown(termId, now))

  await db.$transaction([
    db.termScore.deleteMany({ where: { termId } }),
    db.termScore.createMany({
      data: scored.map((s) => ({
        termId,
        userId: s.userId,
        rank: s.rank,
        total: s.total,
        community: s.pillars.community,
        economy: s.pillars.economy,
        games: s.pillars.games,
        consistency: s.pillars.consistency,
        collection: s.pillars.collection,
        betting: s.pillars.betting,
        activeDays: s.activeDays,
        // Int32 column. Summed inflow is unbounded in principle — one account already
        // logged 645,507 automated slot spins this term — and an overflow would throw
        // inside the transaction, leaving the term unscored and the cron retrying the
        // identical failure every 15 minutes forever.
        zpEarned: Math.min(Math.round(s.zpEarned), 2_147_483_647),
      })),
    }),
    // Preview of a running term: scores only, no winner, no trophy.
    ...(termEnded ? [db.term.update({ where: { id: termId }, data: { winnerId } })] : []),
    // The crown is global — at most one holder app-wide — so it is cleared everywhere
    // then set once, exactly as term.setWinner does it. Clearing happens even when there
    // is no eligible winner, so the app never shows a crown belonging to nobody.
    // Only the latest ended term touches it at all (see ownsGlobalCrown).
    ...(crowns
      ? [
          db.user.updateMany({ where: { hasCrown: true }, data: { hasCrown: false } }),
          ...(winnerId
            ? [db.user.update({ where: { id: winnerId }, data: { hasCrown: true } })]
            : []),
        ]
      : []),
  ])

  return { scored: scored.length, winnerId: termEnded ? winnerId : null, board: scored }
}

/** How far back the automatic pass will reach. A term that ended inside this window
 *  is "just ended" and gets scored; anything older is history and is left alone.
 *
 *  Without this the FIRST tick after deploy would backfill every term ever — including
 *  ones that predate cosmetics, the game hub and the casino, whose windowed metrics are
 *  all zero and whose board would therefore be decided by present-day snapshots and,
 *  once tied at zero, by the userId tiebreak. It would also overwrite `winnerId` on
 *  terms whose winner an admin declared by hand. Two weeks is long enough to survive an
 *  outage over a term boundary; anything older is the admin button's job.
 *
 *  Sized against the real inter-term gap, not a round number: 26X ends 25 Aug and 26F
 *  opens 11 Sep — 17 days — and the app is deliberately shut down in between to save
 *  database cost. A 14-day window would have expired three days BEFORE the cron came
 *  back up, so a term nobody scored would silently stay unscored. 30 days clears that
 *  gap with room while still excluding 26S (ended 31 May, ~86 days back). Widen this if
 *  a future break is ever longer than a month. */
const AUTO_SCORE_WINDOW_DAYS = 30

/**
 * Score the terms that have just ended and have no post-close board yet. Called from
 * the settle cron AFTER its settlement sweep, so a post whose voting window ran into
 * the end of the term has already moved its ZP before balances are read.
 *
 * Scores AT MOST ONE term per invocation, oldest first. Each pass is ~35 queries
 * including a 16-way UNION, and the cron shares a 10s Vercel budget with the settlement
 * transaction and the Serializable loan sweep — two passes in one tick risks a platform
 * timeout, which no try/catch can catch and which would retry the same oversized
 * workload forever. The next tick (15 minutes later) picks up the next term.
 *
 * "Already scored" means a board written AT OR AFTER the term's endsAt — not merely the
 * existence of rows. An admin previewing standings mid-term writes rows too, and a bare
 * existence check would let that preview permanently suppress the real post-close run.
 */
export async function unscoredEndedTerms(now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - AUTO_SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const ended = await db.term.findMany({
    where: { endsAt: { lte: now, gte: cutoff } },
    select: { id: true, name: true, endsAt: true },
  })
  if (ended.length === 0) return []
  const boards = await db.termScore.groupBy({
    by: ["termId"],
    where: { termId: { in: ended.map((t) => t.id) } },
    _max: { createdAt: true },
  })
  const scoredAt = new Map(boards.map((b) => [b.termId, b._max.createdAt]))
  return ended
    .filter((t) => {
      const at = scoredAt.get(t.id)
      return !at || at < t.endsAt
    })
    .map((t) => t.name)
}

export async function scoreEndedTerms(now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - AUTO_SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const ended = await db.term.findMany({
    where: { endsAt: { lte: now, gte: cutoff } },
    // Oldest first, so when several are pending the crown lands on the most recent one
    // last. ownsGlobalCrown is the real guard, but the ordering keeps the writes sane.
    orderBy: { endsAt: "asc" },
    select: { id: true, endsAt: true },
  })
  if (ended.length === 0) return []

  const boards = await db.termScore.groupBy({
    by: ["termId"],
    where: { termId: { in: ended.map((t) => t.id) } },
    _max: { createdAt: true },
  })
  const scoredAt = new Map(boards.map((b) => [b.termId, b._max.createdAt]))

  for (const term of ended) {
    const at = scoredAt.get(term.id)
    if (at && at >= term.endsAt) continue // already has a real post-close board
    await scoreTerm(term.id)
    return [term.id] // one per tick — see the budget note above
  }
  return []
}
