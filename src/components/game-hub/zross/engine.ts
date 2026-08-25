// Zross simulation — pure, no DOM, no canvas. The renderer drives it with elapsed
// milliseconds and reads the result; the router only rate-limits pickup claims
// (client-authoritative gameplay, same contract as Znake/Flappy).
//
// Unlike Znake's grid-locked auto-stepping snake, the frog only moves when a hop is
// requested — there is no forced clock tick for the frog itself (movers/slabs/camera
// DO tick continuously by elapsed ms). The renderer lerps the frog from
// `frog.fromLane`/`frog.fromCol` to `frog.lane`/`frog.col` using `frog.hopElapsedMs / HOP_MS`
// as the interpolation `t` — there is no step-accumulator to read the way Znake's
// `accMs` provides one, because a hop is a bounded, explicitly-tracked event instead of
// a forced periodic step.
//
// Seeded via `mulberry32` so the same seed reproduces the same generated world.

import { mulberry32 } from "@/lib/seeded-rng"
import {
  LANE_COLS,
  VISIBLE_ROWS,
  FROG_SCREEN_ROW,
  HOP_MS,
  TELEGRAPH_MS,
  FIRE_MS,
  TRAM_COOLDOWN_MS,
  TRAM_IDLE_PULSE_MS,
  MOVER_SPEED_BASE,
  MOVER_SPEED_RATE,
  MOVER_SPEED_MAX,
  MOVER_DENSITY_BASE,
  MOVER_DENSITY_RATE,
  MOVER_DENSITY_MAX,
  HAZARD_BAND_BASE,
  HAZARD_BAND_RATE,
  HAZARD_BAND_MAX,
  CAMERA_RATE_BASE,
  CAMERA_RATE_RATE,
  CAMERA_RATE_MAX,
  LANES_PER_TIER,
  MIN_SAFE_WINDOW_MS,
  SLAB_LEN_MIN,
  SLAB_LEN_MAX,
  MAX_CONSECUTIVE_SAME_TYPE,
} from "./constants"

export type Dir = "up" | "down" | "left" | "right"
export type LaneType = "plaza" | "road" | "tram" | "river"
export type Status = "playing" | "over"
export type DeathCause = "mover" | "drown" | "carried" | "camera" | null
export type TramState = "idle" | "telegraph" | "fire" | "cooldown"

export type Mover = { id: string; col: number; len: number }
export type Slab = { id: string; col: number; len: number }

export type Lane = {
  index: number // absolute lane index from run start; also the distance metric
  type: LaneType
  dirSign: 1 | -1 // travel direction of movers/slabs in this lane
  speed: number // cells/sec, from moverSpeedFor(index) at generation time
  movers: Mover[] // road only
  slabs: Slab[] // river only
  blockers: number[] // plaza only — decorative, non-lethal, blocks lateral passage
  tramPhaseMs: number // tram only — position within the idle/telegraph/fire/cooldown cycle
  tramState: TramState
  pickupCol: number | null
  pickupIndex: number | null // server claim index; assigned monotonically at generation
  driftAccMs: number // river only — ms banked toward the next whole-column slab step
}

export type Frog = {
  lane: number
  col: number
  fromLane: number
  fromCol: number
  hopElapsedMs: number
  hopping: boolean
  queuedDir: Dir | null
  ridingSlabId: string | null
}

export type World = {
  lanes: Lane[] // ordered by index ascending; retired from the front
  frog: Frog
  cameraRow: number // float; the world row currently at the bottom edge of the board
  distance: number // max lane index the frog has reached — the ramp input
  nextPickupIndex: number
  status: Status
  deathCause: DeathCause
  elapsedMs: number
  seed: number
  rand: () => number
}

// ---------------------------------------------------------------------------
// Ramp axes — each individually clamped at its own _MAX. tierFor freezes only once
// every one of the four has topped out (Pitfall 1, 19-RESEARCH.md): a tier derived
// from a single axis would promise difficulty the sim isn't applying to the other
// three.
// ---------------------------------------------------------------------------

export function moverSpeedFor(distance: number): number {
  return Math.min(MOVER_SPEED_MAX, MOVER_SPEED_BASE * (1 + MOVER_SPEED_RATE * distance))
}

export function moverDensityFor(distance: number): number {
  return Math.min(MOVER_DENSITY_MAX, MOVER_DENSITY_BASE * (1 + MOVER_DENSITY_RATE * distance))
}

/** Max consecutive non-plaza lanes allowed, floored to an integer (it counts lanes). */
export function hazardBandFor(distance: number): number {
  return Math.floor(Math.min(HAZARD_BAND_MAX, HAZARD_BAND_BASE * (1 + HAZARD_BAND_RATE * distance)))
}

export function cameraRateFor(distance: number): number {
  return Math.min(CAMERA_RATE_MAX, CAMERA_RATE_BASE * (1 + CAMERA_RATE_RATE * distance))
}

/** HUD difficulty tier. Frozen once the LAST of the four axes tops out — not the
 *  first — so the number never promises a difficulty increase the sim has stopped
 *  applying to some other axis. */
export function tierFor(distance: number): number {
  const axisCap = (max: number, base: number, rate: number) => (max / base - 1) / rate
  const cappedAt = Math.max(
    axisCap(MOVER_SPEED_MAX, MOVER_SPEED_BASE, MOVER_SPEED_RATE),
    axisCap(MOVER_DENSITY_MAX, MOVER_DENSITY_BASE, MOVER_DENSITY_RATE),
    axisCap(HAZARD_BAND_MAX, HAZARD_BAND_BASE, HAZARD_BAND_RATE),
    axisCap(CAMERA_RATE_MAX, CAMERA_RATE_BASE, CAMERA_RATE_RATE),
  )
  return 1 + Math.floor(Math.min(distance, cappedAt) / LANES_PER_TIER)
}

// ---------------------------------------------------------------------------
// Small column-space helpers. LANE_COLS is small (7) so a plain boolean[] mask is
// simpler and just as fast as an interval-merge structure — and it's the same
// technique for every lane type, which keeps the solvability math easy to audit.
// ---------------------------------------------------------------------------

const mod = (n: number, m: number): number => ((n % m) + m) % m

function coverageMask(spans: { col: number; len: number }[]): boolean[] {
  const mask = new Array<boolean>(LANE_COLS).fill(false)
  for (const s of spans) {
    for (let k = 0; k < s.len; k++) mask[mod(s.col + k, LANE_COLS)] = true
  }
  return mask
}

/** Widens a coverage mask by `reach` columns on each side of every covered column —
 *  models "reachable by a single lateral hop" for the river's solvability check. */
function expandMask(mask: boolean[], reach: number): boolean[] {
  const out = new Array<boolean>(LANE_COLS).fill(false)
  for (let c = 0; c < LANE_COLS; c++) {
    if (!mask[c]) continue
    for (let r = -reach; r <= reach; r++) out[mod(c + r, LANE_COLS)] = true
  }
  return out
}

/** Longest run of `true` in a circular boolean array (wraps past the end). */
function longestCircularRun(bits: boolean[]): number {
  if (bits.every(Boolean)) return bits.length
  if (bits.every((b) => !b)) return 0
  const start = bits.indexOf(false)
  const rotated = [...bits.slice(start), ...bits.slice(0, start)]
  let best = 0
  let cur = 0
  for (const b of rotated) {
    if (b) {
      cur += 1
      if (cur > best) best = cur
    } else {
      cur = 0
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// The solvability predicate. Returns, in ms, the longest continuous window during
// which a survivable destination cell exists in the lane. This is the SAME function
// the generator's repair loop calls and the phase's "safe window" test asserts on —
// there is exactly one implementation of "is this lane survivable", never two.
//
// `distance` is accepted for interface symmetry with the ramp axes above, but is not
// read here: a Lane already carries its generation-time speed/geometry, so the ramp
// state is baked in by the time this runs.
// ---------------------------------------------------------------------------
export function laneSafeWindowMs(lane: Lane, _distance: number): number {
  switch (lane.type) {
    case "plaza": {
      // Survivable as long as at least two columns are free of blockers.
      const free = LANE_COLS - lane.blockers.length
      return free >= 2 ? Infinity : 0
    }
    case "road": {
      if (lane.speed <= 0) return Infinity
      const clear = coverageMask(lane.movers).map((occupied) => !occupied)
      return (longestCircularRun(clear) / lane.speed) * 1000
    }
    case "river": {
      if (lane.speed <= 0) return Infinity
      // Extend slab coverage by one column each side — a column one lateral hop away
      // from a slab is a legitimate landing plan, not just the slab's own footprint.
      // Because every slab in a lane drifts at the SAME speed/direction, the ring's
      // gap geometry is a rigid rotation over time — the mask computed here already
      // holds at every drift phase, not just the generation-time snapshot (Pitfall 5).
      const reachable = expandMask(coverageMask(lane.slabs), 1)
      return (longestCircularRun(reachable) / lane.speed) * 1000
    }
    case "tram": {
      // Whole-lane-lethal only during FIRE_MS (adopted Open Question default); the
      // rest of the cycle — cooldown, idle, and the telegraph warning itself — is one
      // continuous non-fire block that wraps around to the next cooldown.
      return TRAM_IDLE_PULSE_MS + TELEGRAPH_MS + TRAM_COOLDOWN_MS
    }
  }
}

// ---------------------------------------------------------------------------
// Lane generation
// ---------------------------------------------------------------------------

const TYPE_WEIGHT: Record<LaneType, number> = { plaza: 0.3, road: 0.3, tram: 0.15, river: 0.25 }

function pickWeighted(rand: () => number, candidates: LaneType[]): LaneType {
  const total = candidates.reduce((sum, t) => sum + TYPE_WEIGHT[t], 0)
  let r = rand() * total
  for (const t of candidates) {
    r -= TYPE_WEIGHT[t]
    if (r <= 0) return t
  }
  return candidates[candidates.length - 1]
}

function tailStreaks(lanes: Lane[]): { prevType: LaneType | undefined; sameTypeStreak: number; nonPlazaStreak: number } {
  const prevType = lanes.length ? lanes[lanes.length - 1].type : undefined
  let sameTypeStreak = 0
  for (let i = lanes.length - 1; i >= 0 && lanes[i].type === prevType; i--) sameTypeStreak++
  let nonPlazaStreak = 0
  for (let i = lanes.length - 1; i >= 0 && lanes[i].type !== "plaza"; i--) nonPlazaStreak++
  return { prevType, sameTypeStreak, nonPlazaStreak }
}

function shuffleColumns(rand: () => number): number[] {
  const cols = Array.from({ length: LANE_COLS }, (_, i) => i)
  for (let i = cols.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[cols[i], cols[j]] = [cols[j], cols[i]]
  }
  return cols
}

function placeBlockers(rand: () => number): number[] {
  const maxBlockers = Math.min(2, LANE_COLS - 2) // always leave >= 2 free columns
  const count = Math.floor(rand() * (maxBlockers + 1))
  return shuffleColumns(rand).slice(0, count)
}

/** Movers are placed as ONE contiguous platoon (no internal gaps), so a road lane
 *  always has exactly one guaranteed-clear gap of (LANE_COLS - occupied) columns.
 *  This is what makes the "safe window at cap" arithmetic hold: at MOVER_DENSITY_MAX
 *  occupied is 3 of 7 columns, always leaving one 4-column gap — never several small,
 *  scattered gaps that could each individually undercut MIN_SAFE_WINDOW_MS. */
function placeMovers(rand: () => number, index: number): Mover[] {
  const density = moverDensityFor(index)
  const occupied = Math.max(1, Math.min(LANE_COLS - 2, Math.round(density * LANE_COLS)))
  const start = Math.floor(rand() * LANE_COLS)
  const movers: Mover[] = []
  let remaining = occupied
  let col = start
  let id = 0
  while (remaining > 0) {
    const len = Math.min(remaining, 1 + Math.floor(rand() * 2)) // 1-2 cols per car
    movers.push({ id: `m${id++}`, col: mod(col, LANE_COLS), len })
    col += len
    remaining -= len
  }
  return movers
}

/** Two slabs, lengths capped so the two resulting gaps never exceed
 *  SLAB_LEN_MIN + 1 columns combined — Pitfall 5's spacing floor, satisfied by
 *  construction rather than hoped for from a random roll. */
function placeSlabs(rand: () => number): Slab[] {
  const reserve = 2 // total gap columns kept clear, split across the two gaps
  const cap1 = Math.min(SLAB_LEN_MAX, LANE_COLS - SLAB_LEN_MIN - reserve)
  const len1 = SLAB_LEN_MIN + Math.floor(rand() * (cap1 - SLAB_LEN_MIN + 1))
  const cap2 = Math.min(SLAB_LEN_MAX, LANE_COLS - len1 - reserve)
  const len2 = SLAB_LEN_MIN + Math.floor(rand() * (cap2 - SLAB_LEN_MIN + 1))
  const totalGap = LANE_COLS - len1 - len2
  const gap1 = Math.floor(rand() * (totalGap + 1))
  const start1 = Math.floor(rand() * LANE_COLS)
  const start2 = start1 + len1 + gap1
  return [
    { id: "s0", col: mod(start1, LANE_COLS), len: len1 },
    { id: "s1", col: mod(start2, LANE_COLS), len: len2 },
  ]
}

function buildLane(world: World, index: number, type: LaneType): Lane {
  const dirSign: 1 | -1 = world.rand() < 0.5 ? 1 : -1
  const lane: Lane = {
    index,
    type,
    dirSign,
    speed: 0,
    movers: [],
    slabs: [],
    blockers: [],
    tramPhaseMs: 0,
    tramState: "idle",
    pickupCol: null,
    pickupIndex: null,
    driftAccMs: 0,
  }
  if (type === "plaza") {
    lane.blockers = placeBlockers(world.rand)
  } else if (type === "road") {
    lane.speed = moverSpeedFor(index)
    lane.movers = placeMovers(world.rand, index)
  } else if (type === "river") {
    lane.speed = moverSpeedFor(index)
    lane.slabs = placeSlabs(world.rand)
  } else {
    // tram — whole-lane-lethal during FIRE_MS only (adopted Open Question default).
    const cycle = TRAM_IDLE_PULSE_MS + TELEGRAPH_MS + FIRE_MS + TRAM_COOLDOWN_MS
    lane.tramPhaseMs = Math.floor(world.rand() * cycle)
    lane.tramState = "idle"
  }
  return lane
}

/** Bounded repair: widen the largest mover gap, add a slab, or downgrade to plaza.
 *  The unconditional plaza fallback (always survivable) is the anti-DoS backstop —
 *  no seed can spin this loop past MAX_REPAIR_ATTEMPTS (T-19-07). */
function repairLane(world: World, lane: Lane, index: number): Lane {
  if (lane.type === "road" && lane.movers.length > 0) {
    return { ...lane, movers: lane.movers.slice(0, -1) }
  }
  if (lane.type === "river") {
    return { ...lane, slabs: [...lane.slabs, { id: `s${lane.slabs.length}`, col: 0, len: SLAB_LEN_MIN }] }
  }
  return buildLane(world, index, "plaza")
}

function pickupColumnFor(rand: () => number, lane: Lane): number | null {
  if (lane.type === "plaza") {
    const free = Array.from({ length: LANE_COLS }, (_, c) => c).filter((c) => !lane.blockers.includes(c))
    return free.length ? free[Math.floor(rand() * free.length)] : null
  }
  if (lane.type === "road") {
    const clear = coverageMask(lane.movers)
    const free = clear.flatMap((occupied, c) => (occupied ? [] : [c]))
    return free.length ? free[Math.floor(rand() * free.length)] : null
  }
  if (lane.type === "river") {
    const covered = coverageMask(lane.slabs)
    const onSlab = covered.flatMap((c2, c) => (c2 ? [c] : []))
    return onSlab.length ? onSlab[Math.floor(rand() * onSlab.length)] : null
  }
  // tram — the danger is temporal (whole lane, only during FIRE_MS), not spatial, so
  // there is no lethal COLUMN set to avoid; any column is a legitimate pickup spot.
  return Math.floor(rand() * LANE_COLS)
}

function assignPickup(world: World, lane: Lane): void {
  const PICKUP_CHANCE = 0.35
  if (world.rand() >= PICKUP_CHANCE) return
  const col = pickupColumnFor(world.rand, lane)
  if (col === null) return
  lane.pickupCol = col
  lane.pickupIndex = world.nextPickupIndex++
}

const MAX_REPAIR_ATTEMPTS = 5

function generateLane(world: World, index: number, forceType?: LaneType): Lane {
  let type: LaneType
  if (forceType) {
    type = forceType
  } else {
    const { prevType, sameTypeStreak, nonPlazaStreak } = tailStreaks(world.lanes)
    if (nonPlazaStreak >= hazardBandFor(index)) {
      type = "plaza"
    } else {
      const candidates = (["plaza", "road", "tram", "river"] as LaneType[]).filter((t) => {
        if (t === prevType && sameTypeStreak >= MAX_CONSECUTIVE_SAME_TYPE) return false
        if (t === "tram" && prevType === "tram") return false
        return true
      })
      type = pickWeighted(world.rand, candidates)
    }
  }

  let lane = buildLane(world, index, type)
  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
    if (laneSafeWindowMs(lane, index) >= MIN_SAFE_WINDOW_MS) break
    lane = repairLane(world, lane, index)
  }
  if (laneSafeWindowMs(lane, index) < MIN_SAFE_WINDOW_MS) {
    lane = buildLane(world, index, "plaza") // unconditional fallback — always survivable
  }

  assignPickup(world, lane)
  return lane
}

/** Six rows of lookahead (UI-SPEC §6): the frog sits at absolute screen row
 *  FROG_SCREEN_ROW (rows counted top-down), so rows 0..FROG_SCREEN_ROW-1 are "ahead" and
 *  there are exactly FROG_SCREEN_ROW of them — enough that a tram's telegraph is always
 *  visible before the frog can reach that lane. */
const LOOKAHEAD_ROWS = FROG_SCREEN_ROW

/** Rows of trailing context between the frog's fixed screen row and the
 *  board's bottom edge (§6 Camera: "2 rows of trailing context below the
 *  frog"). This is the buffer that makes cameraRow a genuine pursuit — a
 *  fresh run starts with the frog exactly this many rows ahead of the bottom
 *  edge (see createWorld), not glued to it, so the very first frame of
 *  camera drift doesn't already overtake a stationary frog. */
const CAMERA_TRAILING_MARGIN = VISIBLE_ROWS - 1 - FROG_SCREEN_ROW

export function ensureLanesAhead(world: World): void {
  const target = world.frog.lane + LOOKAHEAD_ROWS
  let lastIndex = world.lanes.length ? world.lanes[world.lanes.length - 1].index : -1
  while (lastIndex < target) {
    lastIndex += 1
    world.lanes.push(generateLane(world, lastIndex))
  }
}

export function retireLanesBehind(world: World): void {
  // Never retire the lane the frog is standing on (or riding a slab in — riding always
  // happens within world.frog.lane itself).
  const limit = Math.min(Math.floor(world.cameraRow) - 1, world.frog.lane)
  while (world.lanes.length && world.lanes[0].index < limit) world.lanes.shift()
}

export function createWorld(seed: number): World {
  const startCol = Math.floor(LANE_COLS / 2) // true centre column (LANE_COLS is odd)
  const world: World = {
    lanes: [],
    frog: {
      lane: 0,
      col: startCol,
      fromLane: 0,
      fromCol: startCol,
      hopElapsedMs: 0,
      hopping: false,
      queuedDir: null,
      ridingSlabId: null,
    },
    cameraRow: -CAMERA_TRAILING_MARGIN,
    distance: 0,
    nextPickupIndex: 0,
    status: "playing",
    deathCause: null,
    elapsedMs: 0,
    seed,
    rand: mulberry32(seed),
  }
  // Lane 0 is forced plaza — a run never opens on a hazard.
  world.lanes.push(generateLane(world, 0, "plaza"))
  ensureLanesAhead(world)
  return world
}

// ---------------------------------------------------------------------------
// Movement + simulation — hop() buffers/starts a discrete four-direction hop;
// step() advances the whole world by dtMs (movers/slabs/camera/tram tick
// continuously; the frog only moves when a hop is requested). Both are pure:
// no DOM, no timers, no Math.random() — time enters only as dtMs.
// ---------------------------------------------------------------------------

const TRAM_CYCLE_MS = TRAM_IDLE_PULSE_MS + TELEGRAPH_MS + FIRE_MS + TRAM_COOLDOWN_MS

/** tramState is a pure function of phase within the cycle — "fire" is
 *  structurally unreachable without a full TELEGRAPH_MS spent in "telegraph"
 *  immediately before it (the fairness contract, enforced by construction,
 *  not by a runtime assertion). */
function tramStateAtPhase(phaseMs: number): TramState {
  if (phaseMs < TRAM_IDLE_PULSE_MS) return "idle"
  if (phaseMs < TRAM_IDLE_PULSE_MS + TELEGRAPH_MS) return "telegraph"
  if (phaseMs < TRAM_IDLE_PULSE_MS + TELEGRAPH_MS + FIRE_MS) return "fire"
  return "cooldown"
}

/** The lane at absolute index, or undefined if it isn't currently generated
 *  (ahead of the lookahead window) or has already retired (behind the frog). */
function laneAt(world: World, index: number): Lane | undefined {
  if (!world.lanes.length) return undefined
  const offset = index - world.lanes[0].index
  return offset >= 0 && offset < world.lanes.length ? world.lanes[offset] : undefined
}

/** Circular "does this span cover this column" check. spanStart may be float
 *  (movers/slabs drift continuously) — same mod() technique as the generator's
 *  coverage mask, just evaluated pointwise instead of pre-baked into a boolean[]
 *  (a float index can't address a fixed-size array).
 *
 *  The `+ 0.5` is the whole point and must not be dropped: the renderer draws a
 *  span from `spanStart` to `spanStart + len` in column units, and draws the frog
 *  at the CENTRE of its cell (`col + 0.5`). Testing the cell's left edge instead —
 *  what this did before — offset the lethal zone half a cell to the right of the
 *  drawn car, so a hovercar visibly sitting on top of the frog from one side did
 *  nothing while one half a cell clear on the other side killed it. Comparing the
 *  frog's centre against the span the player can actually see makes the hitbox
 *  symmetric about the sprite and is what "collisions work" means here. */
function coversColumn(spanStart: number, len: number, col: number): boolean {
  return mod(col + 0.5 - spanStart, LANE_COLS) < len
}

/** Starts a hop unconditionally — the caller (hop() itself, or the mid-hop
 *  chain inside step()) has already decided this is the moment to start one.
 *  Rejection (wall clamp, blocked plaza column, retired-lane floor) makes
 *  this a silent no-op, never a death — landing on a HAZARD lane is what
 *  step()'s collision resolution is for. */
function startHop(world: World, dir: Dir, initialElapsedMs = 0): void {
  const frog = world.frog
  const fromLane = frog.lane
  const fromCol = frog.col
  let targetLane = fromLane
  let targetCol = fromCol
  if (dir === "up") targetLane = fromLane + 1
  else if (dir === "down") targetLane = fromLane - 1
  else if (dir === "left") targetCol = fromCol - 1
  else targetCol = fromCol + 1

  if (targetCol < 0 || targetCol > LANE_COLS - 1) return // wall clamp
  const targetLaneObj = laneAt(world, targetLane)
  if (!targetLaneObj) return // not generated yet, or already retired behind the frog
  if (targetLaneObj.type === "plaza" && targetLaneObj.blockers.includes(targetCol)) return

  frog.fromLane = fromLane
  frog.fromCol = fromCol
  frog.ridingSlabId = null // leaving any slab the instant a new hop starts
  frog.lane = targetLane
  frog.col = targetCol
  frog.hopElapsedMs = initialElapsedMs
  frog.hopping = true
}

/** Buffers or starts a hop. "down" (backward) is legal — unlike Znake's
 *  turn(), which rejects a 180° reversal; the frog has no committed heading to
 *  reverse out of. Rejects only: not playing, and a second queued direction
 *  while one is already buffered (queue depth 1 — a mashed queue would
 *  otherwise sprint the frog across several lanes with no time to react). */
export function hop(world: World, dir: Dir): void {
  if (world.status !== "playing") return
  if (world.frog.hopping) {
    if (world.frog.queuedDir === null) world.frog.queuedDir = dir
    return
  }
  startHop(world, dir)
}

/** Everything a frog AT REST resolves against the world: pickup collection first,
 *  then the shared hazard check (road/tram/camera, plus river attach-or-drown — see
 *  checkAtRestHazards).
 *
 *  Called at the instant a hop lands AND again at the end of every step() the frog
 *  spends at rest. Both call sites matter: pickup collection used to live in a
 *  landing-only path, so a river slab that carried the frog sideways across whole
 *  columns — movement with no hop in it at all — drifted straight through a ZP
 *  without banking it. Collection is a property of where the frog IS, not of how it
 *  got there.
 *
 *  Mid-hop the frog is airborne: it neither collects nor collides. That guard lives
 *  here, once, rather than at each call site. */
function resolveAtRest(world: World, collected: number[]): void {
  if (world.status !== "playing" || world.frog.hopping) return
  const lane = laneAt(world, world.frog.lane)
  // Exact column equality: frog.col is an integer at every instant (hops land on a
  // column, slab rides advance in whole columns), so there is no "close enough".
  if (lane && lane.pickupIndex !== null && lane.pickupCol === world.frog.col) {
    collected.push(lane.pickupIndex)
    lane.pickupCol = null
    lane.pickupIndex = null
  }
  checkAtRestHazards(world)
}

/** A frog at rest (not mid-hop) is re-evaluated against every hazard on every
 *  frame it stays at rest — a mover/tram can move into its cell, the camera
 *  can catch up, and (river only) it either attaches to a slab under it or
 *  drowns, checked immediately, not deferred. This is deliberately the SAME
 *  function reached from both of resolveAtRest's call sites — the instant of
 *  landing, and the end of every step() spent at rest — so "checked at rest and
 *  at hop landing" (19-CONTEXT.md's death conditions) is one code path, not
 *  two divergent ones. Mid-hop the frog is airborne and untouchable — this
 *  function's own guard, not the caller's. */
function checkAtRestHazards(world: World): void {
  if (world.status !== "playing" || world.frog.hopping) return
  const frog = world.frog
  if (frog.lane < world.cameraRow) {
    world.status = "over"
    world.deathCause = "camera"
    return
  }
  const lane = laneAt(world, frog.lane)
  if (!lane) return
  const col = frog.col
  if (lane.type === "road") {
    if (lane.movers.some((m) => coversColumn(m.col, m.len, col))) {
      world.status = "over"
      world.deathCause = "mover"
    }
  } else if (lane.type === "tram") {
    if (lane.tramState === "fire") {
      world.status = "over"
      world.deathCause = "mover"
    }
  } else if (lane.type === "river" && !frog.ridingSlabId) {
    const slab = lane.slabs.find((s) => coversColumn(s.col, s.len, col))
    if (slab) frog.ridingSlabId = slab.id
    else {
      world.status = "over"
      world.deathCause = "drown"
    }
  }
}

/** Advances the whole world by dtMs: hop progress, movers/slabs (closed
 *  form), the tram cycle, the camera, slab riding, and collision resolution.
 *  Every position update is a function of dtMs, never of call count — a
 *  30Hz-equivalent dt sequence and a 120Hz-equivalent one reach the same
 *  state (frame-rate independence, 19-CONTEXT.md). */
export function step(world: World, dtMs: number): { collected: number[]; died: boolean; tierUp: boolean } {
  if (world.status !== "playing") return { collected: [], died: false, tierUp: false }

  const collected: number[] = []
  const tierBefore = tierFor(world.distance)
  world.elapsedMs += dtMs
  const frog = world.frog

  // Hop progress. Bounded by the one-deep queue (at most one chained hop can
  // start per landing) — never an unbounded loop, unlike Znake's MAX_STEPS
  // backstop, which exists only because its snake auto-steps every frame.
  if (frog.hopping) {
    frog.hopElapsedMs += dtMs
    while (world.status === "playing" && frog.hopping && frog.hopElapsedMs >= HOP_MS) {
      const overflow = frog.hopElapsedMs - HOP_MS
      frog.hopping = false
      world.distance = Math.max(world.distance, frog.lane)
      resolveAtRest(world, collected)
      const queued = frog.queuedDir
      frog.queuedDir = null
      if (world.status === "playing" && queued) {
        startHop(world, queued, overflow) // chain a mashed double-tap without a full extra HOP_MS delay
      }
      if (!frog.hopping) frog.hopElapsedMs = 0
    }
  }

  // Movers/slabs — closed form, never a repeated-step loop (a huge backgrounded-tab
  // dtMs just moves them further in one call, not more times).
  //
  // Hovercars drift continuously; river slabs advance in WHOLE COLUMNS. That split is
  // the whole reason the frog is never between cells: a slab is the only thing in the
  // world the frog ever STANDS ON, so a slab that slid by fractions of a column slid
  // its rider with it and parked the character off-grid (that was the old
  // `frog.col += speed * dt` ride). Stepping the surface instead keeps slab and rider
  // on the same integer grid with no rounding anywhere — the frog's column is an
  // integer at every instant of the run, at rest and mid-ride alike. Nothing ever
  // stands on a hovercar, so hovercars can stay smooth.
  for (const lane of world.lanes) {
    if (lane.type === "road") {
      for (const m of lane.movers) m.col = mod(m.col + lane.dirSign * lane.speed * (dtMs / 1000), LANE_COLS)
      continue
    }
    if (lane.type !== "river") continue

    lane.driftAccMs += dtMs
    const msPerCol = 1000 / lane.speed
    const steps = Math.floor(lane.driftAccMs / msPerCol)
    if (steps === 0) continue
    lane.driftAccMs -= steps * msPerCol
    for (const s of lane.slabs) s.col = mod(s.col + lane.dirSign * steps, LANE_COLS)

    // Carry an already-attached rider the same whole columns, in lockstep with the
    // slab under it. Attaching happens only at landing (checkAtRestHazards); this
    // never starts a ride, only advances one.
    if (world.status !== "playing" || frog.hopping || !frog.ridingSlabId) continue
    if (lane.index !== frog.lane) continue
    if (!lane.slabs.some((sl) => sl.id === frog.ridingSlabId)) {
      frog.ridingSlabId = null
      continue
    }
    frog.col += lane.dirSign * steps
    if (frog.col < 0 || frog.col > LANE_COLS - 1) {
      world.status = "over"
      world.deathCause = "carried"
    }
  }

  // Tram cycle — tramState is DERIVED from phase, not stepped through by
  // hand, so "fire" is unreachable without the full telegraph beat first
  // (see tramStateAtPhase).
  for (const lane of world.lanes) {
    if (lane.type !== "tram") continue
    lane.tramPhaseMs = mod(lane.tramPhaseMs + dtMs, TRAM_CYCLE_MS)
    lane.tramState = tramStateAtPhase(lane.tramPhaseMs)
  }

  // Camera — forced ramped advance, floored so a fast frog can never outrun
  // the visible window (it always renders at FROG_SCREEN_ROW or closer to the
  // trailing edge, never further ahead than the lookahead already generates).
  world.cameraRow += cameraRateFor(world.distance) * (dtMs / 1000)
  const minCameraForFrog = frog.lane - CAMERA_TRAILING_MARGIN
  if (world.cameraRow < minCameraForFrog) world.cameraRow = minCameraForFrog
  ensureLanesAhead(world)
  retireLanesBehind(world)

  // Resolution for a frog that's still (or newly) at rest, AFTER the slab ride
  // above has moved it: a mover or the tram may have just driven into it, the
  // camera may have just caught up, or the slab may have just carried it onto a
  // ZP — which is a pickup the frog never hopped to and so is only ever seen
  // here, not at landing time.
  resolveAtRest(world, collected)

  const tierAfter = tierFor(world.distance)
  return { collected, died: world.status === "over", tierUp: tierAfter > tierBefore }
}
