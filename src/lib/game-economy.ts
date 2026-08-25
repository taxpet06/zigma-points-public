// Single source of truth for what every game pays and what a replay costs.
// Imported by the routers (which enforce it), the hub tabs, and every game modal
// (the "how ZP works here" copy) — so the rules on screen are the rules on the server.

/** Free, ZP-earning attempts per game per day. Everything past this is a paid replay. */
export const FREE_PLAYS_PER_DAY = 1

/** Which run rows count against the daily free-play allowance. A run that FINISHED
 *  (ENDED or ABANDONED — both stamp endedAt) without a single point on the board was
 *  opened and closed, never played, and must not burn the day's free run. An unfinished
 *  run always counts, so two concurrent start()s can't both come out free.
 *  Spread into the `where` of every runs-today count — getStatus and start must agree
 *  or the card promises a free run that start() then charges for. */
export const PLAYED_RUN_WHERE = { NOT: { endedAt: { not: null }, zpEarned: 0 } }

/** Petris' variant: its points come from drops, its ZP only from cleared lines, so
 *  zpEarned 0 doesn't mean "unplayed" there. `score` is its board metric. */
export const PLAYED_TETRIS_RUN_WHERE = { NOT: { endedAt: { not: null }, score: 0 } }

/** ZP debited to replay a competitive game. Paid runs rank on the leaderboard but bank 0 ZP. */
export const COMPETITIVE_REPLAY_COST = 5

/** ZP debited to re-spin the slot machine. A paid spin still pays out — it's a wager,
 *  and with E[payout] ≈ 4.25 ZP it's a good one. Casual games have no leaderboard,
 *  so there's nothing to farm; the cost is the only limiter needed. */
export const SLOTS_REPLAY_COST = 2

/** Wordle payout by number of guesses used, index = tries - 1. A loss pays 0.
 *  Wordle has no replay at all — one word a day, same word for everyone. */
export const WORDLE_ZP_BY_TRIES = [15, 10, 8, 6, 4, 2]

/** Clearing MineZweeper's daily board. Flat — the board is the same 16x16/40 for everyone,
 *  so there's no "faster" to reward, and hitting a mine pays 0. No replay: one board a day. */
export const MINEZWEEPER_ZP = 15

/** Levelling the AXA house. Flat, and the only payout the game has — Bomb AXA can't be
 *  lost, so this is "finish it once a day" money, priced accordingly (a third of a
 *  MineZweeper clear). Replays are free and pay 0: the win row is what gates it. */
export const BOMB_AXA_ZP = 5

/** End-of-day leaderboard podium payout, index = rank - 1. Paid by the reset cron. */
export const DAILY_PRIZES = [20, 15, 10]

/** Taking sole #1 on an all-time leaderboard. Paid each time you claim the crown. */
export const ALL_TIME_CROWN_ZP = 50

/** "+20 / +15 / +10 ZP" — the podium payout as one <ZpRules> row value. Derived so the
 *  modal copy can never drift from what the cron actually pays. */
export const DAILY_PRIZES_LABEL = `${DAILY_PRIZES.map((zp) => `+${zp}`).join(" / ")} ZP`
