import { describe, it, expect } from "vitest"
import { createGame, tick, type Action, type GameState } from "@/lib/tetris/engine"
import { replay, type InputLogEntry } from "@/lib/tetris/replay"

// Same bot pattern as tests/unit/tetris-engine.test.ts: slam left, shift
// right by `target`, hard-drop — records every action into an input log at
// its tick exactly as a real client would.
function playScript(
  seed: number,
  targetFn: (i: number) => number,
  drops: number,
): { state: GameState; log: InputLogEntry[] } {
  const state = createGame(seed)
  const log: InputLogEntry[] = []
  for (let i = 0; i < drops; i++) {
    if (state.status !== "playing") break
    const actions: Action[] = []
    for (let k = 0; k < 10; k++) actions.push("left")
    for (let k = 0; k < targetFn(i); k++) actions.push("right")
    actions.push("hard")
    for (const action of actions) log.push({ tick: i, action })
    tick(state, actions)
  }
  return { state, log }
}

describe("tetris replay — the anti-cheat correctness proof", () => {
  it("client-sim score/lines === replay score/lines (seed 65, includes a line clear)", () => {
    const { state, log } = playScript(65, (i) => i % 7, 15)
    expect(state.linesCleared).toBeGreaterThan(0) // this script must exercise a real line clear
    const result = replay(65, log)
    expect(result).toEqual({ score: state.score, linesCleared: state.linesCleared, valid: true })
  })

  it("client-sim score/lines === replay score/lines (seed 14, distinct script, includes a line clear)", () => {
    const { state, log } = playScript(14, (i) => (i * 3) % 7, 10)
    expect(state.linesCleared).toBeGreaterThan(0)
    const result = replay(14, log)
    expect(result).toEqual({ score: state.score, linesCleared: state.linesCleared, valid: true })
  })

  it("empty log returns { score: 0, linesCleared: 0, valid: true }", () => {
    expect(replay(42, [])).toEqual({ score: 0, linesCleared: 0, valid: true })
  })

  it("decreasing ticks are rejected: valid=false, score 0, no throw", () => {
    const log: InputLogEntry[] = [
      { tick: 5, action: "left" },
      { tick: 3, action: "hard" },
    ]
    expect(() => replay(42, log)).not.toThrow()
    expect(replay(42, log)).toEqual({ score: 0, linesCleared: 0, valid: false })
  })

  it("an unknown action is rejected: valid=false, score 0, no throw", () => {
    const log = [{ tick: 0, action: "teleport" }] as unknown as InputLogEntry[]
    expect(() => replay(42, log)).not.toThrow()
    expect(replay(42, log)).toEqual({ score: 0, linesCleared: 0, valid: false })
  })

  it("a last tick past maxTicks is rejected: valid=false, score 0, no throw", () => {
    const log: InputLogEntry[] = [{ tick: 1000, action: "hard" }]
    expect(() => replay(42, log, { maxTicks: 500 })).not.toThrow()
    expect(replay(42, log, { maxTicks: 500 })).toEqual({ score: 0, linesCleared: 0, valid: false })
  })
})
