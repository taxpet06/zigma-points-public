// The game-module contract.
//
// The server owns connections, auth, rooms, matchmaking, broadcast, the tick loop and
// disconnects. A game owns rules and nothing else: what the starting state is, what an
// input does, what one tick advances, when it is over, and what players are allowed to see.

export type Player = { id: string }

export type GameOver = {
  /** null = draw or aborted. */
  winnerId: string | null
}

export type Game<S> = {
  minPlayers: number
  maxPlayers: number
  /**
   * Ticks per second. 0 = event-driven only — the room is advanced by input alone and
   * costs nothing while idle, which is what turn-based games want.
   */
  tickRate: number
  init: (players: Player[]) => S
  /** `input` arrives straight off the wire. Validate it here; never trust it. */
  onInput: (state: S, playerId: string, input: unknown) => void
  tick?: (state: S, dtMs: number) => void
  /** Non-null ends the match. */
  isOver: (state: S) => GameOver | null
  /**
   * What gets broadcast to clients. Distinct from `S` on purpose: hidden information
   * (an unrevealed answer, another player's hand) stays in `S` and never ships.
   * Must be JSON-serialisable.
   */
  snapshot: (state: S) => unknown
}
