// Pari-mutuel payout math for BET tasks. Pure functions, no DB — the bet router
// feeds these the stakes and applies the returned credits inside a transaction.

/**
 * Split `total` across `weights` as whole numbers that sum EXACTLY to `total`.
 * Largest-remainder method: floor every share, then hand the leftover units to
 * the largest fractional parts. Conserves ZP (no minting/burning on rounding).
 */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)

  const raw = weights.map((w) => (w / sum) * total)
  const out = raw.map(Math.floor)
  let leftover = total - out.reduce((a, b) => a + b, 0)

  const byFrac = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)

  for (let k = 0; leftover > 0; k++, leftover--) out[byFrac[k].i] += 1
  return out
}

export type BetStake = { id: string; userId: string; choice: string; amount: number }

/**
 * Proportional pari-mutuel settlement.
 * - Winners (choice === winningChoice) split the whole pot in proportion to stake.
 * - Losers get 0 (their stake was already deducted at bet time).
 * - No winners → refund every bettor their own stake (pool voided).
 * Returns the payout per bet id; sum of payouts always equals the pot.
 */
export function settleBets(
  bets: BetStake[],
  winningChoice: string,
): { payoutByBetId: Map<string, number>; pot: number; winnerCount: number } {
  const pot = bets.reduce((s, b) => s + b.amount, 0)
  const payoutByBetId = new Map<string, number>()
  const winners = bets.filter((b) => b.choice === winningChoice)

  if (winners.length === 0) {
    // Nobody called it — void the pool, refund stakes.
    for (const b of bets) payoutByBetId.set(b.id, b.amount)
    return { payoutByBetId, pot, winnerCount: 0 }
  }

  const shares = distribute(
    pot,
    winners.map((w) => w.amount),
  )
  winners.forEach((w, idx) => payoutByBetId.set(w.id, shares[idx]))
  for (const b of bets) if (!payoutByBetId.has(b.id)) payoutByBetId.set(b.id, 0)

  return { payoutByBetId, pot, winnerCount: winners.length }
}
