import { describe, it, expect } from "vitest"
import { createGame, ghostRow, tick, type Action, type GameState } from "@/lib/tetris/engine"
import { pieceAt } from "@/lib/tetris/rng"
import {
  LINE_SCORES,
  framesPerCellForLevel,
  LOCK_DELAY_FRAMES,
  LOCK_RESET_LIMIT,
} from "@/lib/tetris/constants"

// Bot helper: slam fully left, shift right by `target` columns, hard-drop.
// Reused across tests to build scripted, fully-deterministic play sequences
// without hand-authoring per-piece puzzles.
function hardDropAt(state: GameState, target: number): Action[] {
  const actions: Action[] = []
  for (let k = 0; k < 10; k++) actions.push("left")
  for (let k = 0; k < target; k++) actions.push("right")
  actions.push("hard")
  tick(state, actions)
  return actions
}

// Plays `drops` pieces via hardDropAt with a per-drop target-column function,
// recording every action into an input log at its tick. Mirrors exactly what
// a real client would record.
function playScript(
  seed: number,
  targetFn: (i: number) => number,
  drops: number,
): { state: GameState; log: { tick: number; action: Action }[] } {
  const state = createGame(seed)
  const log: { tick: number; action: Action }[] = []
  for (let i = 0; i < drops; i++) {
    if (state.status !== "playing") break
    const actions = hardDropAt(state, targetFn(i))
    for (const action of actions) log.push({ tick: i, action })
  }
  return { state, log }
}

describe("gravity ramp", () => {
  it("adds a constant amount of SPEED per level — no step more than doubles the fall rate", () => {
    const speeds = Array.from({ length: 12 }, (_, level) => 1 / framesPerCellForLevel(level))
    for (let level = 1; level < speeds.length; level++) {
      const step = speeds[level] - speeds[level - 1]
      expect(step).toBeGreaterThan(0)
      // Constant speed increment (until the frame floor clamps) — the old
      // frames-minus-6 curve failed this hard at the top levels.
      expect(step).toBeCloseTo(speeds[1] - speeds[0], 10)
      expect(speeds[level] / speeds[level - 1]).toBeLessThan(2)
    }
  })
})

describe("tetris engine", () => {
  it("createGame(42) is playing, tick 0, empty board, spawns the seeded pieces", () => {
    const state = createGame(42)
    expect(state.status).toBe("playing")
    expect(state.tick).toBe(0)
    expect(state.score).toBe(0)
    expect(state.linesCleared).toBe(0)
    expect(state.level).toBe(0)
    expect(state.board.every((row) => row.every((cell) => cell === 0))).toBe(true)
    expect(state.current.piece).toBe(pieceAt(42, 0))
    expect(state.next).toBe(pieceAt(42, 1))
  })

  it("a scripted single-line-clear sequence yields linesCleared===1 and the exact line-clear score", () => {
    // Gravity-only descent (no hard/soft drop) so score reflects ONLY the
    // line-clear bonus — isolates the scoring formula from drop bonuses.
    const state = createGame(65)
    let drops = 0
    const maxDrops = 20
    while (state.status === "playing" && state.linesCleared === 0 && drops < maxDrops) {
      const drawIndexBefore = state.drawIndex
      const target = drops % 7
      const actions: Action[] = []
      for (let k = 0; k < 10; k++) actions.push("left")
      for (let k = 0; k < target; k++) actions.push("right")
      tick(state, actions) // position only, no hard-drop
      // Wait for natural gravity to lock this piece (drawIndex advances on lock).
      let guard = 0
      while (state.drawIndex === drawIndexBefore && state.status === "playing" && guard < 1200) {
        tick(state, [])
        guard++
      }
      drops++
    }
    expect(state.linesCleared).toBe(1)
    expect(state.score).toBe(LINE_SCORES[1] * (state.level + 1))
  })

  it("a hard-drop locks the piece in one tick (piece count increments, new piece spawned)", () => {
    const state = createGame(42)
    const expectedNext = state.next
    tick(state, ["hard"])
    expect(state.current.piece).toBe(expectedNext) // old `next` is now `current`
    expect(state.drawIndex).toBe(3) // createGame drew index 0,1 (drawIndex=2); lock drew index 2 -> drawIndex=3
    expect(state.score).toBeGreaterThan(0) // hard-drop points awarded
  })

  it("replaying the same scripted action-per-tick script twice yields deep-equal final state", () => {
    const run1 = playScript(65, (i) => i % 7, 15)
    const run2 = playScript(65, (i) => i % 7, 15)
    expect(run1.state.score).toEqual(run2.state.score)
    expect(run1.state.linesCleared).toEqual(run2.state.linesCleared)
    expect(run1.state.board).toEqual(run2.state.board)
    expect(run1.log).toEqual(run2.log)
  })

  it("forcing spawns until the stack reaches the top sets status 'over'", () => {
    const state = createGame(7)
    for (let i = 0; i < 30 && state.status === "playing"; i++) {
      hardDropAt(state, 0) // always drop straight down at the leftmost column
    }
    expect(state.status).toBe("over")
  })
})

describe("lock delay", () => {
  // Drop a piece to the floor with soft drops, then idle. It must stay movable
  // for LOCK_DELAY_FRAMES ticks instead of welding the moment it lands.
  function restOnFloor(seed = 42): GameState {
    const state = createGame(seed)
    // Soft-drop exactly onto the resting row, so no lock-delay frames are burnt.
    while (state.current.y < ghostRow(state)) tick(state, ["soft"])
    return state
  }

  it("does not lock the instant the piece lands", () => {
    const state = restOnFloor()
    expect(state.drawIndex).toBe(2) // still the first piece
    for (let i = state.lockCounter; i < LOCK_DELAY_FRAMES - 1; i++) tick(state, [])
    expect(state.drawIndex).toBe(2)
    tick(state, [])
    expect(state.drawIndex).toBe(3) // locked exactly at the delay
  })

  it("a move while grounded resets the lock timer (this is what makes T-spins possible)", () => {
    const state = restOnFloor()
    for (let i = state.lockCounter; i < LOCK_DELAY_FRAMES - 1; i++) tick(state, [])
    tick(state, ["left"]) // reset
    for (let i = state.lockCounter; i < LOCK_DELAY_FRAMES - 1; i++) tick(state, [])
    expect(state.drawIndex).toBe(2) // still alive thanks to the reset
    tick(state, [])
    expect(state.drawIndex).toBe(3)
  })

  it("resets are capped so a piece can't be stalled forever", () => {
    const state = restOnFloor()
    for (let i = 0; i < LOCK_RESET_LIMIT + 5; i++) {
      for (let k = 0; k < LOCK_DELAY_FRAMES - 1; k++) tick(state, [])
      tick(state, [i % 2 === 0 ? "left" : "right"])
      if (state.drawIndex !== 2) break
    }
    expect(state.drawIndex).toBe(3) // locked despite continuous shuffling
  })

  it("a hard-drop still locks immediately", () => {
    const state = createGame(42)
    tick(state, ["hard"])
    expect(state.drawIndex).toBe(3)
  })
})

describe("tetris engine — hold", () => {
  it("the first hold banks the current piece and pulls the next one in early", () => {
    const state = createGame(42)
    const first = state.current.piece
    const second = state.next

    tick(state, ["hold"])

    expect(state.hold).toBe(first)
    expect(state.current.piece).toBe(second)
    expect(state.next).toBe(pieceAt(42, 2)) // the queue advanced, exactly as a lock would
    expect(state.drawIndex).toBe(3)
    expect(state.holdUsed).toBe(true)
  })

  it("a second hold swaps with the stash instead of drawing, and never consumes the queue", () => {
    const state = createGame(42)
    tick(state, ["hold"])
    tick(state, ["hard"]) // lock — this is what re-arms the hold
    const drawIndexBefore = state.drawIndex
    const stashed = state.hold
    const falling = state.current.piece

    tick(state, ["hold"])

    expect(state.current.piece).toBe(stashed)
    expect(state.hold).toBe(falling)
    expect(state.drawIndex).toBe(drawIndexBefore)
  })

  it("one hold per piece — a second hold before the piece locks is a no-op", () => {
    const state = createGame(7)
    tick(state, ["hold"])
    const afterFirst = { hold: state.hold, current: state.current.piece, drawIndex: state.drawIndex }

    tick(state, ["hold", "hold", "hold"])

    expect(state.hold).toBe(afterFirst.hold)
    expect(state.current.piece).toBe(afterFirst.current)
    expect(state.drawIndex).toBe(afterFirst.drawIndex)
  })

  it("a held piece respawns at the top, not where the old piece was", () => {
    const state = createGame(9)
    for (let i = 0; i < 200; i++) tick(state, []) // let gravity carry it well down the board
    expect(state.current.y).toBeGreaterThan(0)
    tick(state, ["hold"])
    expect(state.current.y).toBe(0)
    expect(state.lockCounter).toBe(0)
  })
})
