// Generalized realtime game server.
//
// One always-on process hosting many game types at once. Everything here is game-agnostic:
// connections, ticket auth, rooms, the tick loop, broadcast and disconnects. Rules live in
// games/*.ts behind the contract in games/types.ts.
//
// Deliberately NOT here:
//   - Points. This server never writes to the database. A finished match is claimed through
//     a tRPC mutation that re-validates server-side (see src/trpc/routers/wordle.ts).
//     A relay anyone can reach must never be able to mint ZP.
//   - Persistence. Room state is in memory; a restart drops matches in progress.
//
// ponytail: single process, rooms in local memory. Ceiling is one CPU core and one machine —
// if a game ever saturates it, shard rooms across processes with node:cluster before rewriting.

import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { WebSocketServer, type WebSocket } from "ws"
import { verifyTicket } from "./ticket.ts"
import { tug } from "./games/tug.ts"
import type { Game } from "./games/types.ts"

const PORT = Number(process.env.PORT ?? 8080)
const MAX_ROOMS = 200
const MAX_CONNECTIONS = 500
const MAX_PAYLOAD = 4096 // bytes; a game input is tiny, anything larger is abuse
const LOOP_MS = 16 // ~60Hz sweep; each room ticks at its own game's rate
const HEARTBEAT_MS = 30_000

// Register games here. Adding one is this line plus a file — never a new server.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GAMES: Record<string, Game<any>> = { tug }

type Conn = {
  ws: WebSocket
  userId: string
  alive: boolean
  key: string | null
}

type Room = {
  key: string
  gameId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  game: Game<any>
  conns: Conn[]
  /** null until minPlayers have joined. */
  state: unknown
  lastTickAt: number
}

const rooms = new Map<string, Room>()

function send(conn: Conn, msg: unknown): void {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg))
}

function broadcast(room: Room, msg: unknown): void {
  const payload = JSON.stringify(msg)
  for (const c of room.conns) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload)
  }
}

function playerIds(room: Room): string[] {
  return room.conns.map((c) => c.userId)
}

function startIfReady(room: Room): void {
  if (room.state !== null) return
  if (room.conns.length < room.game.minPlayers) return
  room.state = room.game.init(room.conns.map((c) => ({ id: c.userId })))
  room.lastTickAt = Date.now()
  broadcast(room, { t: "start", state: room.game.snapshot(room.state) })
}

function endRoom(room: Room, winnerId: string | null, reason: string): void {
  broadcast(room, { t: "over", winnerId, reason })
  rooms.delete(room.key)
  for (const c of room.conns) c.key = null
}

// --- static test client -------------------------------------------------------------
// Exactly one file is servable, matched by name. No path is ever built from user input,
// so directory traversal has nowhere to go.
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public")

const http = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname
  if (path === "/" || path === "/test.html") {
    const html = await readFile(join(PUBLIC_DIR, "test.html"))
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
    return
  }
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  res.writeHead(404).end("not found")
})

// --- websocket ----------------------------------------------------------------------
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_PAYLOAD })

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  const conn: Conn = { ws, userId: "", alive: true, key: null }

  const userId = verifyTicket(url.searchParams.get("ticket") ?? "")
  if (!userId) return ws.close(4001, "unauthorized")
  if (wss.clients.size > MAX_CONNECTIONS) return ws.close(4003, "server full")

  const gameId = url.searchParams.get("game") ?? ""
  const game = GAMES[gameId]
  if (!game) return ws.close(4004, "unknown game")

  const roomId = (url.searchParams.get("room") ?? "").slice(0, 64)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) return ws.close(4005, "bad room name")

  const key = `${gameId}:${roomId}`
  let room = rooms.get(key)
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return ws.close(4003, "server full")
    room = { key, gameId, game, conns: [], state: null, lastTickAt: 0 }
    rooms.set(key, room)
  }
  if (room.conns.length >= game.maxPlayers) return ws.close(4006, "room full")
  if (room.conns.some((c) => c.userId === userId)) return ws.close(4007, "already in this room")

  conn.userId = userId
  conn.key = key
  room.conns.push(conn)

  send(conn, { t: "joined", you: userId, game: gameId, room: roomId })
  broadcast(room, { t: "players", players: playerIds(room), need: game.minPlayers })
  startIfReady(room)

  ws.on("pong", () => {
    conn.alive = true
  })

  ws.on("message", (raw) => {
    const active = conn.key ? rooms.get(conn.key) : undefined
    if (!active || active.state === null) return
    let msg: { t?: string; input?: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.t !== "input") return

    active.game.onInput(active.state, conn.userId, msg.input)

    // Event-driven games (tickRate 0) advance on input alone — the tick loop skips them,
    // so their outcome has to be resolved right here.
    if (active.game.tickRate <= 0) {
      const over = active.game.isOver(active.state)
      if (over) endRoom(active, over.winnerId, "finished")
      else broadcast(active, { t: "state", state: active.game.snapshot(active.state) })
    }
  })

  ws.on("close", () => {
    const active = conn.key ? rooms.get(conn.key) : undefined
    if (!active) return
    active.conns = active.conns.filter((c) => c !== conn)
    conn.key = null
    if (active.state !== null) {
      // A match in progress cannot continue a player down. End it rather than leave the
      // survivor connected to a room that will never tick to a result.
      endRoom(active, null, "player-left")
    } else if (active.conns.length === 0) {
      rooms.delete(active.key)
    } else {
      broadcast(active, { t: "players", players: playerIds(active), need: active.game.minPlayers })
    }
  })
})

// --- tick loop ----------------------------------------------------------------------
// One timer for the whole server. Each room advances at its own game's rate; rooms that
// are not started, or whose game is event-driven, are skipped.
setInterval(() => {
  const now = Date.now()
  for (const room of rooms.values()) {
    if (room.state === null || room.game.tickRate <= 0) continue
    const dt = now - room.lastTickAt
    if (dt < 1000 / room.game.tickRate) continue
    room.lastTickAt = now

    room.game.tick?.(room.state, dt)
    const over = room.game.isOver(room.state)
    if (over) endRoom(room, over.winnerId, "finished")
    else broadcast(room, { t: "state", state: room.game.snapshot(room.state) })
  }
}, LOOP_MS)

// Half-open connections survive laptop sleep, wifi drops and tunnel restarts. Without this
// they sit in rooms forever and "room full" starts rejecting legitimate players.
setInterval(() => {
  for (const ws of wss.clients) {
    const conn = [...rooms.values()].flatMap((r) => r.conns).find((c) => c.ws === ws)
    if (conn && !conn.alive) {
      ws.terminate()
      continue
    }
    if (conn) conn.alive = false
    ws.ping()
  }
}, HEARTBEAT_MS)

if (!process.env.GAME_SERVER_SECRET) {
  console.error("GAME_SERVER_SECRET is not set — every connection will be rejected. See README.md.")
}

http.listen(PORT, () => {
  console.log(`game server listening on http://localhost:${PORT}  (games: ${Object.keys(GAMES).join(", ")})`)
})
