// Wheel's isomorphic core — the 15 multiplier tables, the one-float derivation, and the landing
// geometry. Imported by the server router (src/trpc/routers/wheel.ts) AND the in-browser
// verifier. It must therefore contain no React, no DOM access, and no second HMAC
// implementation: crypto lives only in fairness.ts, and this module's whole value is that server
// and verifier run the SAME function. The landing round-trip below is what makes WHEL-02
// provable as a unit test rather than a UAT eyeball.

import { floats, type SeedInput } from "@/lib/casino/fairness"

export const WHEEL_RISKS = ["LOW", "MEDIUM", "HIGH"] as const
export type WheelRisk = (typeof WHEEL_RISKS)[number]

export const WHEEL_SEGMENTS = [10, 20, 30, 40, 50] as const
export type WheelSegments = (typeof WHEEL_SEGMENTS)[number]

export const WHEEL_EDGE = 1 // percent — every table computes to exactly 99.0000% RTP

/** The 10-segment LOW block. Every LOW table is this block repeated `segments / 10` times —
 *  LOW is fully periodic, so typing it out five times would be five chances to mistype it. */
const LOW_BLOCK = [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0] as const

/** MEDIUM is NOT periodic — each segment count has a bespoke array. The odd values
 *  (1.9 at 10, 1.8 at 20, 1.7 at 30, 1.6 at 40, 5 at 50) are balancing segments that exist
 *  purely to force each table onto exactly 0.99 x segments. They are the single most likely
 *  transcription error in this file and each has a named regression test. */
const MEDIUM: Record<number, readonly number[]> = {
  10: [0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3],
  20: [1.5, 0, 2, 0, 2, 0, 2, 0, 1.5, 0, 3, 0, 1.8, 0, 2, 0, 2, 0, 2, 0],
  30: [
    1.5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 2, 0, 1.7, 0, 4, 0, 1.5,
    0, 2, 0,
  ],
  40: [
    2, 0, 3, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 2, 0, 1.6, 0,
    2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0,
  ],
  50: [
    2, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0, 2,
    0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0, 1.5, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0,
  ],
}

/** LOW = the block repeated; HIGH = segments-1 zeros plus one `segments x 0.99` jackpot
 *  (9.9 / 19.8 / 29.7 / 39.6 / 49.5). Both rules are asserted against the published
 *  value:count distributions in tests/unit/wheel-tables.test.ts — the sum invariant alone
 *  is vacuously true for a generated table and cannot catch a wrong generator. */
export const WHEEL_TABLES: Record<WheelRisk, Readonly<Record<number, readonly number[]>>> = {
  LOW: Object.fromEntries(
    WHEEL_SEGMENTS.map((s) => [s, Array.from({ length: s / 10 }, () => LOW_BLOCK).flat()]),
  ),
  MEDIUM,
  HIGH: Object.fromEntries(
    WHEEL_SEGMENTS.map((s) => [s, [...Array<number>(s - 1).fill(0), Number((s * 0.99).toFixed(2))]]),
  ),
}

/** Throws rather than returning undefined, so a malformed risk/segments/index can never
 *  silently produce a NaN payout that payoutFor() would floor to something unexpected.
 *  (plinkoMultiplier precedent.) */
export function wheelMultiplier(risk: WheelRisk, segments: number, index: number): number {
  const table = WHEEL_TABLES[risk]?.[segments]
  if (!table || index < 0 || index >= table.length) {
    throw new Error(`bad wheel config ${risk}/${segments}/${index}`)
  }
  return table[index]
}

/** One float, cursor 0, round 0 — one HMAC call is the entire derivation. Identical shape to
 *  deriveDice. `index >= segments` is impossible (floats() is strictly < 1) — do NOT add a
 *  defensive clamp that would silently hide a broken float stream. */
export async function deriveWheel(seed: SeedInput, segments: number, risk: WheelRisk) {
  const [f] = await floats(seed, 1)
  const index = Math.floor(f * segments)
  return { index, multiplier: wheelMultiplier(risk, segments, index) }
}

// Pure, DOM-free landing geometry — this is what makes WHEL-02 a unit test instead of a UAT
// eyeball. CSS conic-gradient starts at 0deg = 12 o'clock and proceeds clockwise; CSS
// transform: rotate(+X) is also clockwise. Segment `i` occupies wheel-frame angles
// [i*theta, (i+1)*theta) with theta = 360/segments, and a pointer fixed at 12 o'clock sees
// wheel-frame angle (-rotation) mod 360.

export const WHEEL_TURNS = 5 // full rotations before landing; 4-6 is the observed Stake range

const mod360 = (d: number) => ((d % 360) + 360) % 360

/** Absolute accumulated rotation, in degrees, that lands segment `index` under a fixed
 *  12-o'clock pointer. ALWAYS moves forward by at least WHEEL_TURNS full turns — an absolute
 *  (non-accumulated) angle would make the wheel visibly unwind backwards between spins. */
export function landingRotation(prev: number, index: number, segments: number): number {
  const landing = mod360(360 - (index + 0.5) * (360 / segments))
  return prev + 360 * WHEEL_TURNS + mod360(landing - mod360(prev))
}

/** Which segment sits under the pointer at a given rotation. The inverse of the above; exists
 *  so the identity is assertable. */
export function segmentAtPointer(rotation: number, segments: number): number {
  return Math.floor(mod360(-rotation) / (360 / segments)) % segments
}
