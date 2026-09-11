// Pure fixed-timestep Tetris engine. No React, no DOM, no tRPC, no wall
// clock (performance.now()) — the sim advances ONLY by discrete tick() calls,
// so client and server replay compute byte-identical results from the same
// (seed, inputLog). Mirrors the purity of flappy/engine.ts, but flappy's
// per-edible claim model doesn't map here — Tetris needs a full board sim.

import { pieceAt, type PieceId } from "./rng"
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  SPAWN_BUFFER_ROWS,
  LINES_PER_LEVEL,
  LINE_SCORES,
  SOFT_DROP_POINTS_PER_CELL,
  HARD_DROP_POINTS_PER_CELL,
  framesPerCellForLevel,
  LOCK_DELAY_FRAMES,
  LOCK_RESET_LIMIT,
} from "./constants"

export type Action = "left" | "right" | "rotate" | "soft" | "hard" | "hold"

export type GameStatus = "playing" | "over"

export type BoardCell = PieceId | 0

// Bounding-box cell offsets [dx, dy] per piece per rotation state (0-3).
// Standard Tetris Guideline shapes, no SRS kick table — rotation clamp in
// tryRotate is a simple wall/floor sweep instead (see ponytail note there).
export const SHAPES: Record<PieceId, ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
}

export const BOX_SIZE: Record<PieceId, number> = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 }

const TOTAL_ROWS = BOARD_HEIGHT + SPAWN_BUFFER_ROWS

export type PieceState = { piece: PieceId; rotation: number; x: number; y: number }

export type GameState = {
  seed: number
  board: BoardCell[][]
  current: PieceState
  next: PieceId
  hold: PieceId | null // stashed piece, null until the first hold of the run
  holdUsed: boolean // one hold per piece: cleared when a piece locks, set when one is stashed
  drawIndex: number // index of the NEXT undrawn piece (pieceAt(seed, drawIndex))
  gravityCounter: number
  lockCounter: number // frames the piece has rested on the stack (0 while airborne)
  lockResets: number // move/rotate resets spent at this resting height
  tick: number
  score: number
  linesCleared: number
  level: number
  status: GameStatus
}

function emptyBoard(): BoardCell[][] {
  return Array.from({ length: TOTAL_ROWS }, () => new Array<BoardCell>(BOARD_WIDTH).fill(0))
}

function cellsFor(p: PieceState): ReadonlyArray<readonly [number, number]> {
  return SHAPES[p.piece][p.rotation]
}

function collides(board: BoardCell[][], p: PieceState): boolean {
  for (const [dx, dy] of cellsFor(p)) {
    const x = p.x + dx
    const y = p.y + dy
    if (x < 0 || x >= BOARD_WIDTH) return true
    if (y >= TOTAL_ROWS) return true
    if (y >= 0 && board[y][x] !== 0) return true
  }
  return false
}

function spawnState(piece: PieceId): PieceState {
  return { piece, rotation: 0, x: Math.floor((BOARD_WIDTH - BOX_SIZE[piece]) / 2), y: 0 }
}

/** Resting row of the current piece (ghost-piece helper for the UI). */
export function ghostRow(state: GameState): number {
  let y = state.current.y
  while (!collides(state.board, { ...state.current, y: y + 1 })) y++
  return y
}

export function createGame(seed: number): GameState {
  return {
    seed,
    board: emptyBoard(),
    current: spawnState(pieceAt(seed, 0)),
    next: pieceAt(seed, 1),
    hold: null,
    holdUsed: false,
    drawIndex: 2,
    gravityCounter: 0,
    lockCounter: 0,
    lockResets: 0,
    tick: 0,
    score: 0,
    linesCleared: 0,
    level: 0,
    status: "playing",
  }
}

/** True when the piece cannot fall any further — i.e. it is resting on the stack/floor. */
function grounded(state: GameState): boolean {
  return collides(state.board, { ...state.current, y: state.current.y + 1 })
}

/**
 * Lock-delay move reset: a successful move/rotate while grounded restarts the
 * lock timer, so you can slide or spin a piece into place (T-spins) instead of
 * it welding on contact. Capped at LOCK_RESET_LIMIT per resting height so a
 * piece can't be stalled indefinitely.
 */
function touchLock(state: GameState): void {
  if (!grounded(state)) return
  if (state.lockResets >= LOCK_RESET_LIMIT) return
  state.lockResets += 1
  state.lockCounter = 0
}

function tryMove(state: GameState, dx: number, dy: number): boolean {
  const moved = { ...state.current, x: state.current.x + dx, y: state.current.y + dy }
  if (collides(state.board, moved)) return false
  state.current = moved
  return true
}

// ponytail: simple wall/floor clamp sweep instead of SRS kick tables — good
// enough for LEAN MODERN scope (locked decision), revisit if finesse play matters.
function tryRotate(state: GameState): boolean {
  const rotated = { ...state.current, rotation: (state.current.rotation + 1) % 4 }
  for (const dx of [0, -1, 1, -2, 2]) {
    const test = { ...rotated, x: rotated.x + dx }
    if (!collides(state.board, test)) {
      state.current = test
      return true
    }
  }
  // Still colliding everywhere in the sweep — no-op.
  return false
}

function clearLines(state: GameState): number {
  const remaining = state.board.filter((row) => row.some((cell) => cell === 0))
  const cleared = state.board.length - remaining.length
  if (cleared > 0) {
    const empties = Array.from({ length: cleared }, () => new Array<BoardCell>(BOARD_WIDTH).fill(0))
    state.board = [...empties, ...remaining]
  }
  return cleared
}

function lockPiece(state: GameState): void {
  for (const [dx, dy] of cellsFor(state.current)) {
    const x = state.current.x + dx
    const y = state.current.y + dy
    if (y >= 0 && y < TOTAL_ROWS) state.board[y][x] = state.current.piece
  }

  const cleared = clearLines(state)
  if (cleared > 0) {
    state.score += LINE_SCORES[cleared] * (state.level + 1)
    state.linesCleared += cleared
    state.level = Math.floor(state.linesCleared / LINES_PER_LEVEL)
  }

  state.current = spawnState(state.next)
  state.next = pieceAt(state.seed, state.drawIndex)
  state.drawIndex += 1
  state.gravityCounter = 0
  state.lockCounter = 0
  state.lockResets = 0
  state.holdUsed = false // a fresh piece gets a fresh hold

  if (collides(state.board, state.current)) {
    state.status = "over"
  }
}

/**
 * Swaps the falling piece with the stash. On the first hold of a piece's life the
 * stash may be empty, in which case the piece is banked and the NEXT piece is drawn
 * early — which is why this consumes drawIndex exactly the way lockPiece does, and
 * why the server replay stays deterministic through a hold.
 *
 * One hold per piece (holdUsed, cleared in lockPiece): without that cap, alternating
 * holds parks a piece in the air forever and gravity never resolves. A hold that
 * would spawn into an occupied stack tops the run out, same as a blocked spawn.
 */
function holdPiece(state: GameState): void {
  if (state.holdUsed) return
  const stashed = state.hold
  state.hold = state.current.piece
  if (stashed === null) {
    state.current = spawnState(state.next)
    state.next = pieceAt(state.seed, state.drawIndex)
    state.drawIndex += 1
  } else {
    state.current = spawnState(stashed)
  }
  state.holdUsed = true
  state.gravityCounter = 0
  state.lockCounter = 0
  state.lockResets = 0

  if (collides(state.board, state.current)) {
    state.status = "over"
  }
}

function applyAction(state: GameState, action: Action): void {
  switch (action) {
    case "left":
      if (tryMove(state, -1, 0)) touchLock(state)
      break
    case "right":
      if (tryMove(state, 1, 0)) touchLock(state)
      break
    case "rotate":
      if (tryRotate(state)) touchLock(state)
      break
    case "soft":
      if (tryMove(state, 0, 1)) state.score += SOFT_DROP_POINTS_PER_CELL
      break
    case "hold":
      holdPiece(state)
      break
    case "hard": {
      let cells = 0
      while (tryMove(state, 0, 1)) cells++
      state.score += cells * HARD_DROP_POINTS_PER_CELL
      lockPiece(state)
      break
    }
  }
}

/** Applies queued actions in order, then gravity (skipped if a hard-drop already locked this tick). Mutates and returns state. */
export function tick(state: GameState, actions: Action[]): GameState {
  if (state.status !== "playing") return state

  state.tick += 1
  let locked = false
  for (const action of actions) {
    applyAction(state, action)
    if (action === "hard") locked = true
  }

  if (!locked && state.status === "playing") {
    if (grounded(state)) {
      // Resting: run the lock timer instead of welding on contact.
      state.lockCounter += 1
      if (state.lockCounter >= LOCK_DELAY_FRAMES) lockPiece(state)
    } else {
      // Airborne again (slid off a ledge / stack cleared out from under it):
      // the piece gets a fresh lock budget at its new resting height.
      state.lockCounter = 0
      state.lockResets = 0
      state.gravityCounter += 1
      if (state.gravityCounter >= framesPerCellForLevel(state.level)) {
        state.gravityCounter = 0
        tryMove(state, 0, 1)
      }
    }
  }

  return state
}
