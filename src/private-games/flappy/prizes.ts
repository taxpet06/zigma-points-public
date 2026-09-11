// PUBLIC-MIRROR STUB. The real implementation is private (see docs/public-mirror.md).
// This file's exports must track src/private-games/flappy/prizes.ts's public API.

/** No-op. Returns the real function's "number of prizes awarded" — zero, since no runs exist. */
export async function awardFlappyDailyPrizes(_day: string): Promise<number> {
  return 0
}
