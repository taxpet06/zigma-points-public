// Zross tunables — every number the game depends on. Imported by the client
// engine/renderer and the server router so gameplay and validation agree.
// Mirrors the Znake constants module's organisation: economy re-export block
// first, then anti-cheat timing, then board, then motion, then ramp axes.
// (Deliberately no source path here — Zross ships in the public mirror, and
// tools/export-public.sh fails closed on any public file citing a private one.)

// Economy — the numbers live in lib/game-economy.ts (shared with Flappy/Petris/Znake);
// re-exported here so the router/UI import sites stay unchanged. Never redeclare
// these locally (19-CONTEXT.md: "Import the numbers from @/lib/game-economy... Do
// not hardcode").
export {
  FREE_PLAYS_PER_DAY,
  COMPETITIVE_REPLAY_COST as REPLAY_COST,
  DAILY_PRIZES,
  ALL_TIME_CROWN_ZP,
} from "@/lib/game-economy"
// One pickup = 1 point = 1 ZP. A FREE run banks every point it scores; paid replays
// bank 0 — they're leaderboard-only.
export const ZP_PER_PICKUP = 1

// Timing / anti-cheat
export const SWEEP_ACTIVE_AFTER_MS = 5 * 60_000 // ACTIVE runs older than this → ABANDONED

/** Server-side rate ceiling, checked against the run's AVERAGE ms-per-pickup — NOT
 *  copied from Znake's MIN_MS_PER_APPLE=300 (that number is derived from Znake's own
 *  15x15 grid + 14 c/s top speed + ~10-cell average apple distance; Zross has a
 *  different board and a different generator, so it needs its own derivation).
 *
 *  Zross's frog advances at most one lane per HOP_MS (140ms) — it cannot hop faster
 *  than that, full stop. The generator never places two pickups closer than
 *  MIN_PICKUP_LANE_SPACING (3) lanes apart (a design constraint of the lane
 *  generator, kept here in the comment since engine.ts is where it's enforced), so
 *  the fastest physically possible collection cadence — the best case, back-to-back
 *  pickups at minimum spacing, hopping in a dead straight line with zero hesitation —
 *  is HOP_MS * MIN_PICKUP_LANE_SPACING = 140 * 3 = 420ms per pickup.
 *
 *  Following Znake's own headroom ratio (300 is ~half its 600ms theoretical average),
 *  we take roughly half of the 420ms physical floor — 210ms — and round down to a
 *  clean 200ms. That leaves comfortable slack below the true physical minimum for
 *  human reaction/network jitter while still rejecting any claim rate faster than a
 *  frog could physically travel even in the best-case layout. 200ms is NOT 300 — it
 *  independently lands on a different number because Zross's geometry differs. */
export const MIN_MS_PER_PICKUP = 200

// Board (UI-SPEC §6) — portrait, not square. Two independent axes, unlike Znake's
// single equal-sided board constant: do NOT collapse these into one constant.
export const LANE_COLS = 7
export const VISIBLE_ROWS = 9
export const FROG_SCREEN_ROW = 6

// Motion (UI-SPEC §7) — exact values, not ranges.
export const HOP_MS = 140
export const TELEGRAPH_MS = 700
export const FIRE_MS = 150
export const TRAM_COOLDOWN_MS = 400
export const TRAM_IDLE_PULSE_MS = 1200

// Difficulty ramp — four axes, each keyed off distance in LANES CROSSED (not time),
// each with its own BASE/RATE/MAX. Every axis MUST have a MAX: an uncapped ramp makes
// "playable infinitely" false (19-CONTEXT.md). Shape mirrors Znake's speedFor()/
// tierFor() (Math.min(MAX, BASE * (1 + RATE * distance))) generalized to four axes —
// the HUD tier (engine.ts's tierFor-equivalent) only freezes once ALL FOUR have capped,
// not just the first to reach its ceiling (Pitfall 1 in 19-RESEARCH.md).

/** Cells/sec of hovercars and river slabs at distance 0. */
export const MOVER_SPEED_BASE = 2
/** Fraction of MOVER_SPEED_BASE added per lane crossed. */
export const MOVER_SPEED_RATE = 0.02
/** Ceiling, reached at 100 lanes crossed ((6/2 - 1) / 0.02). Has to be a ceiling: the
 *  run is endless, and a mover speed with no top eventually outruns human reaction
 *  time (same reasoning as Znake's SPEED_MAX), which would make "playable forever" a
 *  lie. 6 c/s is 3x the start speed — a real challenge, not a wall. */
export const MOVER_SPEED_MAX = 6

/** Fraction of a lane's LANE_COLS occupied by movers at distance 0 (~1 of 7 columns). */
export const MOVER_DENSITY_BASE = 0.15
/** Added per lane crossed. */
export const MOVER_DENSITY_RATE = 0.01
/** Ceiling. At LANE_COLS=7, 0.45 * 7 ≈ 3 occupied columns, always leaving at least 4
 *  free — the solvability floor (MIN_SAFE_WINDOW_MS below) depends on density never
 *  climbing high enough to close every column at once. Uncapped density would
 *  eventually saturate all 7 columns and make some lane unsurvivable by construction. */
export const MOVER_DENSITY_MAX = 0.45

/** Max consecutive non-plaza (lethal-type) lanes the generator may emit, at distance 0. */
export const HAZARD_BAND_BASE = 2
/** Added per lane crossed (the generator floors this to an integer). */
export const HAZARD_BAND_RATE = 0.01
/** Ceiling: never more than 4 consecutive lethal lanes in a row. A wider band with no
 *  cap would eventually force a run of lethal lanes longer than any single hop
 *  sequence can safely clear before a mover/tram cycle repeats, making some stretch
 *  of the run uncrossable regardless of skill. */
export const HAZARD_BAND_MAX = 4

/** Rows/sec the camera is forced to advance at distance 0. */
export const CAMERA_RATE_BASE = 0.4
/** Added per lane crossed. */
export const CAMERA_RATE_RATE = 0.01
/** Ceiling: 1.2 rows/sec. The frog's own max theoretical pace is 1000/HOP_MS ≈ 7.14
 *  lanes/sec — the camera cap is kept far below that so a player who keeps moving at
 *  a sane, sustainable pace can never be mathematically out-run by the camera; an
 *  uncapped camera-advance rate would eventually exceed any achievable hop cadence
 *  and turn "caught by the camera" into an unavoidable death rather than a
 *  camping deterrent. */
export const CAMERA_RATE_MAX = 1.2

/** Lanes crossed per HUD difficulty tier; the tier stops climbing once every one of
 *  the four axes above has individually reached its own MAX (see engine.ts's
 *  tierFor-equivalent), so the number never promises difficulty the sim isn't
 *  applying. */
export const LANES_PER_TIER = 20

// Generator / solvability floors
/** Minimum duration, at fully-capped ramp parameters (MOVER_SPEED_MAX,
 *  MOVER_DENSITY_MAX, HAZARD_BAND_MAX), for which a survivable destination cell must
 *  exist in any generated lane. Derived as at least 2 * HOP_MS + 300 = 2*140 + 300 =
 *  580ms (two hop cycles — one to reach the lane, one to clear it — plus ~300ms of
 *  human choice/reaction time), rounded up to a clean 600ms. Plan 02's "safe window at
 *  cap" test is the arbiter that the chosen ramp-axis values actually satisfy this. */
export const MIN_SAFE_WINDOW_MS = 600

/** Data-stream river slab width, in columns. */
export const SLAB_LEN_MIN = 2
export const SLAB_LEN_MAX = 4

/** No more than this many consecutive lanes of the identical lane type (even within
 *  the HAZARD_BAND_MAX lethal-lane run above) — keeps the generated stack visually
 *  and mechanically varied rather than a long identical repeat. */
export const MAX_CONSECUTIVE_SAME_TYPE = 3

// Open Question defaults (19-RESEARCH.md § Open Questions) — recorded here so they
// are not re-opened downstream:
// 1. A data-stream river lane is a SINGLE lane row carrying N slabs of
//    SLAB_LEN_MIN..SLAB_LEN_MAX width drifting across it — not multiple stacked rows.
// 2. The laser-tram rail is whole-lane-lethal during FIRE_MS (fires across all
//    LANE_COLS columns at once) — there is no safe column during a fire; solvability
//    for this lane type is purely temporal (step off before FIRE_MS), guaranteed by
//    the mandatory TELEGRAPH_MS warning beat before it fires.
