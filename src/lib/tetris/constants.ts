// Petris (code slug `tetris`) tunables — every number the game depends
// on. Imported by both the client engine/renderer and the server router so
// gameplay and validation agree. Mirrors src/private-games/flappy/constants.ts.

// Economy — the numbers live in lib/game-economy.ts (shared with Flappy and the hub
// copy); re-exported here so the router/UI import sites stay unchanged.
export {
  FREE_PLAYS_PER_DAY,
  COMPETITIVE_REPLAY_COST as REPLAY_COST,
  DAILY_PRIZES,
  ALL_TIME_CROWN_ZP,
} from "@/lib/game-economy"
// No per-run ZP cap: banked ZP on a FREE run = linesCleared; paid replays bank 0.
export const SWEEP_ACTIVE_AFTER_MS = 5 * 60_000 // ACTIVE runs older than this → ABANDONED

// Replay plausibility bound: end() rejects an input log whose last tick implies
// more elapsed time than (wall-clock since start) allows for, with headroom for
// network/tab-throttle jitter (multiplier) plus a small floor (grace) so an end()
// fired moments after start() isn't rejected before any real ticks have elapsed.
export const REPLAY_TICK_TOLERANCE = 1.25
export const REPLAY_TICK_GRACE_TICKS = 5 * 60 // ~5s of ticks at 60fps

// Board
export const BOARD_WIDTH = 10
export const BOARD_HEIGHT = 20
export const SPAWN_BUFFER_ROWS = 2 // hidden rows above the visible field for spawn/top-out detection

// Simulation — fixed logic-tick length. The sim advances in these ticks, NOT
// RAF delta, so client and server replay compute identical results.
export const TICK_MS = 1000 / 60

// Leveling / scoring
// Level up every 5 lines (not 10) so the gravity ramp below is actually FELT
// within a normal run — most runs end well before 10 lines, so a 10-line level
// made the game feel flat. Both client sim and server replay use this, so the
// anti-cheat contract stays consistent.
export const LINES_PER_LEVEL = 5
export const LINE_SCORES = [0, 100, 300, 500, 800] // index = lines cleared in one lock; scaled by (level+1) in the engine
export const SOFT_DROP_POINTS_PER_CELL = 1
export const HARD_DROP_POINTS_PER_CELL = 2
export const NEXT_PREVIEW_COUNT = 1 // single next-piece preview

// Gravity curve: frames-per-cell-drop by level. Subtracting a fixed number of
// FRAMES per level looked linear but isn't — speed is 1/frames, so the old
// 32 → 26 → 20 → 14 → 8 → 2 curve doubled, then quadrupled, the fall rate in the
// last two steps and the run fell off a cliff. Ramp the SPEED linearly instead:
// cells/sec = 1.875 * (1 + 0.25 * level), i.e. L0 32 frames, L5 16, L10 ~9, L20 ~5.
const GRAVITY_FLOOR_FRAMES = 2
const GRAVITY_BASE_FRAMES = 32
const GRAVITY_SPEEDUP_PER_LEVEL = 0.25
export function framesPerCellForLevel(level: number): number {
  return Math.max(GRAVITY_FLOOR_FRAMES, GRAVITY_BASE_FRAMES / (1 + GRAVITY_SPEEDUP_PER_LEVEL * level))
}

// Lock delay: once a piece is resting on the stack, it stays movable for this
// many frames instead of locking the instant gravity fails. Each successful
// move/rotate while grounded resets the timer, capped at LOCK_RESET_LIMIT so
// you can't stall a piece forever. This is what makes T-spins possible.
export const LOCK_DELAY_FRAMES = 30 // ~0.5s at 60fps
export const LOCK_RESET_LIMIT = 15
