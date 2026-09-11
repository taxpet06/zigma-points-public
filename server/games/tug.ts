// Tug of war — the smoke-test game. Deliberately trivial.
//
// It exists to prove the harness end to end: two players, a 20Hz tick, both players'
// input mutating one shared state, broadcast, and a win condition. Roughly the same
// shape a racing game needs, minus the physics.
//
// Player 0 pulls the rope negative, player 1 pulls it positive. First to ±100 wins.

import type { Game, Player } from "./types.ts"

const WIN_AT = 100
const PULL_STRENGTH = 2

export type TugState = {
  rope: number
  playerIds: string[]
  /**
   * Pulls banked since the last tick, capped at 1 per player per tick. The cap is the
   * point: input arrives as fast as a client cares to send it, so the server — not the
   * client — decides how much a tick is worth. A racing game needs the same clamp.
   */
  pending: Record<string, number>
}

export const tug: Game<TugState> = {
  minPlayers: 2,
  maxPlayers: 2,
  tickRate: 20,

  init: (players: Player[]) => ({
    rope: 0,
    playerIds: players.map((p) => p.id),
    pending: {},
  }),

  onInput: (state, playerId, input) => {
    if (input !== "pull") return
    state.pending[playerId] = 1
  },

  tick: (state) => {
    const [left, right] = state.playerIds
    const pull = (state.pending[right ?? ""] ?? 0) - (state.pending[left ?? ""] ?? 0)
    state.rope += pull * PULL_STRENGTH
    state.pending = {}
  },

  isOver: (state) => {
    if (Math.abs(state.rope) < WIN_AT) return null
    const [left, right] = state.playerIds
    return { winnerId: (state.rope > 0 ? right : left) ?? null }
  },

  snapshot: (state) => ({ rope: state.rope, winAt: WIN_AT, playerIds: state.playerIds }),
}
