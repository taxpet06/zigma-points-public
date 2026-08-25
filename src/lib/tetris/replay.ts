// Server-authoritative replay: re-derives {score, linesCleared} from ONLY
// (seed, inputLog) by driving the exact same pure engine the client used.
// This is the anti-cheat root — the client never sends a score, ever.

import { createGame, tick, type Action, type GameState } from "./engine"

const VALID_ACTIONS = new Set<Action>(["left", "right", "rotate", "soft", "hard", "hold"])

// ponytail: sane upper bound on log length — even a long run logging one
// action per tick at 60 ticks/sec for 10 minutes is well under this. Exported
// so the router can reject oversized payloads at the zod boundary too
// (defense-in-depth, same cap enforced twice rather than duplicated).
export const MAX_INPUT_LOG_LENGTH = 50_000

export type InputLogEntry = { tick: number; action: Action }

export type ReplayResult = { score: number; linesCleared: number; valid: boolean }

/**
 * replay(seed, inputLog) drives createGame(seed) through tick() for every
 * logged tick and returns the final {score, linesCleared}. Any illegal or
 * implausible log (non-monotonic ticks, unknown actions, oversized log, or a
 * last tick past the caller-supplied maxTicks bound) returns valid=false
 * WITHOUT running the sim.
 */
export function replay(
  seed: number,
  inputLog: InputLogEntry[],
  opts?: { maxTicks?: number },
): ReplayResult {
  const invalid: ReplayResult = { score: 0, linesCleared: 0, valid: false }

  if (inputLog.length > MAX_INPUT_LOG_LENGTH) return invalid

  let prevTick = -Infinity
  for (const entry of inputLog) {
    if (entry.tick < prevTick) return invalid
    if (!VALID_ACTIONS.has(entry.action)) return invalid
    prevTick = entry.tick
  }

  const lastTick = inputLog.length ? inputLog[inputLog.length - 1].tick : -1
  if (opts?.maxTicks !== undefined && lastTick > opts.maxTicks) return invalid

  const state: GameState = createGame(seed)
  if (lastTick < 0) return { score: state.score, linesCleared: state.linesCleared, valid: true }

  const byTick = new Map<number, Action[]>()
  for (const entry of inputLog) {
    const bucket = byTick.get(entry.tick)
    if (bucket) bucket.push(entry.action)
    else byTick.set(entry.tick, [entry.action])
  }

  for (let t = 0; t <= lastTick; t++) {
    tick(state, byTick.get(t) ?? [])
  }

  return { score: state.score, linesCleared: state.linesCleared, valid: true }
}
