import { describe, it, expect } from "vitest"
import {
  createWorld,
  ensureLanesAhead,
  hop,
  step,
  moverSpeedFor,
  moverDensityFor,
  hazardBandFor,
  cameraRateFor,
  tierFor,
  laneSafeWindowMs,
  type Lane,
  type LaneType,
} from "@/components/game-hub/zross/engine"
import {
  LANE_COLS,
  HOP_MS,
  TELEGRAPH_MS,
  FIRE_MS,
  TRAM_IDLE_PULSE_MS,
  TRAM_COOLDOWN_MS,
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
  MIN_SAFE_WINDOW_MS,
  SLAB_LEN_MIN,
  MAX_CONSECUTIVE_SAME_TYPE,
} from "@/components/game-hub/zross/constants"

const SEED_COUNT = 200
const LANES_PER_SEED = 500

/** Drives a fresh world's generator forward by advancing the frog's lane and calling
 *  ensureLanesAhead each step — no step()/hop() exists yet (Plan 03), so this is the
 *  cheapest real way to make the generator emit a long run of lanes. Never calls
 *  retireLanesBehind, so the full generated history stays inspectable. */
function driveLanes(seed: number, count: number): Lane[] {
  const w = createWorld(seed)
  for (let i = 0; i < count; i++) {
    w.frog.lane += 1
    ensureLanesAhead(w)
  }
  return w.lanes
}

function baseLane(overrides: Partial<Lane> & { type: LaneType }): Lane {
  return {
    index: 0,
    dirSign: 1,
    speed: 0,
    movers: [],
    slabs: [],
    blockers: [],
    tramPhaseMs: 0,
    tramState: "idle",
    pickupCol: null,
    pickupIndex: null,
    driftAccMs: 0,
    ...overrides,
  }
}

describe("zross engine — solvable path", () => {
  it("never emits a lane below MIN_SAFE_WINDOW_MS across many seeds and a long run", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const lanes = driveLanes(seed, LANES_PER_SEED)
      expect(lanes.length).toBeGreaterThanOrEqual(LANES_PER_SEED)
      for (const lane of lanes) {
        expect(laneSafeWindowMs(lane, lane.index)).toBeGreaterThanOrEqual(MIN_SAFE_WINDOW_MS)
      }
    }
  })
})

describe("zross engine — run length", () => {
  it("never exceeds MAX_CONSECUTIVE_SAME_TYPE lanes of one type in a row", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lanes = driveLanes(seed, LANES_PER_SEED)
      let streak = 0
      let prevType: LaneType | null = null
      for (const lane of lanes) {
        streak = lane.type === prevType ? streak + 1 : 1
        prevType = lane.type
        expect(streak).toBeLessThanOrEqual(MAX_CONSECUTIVE_SAME_TYPE)
      }
    }
  })

  it("never exceeds hazardBandFor(index) consecutive non-plaza lanes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lanes = driveLanes(seed, LANES_PER_SEED)
      let nonPlazaStreak = 0
      for (const lane of lanes) {
        nonPlazaStreak = lane.type === "plaza" ? 0 : nonPlazaStreak + 1
        expect(nonPlazaStreak).toBeLessThanOrEqual(hazardBandFor(lane.index))
      }
    }
  })

  it("never places two tram lanes adjacent to each other", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lanes = driveLanes(seed, LANES_PER_SEED)
      for (let i = 0; i < lanes.length - 1; i++) {
        expect(lanes[i].type === "tram" && lanes[i + 1].type === "tram").toBe(false)
      }
    }
  })
})

describe("zross engine — ramp caps", () => {
  it("mover speed climbs then flattens at MOVER_SPEED_MAX", () => {
    const capAt = (MOVER_SPEED_MAX / MOVER_SPEED_BASE - 1) / MOVER_SPEED_RATE
    expect(moverSpeedFor(0)).toBe(MOVER_SPEED_BASE)
    expect(moverSpeedFor(capAt / 2)).toBeGreaterThan(moverSpeedFor(0))
    expect(moverSpeedFor(capAt)).toBeCloseTo(MOVER_SPEED_MAX, 6)
    expect(moverSpeedFor(capAt * 10)).toBe(MOVER_SPEED_MAX)
  })

  it("mover density climbs then flattens at MOVER_DENSITY_MAX", () => {
    const capAt = (MOVER_DENSITY_MAX / MOVER_DENSITY_BASE - 1) / MOVER_DENSITY_RATE
    expect(moverDensityFor(0)).toBe(MOVER_DENSITY_BASE)
    expect(moverDensityFor(capAt / 2)).toBeGreaterThan(moverDensityFor(0))
    expect(moverDensityFor(capAt)).toBeCloseTo(MOVER_DENSITY_MAX, 6)
    expect(moverDensityFor(capAt * 10)).toBe(MOVER_DENSITY_MAX)
  })

  it("hazard band width climbs then flattens at HAZARD_BAND_MAX", () => {
    const capAt = (HAZARD_BAND_MAX / HAZARD_BAND_BASE - 1) / HAZARD_BAND_RATE
    expect(hazardBandFor(0)).toBe(HAZARD_BAND_BASE)
    expect(hazardBandFor(capAt * 10)).toBeGreaterThan(hazardBandFor(0))
    expect(hazardBandFor(capAt)).toBe(HAZARD_BAND_MAX)
    expect(hazardBandFor(capAt * 10)).toBe(HAZARD_BAND_MAX)
  })

  it("camera advance rate climbs then flattens at CAMERA_RATE_MAX", () => {
    const capAt = (CAMERA_RATE_MAX / CAMERA_RATE_BASE - 1) / CAMERA_RATE_RATE
    expect(cameraRateFor(0)).toBe(CAMERA_RATE_BASE)
    expect(cameraRateFor(capAt / 2)).toBeGreaterThan(cameraRateFor(0))
    expect(cameraRateFor(capAt)).toBeCloseTo(CAMERA_RATE_MAX, 6)
    expect(cameraRateFor(capAt * 10)).toBe(CAMERA_RATE_MAX)
  })

  it("HUD tier is non-decreasing and freezes once every axis has capped, not just one", () => {
    const capAt = Math.max(
      (MOVER_SPEED_MAX / MOVER_SPEED_BASE - 1) / MOVER_SPEED_RATE,
      (MOVER_DENSITY_MAX / MOVER_DENSITY_BASE - 1) / MOVER_DENSITY_RATE,
      (HAZARD_BAND_MAX / HAZARD_BAND_BASE - 1) / HAZARD_BAND_RATE,
      (CAMERA_RATE_MAX / CAMERA_RATE_BASE - 1) / CAMERA_RATE_RATE,
    )
    expect(tierFor(0)).toBe(1)
    expect(tierFor(capAt / 2)).toBeGreaterThanOrEqual(tierFor(0))
    expect(tierFor(capAt * 10)).toBe(tierFor(capAt)) // frozen, not forever-incrementing
  })
})

describe("zross engine — safe window at cap", () => {
  const capDistance = 1_000_000 // deep past every axis's own capping distance

  it("keeps MIN_SAFE_WINDOW_MS itself defensible against HOP_MS", () => {
    expect(MIN_SAFE_WINDOW_MS).toBeGreaterThanOrEqual(2 * HOP_MS + 300)
  })

  it("plaza stays survivable at the maximum blocker count the generator ever places", () => {
    const lane = baseLane({ type: "plaza", blockers: [0, 1] }) // LANE_COLS - 2 free
    expect(laneSafeWindowMs(lane, capDistance)).toBeGreaterThanOrEqual(MIN_SAFE_WINDOW_MS)
  })

  it("road stays survivable at MOVER_SPEED_MAX + MOVER_DENSITY_MAX clustered worst case", () => {
    const occupied = Math.round(MOVER_DENSITY_MAX * LANE_COLS)
    const lane = baseLane({
      type: "road",
      speed: MOVER_SPEED_MAX,
      movers: [{ id: "m0", col: 0, len: occupied }],
    })
    expect(laneSafeWindowMs(lane, capDistance)).toBeGreaterThanOrEqual(MIN_SAFE_WINDOW_MS)
  })

  it("tram stays survivable — the telegraph+idle+cooldown block never includes FIRE_MS", () => {
    const lane = baseLane({ type: "tram" })
    expect(laneSafeWindowMs(lane, capDistance)).toBeGreaterThanOrEqual(MIN_SAFE_WINDOW_MS)
  })

  it("river stays survivable at MOVER_SPEED_MAX with the widest gap Pitfall-5 ever allows", () => {
    // The widest single gap placeSlabs ever produces is SLAB_LEN_MIN + 1 columns (the
    // rest of the ring touches with zero gap) — this is that exact worst case.
    const lane = baseLane({
      type: "river",
      speed: MOVER_SPEED_MAX,
      slabs: [
        { id: "s0", col: 0, len: SLAB_LEN_MIN },
        { id: "s1", col: LANE_COLS - SLAB_LEN_MIN, len: SLAB_LEN_MIN },
      ],
    })
    expect(laneSafeWindowMs(lane, capDistance)).toBeGreaterThanOrEqual(MIN_SAFE_WINDOW_MS)
  })
})

describe("zross engine — determinism", () => {
  it("the same seed produces deeply equal lane stacks", () => {
    const a = driveLanes(42, 50)
    const b = driveLanes(42, 50)
    expect(a).toEqual(b)
  })

  it("different seeds produce different lane stacks", () => {
    const a = driveLanes(1, 50)
    const b = driveLanes(2, 50)
    expect(a).not.toEqual(b)
  })

  it("pickup indexes are assigned strictly increasing with no reuse", () => {
    const lanes = driveLanes(7, LANES_PER_SEED)
    const indexes = lanes.map((l) => l.pickupIndex).filter((i): i is number => i !== null)
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1])
    }
  })
})

describe("zross engine — frame-rate independence", () => {
  it("a 30Hz-equivalent dt sequence and a 120Hz-equivalent dt sequence reach the same frog position", () => {
    // Every generated lane is forced hazard-free plaza — this test exercises
    // ONLY the dt-independence of hop timing/camera math, not collision edge
    // cases (those are covered by the dedicated death-cause tests below).
    const buildSafeWorld = (seed: number) => {
      const world = createWorld(seed)
      for (const lane of world.lanes) {
        lane.type = "plaza"
        lane.blockers = []
        lane.movers = []
        lane.slabs = []
      }
      return world
    }
    const a = buildSafeWorld(77)
    const b = buildSafeWorld(77)
    hop(a, "up")
    hop(b, "up")

    // 990ms total, sliced two ways: 30 steps of 33ms ("30Hz") vs 120 steps of
    // 8.25ms ("120Hz") — both comfortably clear HOP_MS (140ms) so the single
    // hop fully lands in both before the comparison.
    for (let i = 0; i < 30; i++) step(a, 33)
    for (let i = 0; i < 120; i++) step(b, 8.25)

    expect(a.status).toBe("playing")
    expect(b.status).toBe("playing")
    expect(a.frog.lane).toBe(b.frog.lane)
    expect(a.frog.col).toBeCloseTo(b.frog.col, 6)
    // Looser precision than frog.col: the exact millisecond the hop-landing
    // threshold is crossed differs by up to one coarse dt slice between the
    // two granularities (an inherent, bounded property of a discrete ">="
    // threshold check, not a bug), which briefly shifts when the camera's
    // trailing-margin floor last snapped — still well under one dt slice's
    // worth of camera drift.
    expect(a.cameraRow).toBeCloseTo(b.cameraRow, 1)
    expect(a.distance).toBe(b.distance)
  })
})

describe("zross engine — death causes", () => {
  it("struck by a hovercar sets deathCause 'mover'", () => {
    const world = createWorld(1)
    const lane = world.lanes[0]
    lane.type = "road"
    lane.blockers = []
    lane.slabs = []
    lane.speed = 0
    lane.movers = [{ id: "m0", col: 3, len: 1 }]
    world.frog.lane = 0
    world.frog.col = 3
    world.frog.hopping = false

    const result = step(world, 16)

    expect(world.status).toBe("over")
    expect(world.deathCause).toBe("mover")
    expect(result.died).toBe(true)
  })

  it("standing in a river lane with no slab under the frog drowns — deathCause 'drown'", () => {
    const world = createWorld(2)
    const lane = world.lanes[0]
    lane.type = "river"
    lane.blockers = []
    lane.movers = []
    lane.speed = 2
    lane.slabs = [{ id: "s0", col: 0, len: 1 }] // nowhere near the frog's column
    world.frog.lane = 0
    world.frog.col = 4
    world.frog.hopping = false
    world.frog.ridingSlabId = null

    const result = step(world, 16)

    expect(world.status).toBe("over")
    expect(world.deathCause).toBe("drown")
    expect(result.died).toBe(true)
  })

  it("riding a slab past the board edge is carried off — deathCause 'carried'", () => {
    const world = createWorld(3)
    const lane = world.lanes[0]
    lane.type = "river"
    lane.blockers = []
    lane.movers = []
    lane.dirSign = 1
    lane.speed = 2
    lane.slabs = [{ id: "s0", col: 6, len: 1 }]
    world.frog.lane = 0
    world.frog.col = LANE_COLS - 1 // last column — one more carried step leaves the board
    world.frog.hopping = false
    world.frog.ridingSlabId = "s0"

    // 2 cells/sec = one whole-column step every 500ms; that step takes col 6 -> 7.
    const result = step(world, 500)

    expect(world.status).toBe("over")
    expect(world.deathCause).toBe("carried")
    expect(result.died).toBe(true)
  })

  it("falling behind the advancing camera ends the run — deathCause 'camera'", () => {
    const world = createWorld(4)
    world.frog.lane = 2
    world.frog.hopping = false
    world.cameraRow = 5 // already ahead of the frog's lane

    const result = step(world, 16)

    expect(world.status).toBe("over")
    expect(world.deathCause).toBe("camera")
    expect(result.died).toBe(true)
  })
})

describe("zross engine — laser-tram telegraph fairness", () => {
  it("never enters 'fire' with less than TELEGRAPH_MS spent in 'telegraph' since the last 'idle'", () => {
    const world = createWorld(5)
    // Frog parked on a lane forced hazard-free, well away from the tram lane
    // under test — never at risk, so a random generated hazard elsewhere
    // can't end the run before the tram completes its cycles.
    world.frog.lane = 6
    world.lanes[6].type = "plaza"
    world.lanes[6].blockers = []
    const tram = world.lanes[3]
    tram.type = "tram"
    tram.tramPhaseMs = 0
    tram.tramState = "idle"

    const DT = 5
    const fullCycle = TRAM_IDLE_PULSE_MS + TELEGRAPH_MS + FIRE_MS + TRAM_COOLDOWN_MS
    let telegraphMsSinceIdle = 0
    let firedAtLeastOnce = false

    for (let i = 0; i < Math.ceil((fullCycle * 3) / DT); i++) {
      step(world, DT)
      if (tram.tramState === "idle") {
        telegraphMsSinceIdle = 0
      } else if (tram.tramState === "telegraph") {
        telegraphMsSinceIdle += DT
      } else if (tram.tramState === "fire") {
        expect(telegraphMsSinceIdle).toBeGreaterThanOrEqual(TELEGRAPH_MS)
        firedAtLeastOnce = true
      }
    }

    expect(firedAtLeastOnce).toBe(true)
  })
})

describe("zross engine — pickup collection", () => {
  it("a hopped-onto pickup index appears exactly once, never again on later steps", () => {
    const world = createWorld(6)
    const targetLane = world.lanes[1]
    const col = world.frog.col // hop "up" doesn't change column
    targetLane.type = "plaza"
    targetLane.blockers = []
    targetLane.pickupCol = col
    targetLane.pickupIndex = 7

    hop(world, "up")
    const first = step(world, HOP_MS + 10)
    expect(first.collected).toEqual([7])
    expect(targetLane.pickupCol).toBeNull()
    expect(targetLane.pickupIndex).toBeNull()

    const second = step(world, 100)
    expect(second.collected).toEqual([])
  })

  // The reported bug: collection used to live in a landing-only path, so being carried
  // sideways by a river slab — movement with no hop in it — drifted the frog straight
  // through a ZP without banking it.
  it("collects a pickup the slab CARRIES the frog onto, with no hop involved", () => {
    const world = createWorld(11)
    const lane = world.lanes[0]
    lane.type = "river"
    lane.blockers = []
    lane.movers = []
    lane.dirSign = 1
    lane.speed = 2 // cells/sec
    lane.slabs = [{ id: "s0", col: 0, len: LANE_COLS }] // full-width: the frog never drowns
    lane.pickupCol = 3
    lane.pickupIndex = 42
    world.frog.lane = 0
    world.frog.col = 2 // one column short of the ZP, and NOT hopping toward it
    world.frog.hopping = false
    world.frog.ridingSlabId = "s0"

    // 2 cells/sec = one whole-column step every 500ms, carrying col 2 -> 3, the ZP's column.
    const result = step(world, 500)

    expect(world.status).toBe("playing")
    expect(result.collected).toEqual([42])
    expect(lane.pickupIndex).toBeNull()
  })

  it("does not collect while airborne — a hop still banks only on landing", () => {
    const world = createWorld(12)
    const from = world.lanes[0]
    const to = world.lanes[1]
    for (const l of [from, to]) {
      l.type = "plaza"
      l.blockers = []
      l.pickupCol = null
      l.pickupIndex = null
    }
    to.pickupCol = world.frog.col
    to.pickupIndex = 5

    hop(world, "up")
    const midHop = step(world, HOP_MS / 2) // still in the air over the destination lane
    expect(midHop.collected).toEqual([])

    const landed = step(world, HOP_MS)
    expect(landed.collected).toEqual([5])
  })
})

describe("zross engine — hovercar hitbox", () => {
  // The hitbox is centred on the car the player can SEE: the renderer draws a mover from
  // m.col to m.col + len in column units and draws the frog at its cell's centre (col + 0.5).
  // Testing the cell's left edge instead offset the lethal zone half a cell to the right of
  // the drawing, which is what "collisions don't work" looked like from the seat.
  const survives = (moverCol: number, frogCol: number): boolean => {
    const world = createWorld(20)
    const lane = world.lanes[0]
    lane.type = "road"
    lane.blockers = []
    lane.slabs = []
    lane.speed = 0 // frozen: this is a geometry test, not a timing one
    lane.movers = [{ id: "m0", col: moverCol, len: 2 }]
    lane.pickupCol = null
    world.frog.lane = 0
    world.frog.col = frogCol
    world.frog.hopping = false
    step(world, 16)
    return world.status === "playing"
  }

  it("kills exactly the cells whose centre the drawn car covers", () => {
    // Car drawn across columns 3.0 -> 5.0. Cell centres 3.5 and 4.5 are under it; 2.5 and
    // 5.5 are not.
    expect(survives(3, 2)).toBe(true)
    expect(survives(3, 3)).toBe(false)
    expect(survives(3, 4)).toBe(false)
    expect(survives(3, 5)).toBe(true)
  })

  it("tracks the drawn car when it sits mid-column, instead of lagging half a cell behind", () => {
    // Car drawn across 2.5 -> 4.5. Centres inside that span are 2.5 (cell 2) and 3.5 (cell 3);
    // 4.5 is the exclusive right edge, so cell 4 is clear. The old left-edge test gave the
    // mirror-image answer here — cells 3 and 4 lethal, cell 2 safe — i.e. the lethal zone
    // trailed the visible car by a full column on this exact geometry.
    expect(survives(2.5, 1)).toBe(true)
    expect(survives(2.5, 2)).toBe(false)
    expect(survives(2.5, 3)).toBe(false)
    expect(survives(2.5, 4)).toBe(true)
  })
})

describe("zross engine — the frog is never between columns", () => {
  it("a full slab ride leaves the frog on an integer column at every single step", () => {
    const world = createWorld(21)
    const lane = world.lanes[0]
    lane.type = "river"
    lane.blockers = []
    lane.movers = []
    lane.dirSign = 1
    lane.speed = 3.7 // deliberately not a whole number of columns per frame
    lane.slabs = [{ id: "s0", col: 0, len: LANE_COLS }] // full-width: no drowning
    world.frog.lane = 0
    world.frog.col = 0
    world.frog.hopping = false
    world.frog.ridingSlabId = "s0"

    let carried = 0
    for (let i = 0; i < 400 && world.status === "playing"; i++) {
      step(world, 17) // a ragged non-multiple dt, the way RAF actually delivers them
      expect(Number.isInteger(world.frog.col)).toBe(true)
      for (const slab of lane.slabs) expect(Number.isInteger(slab.col)).toBe(true)
      carried += 1
    }
    // The ride really did move — otherwise the assertion above is vacuous.
    expect(carried).toBeGreaterThan(0)
    expect(world.frog.col > 0 || world.deathCause === "carried").toBe(true)
  })
})
