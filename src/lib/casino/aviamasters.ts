// Aviamasters' isomorphic core — the ONLY genuinely novel module in this milestone. Every prior
// casino game (plinko/wheel/dice/mines/chicken) transcribed a PUBLISHED payout table. BGaming
// publishes no internals for Aviamasters — only four hard constraints: 97% RTP, x250 max
// multiplier, "low volatility", no cash-out. Everything below AVIA_MAX_MULT is a DESIGNED
// parameter, invented in this session and tuned by Monte-Carlo simulation, NOT a published one.
// Only 97% RTP, x250, the additive values +1/+2/+5/+10, the multiplicative values x2/x3/x4/x5,
// the rocket-halves rule, the x1.00 start and the no-cash-out rule are BGaming's, OFFICIAL.
// Re-tuning any constant here is legitimate; tests/unit/avia-model.test.ts's RTP band and
// >=25x share are the CONTRACT, not the constants — see 16-RESEARCH.md § The Spawn Model, whose
// 20,000,000-round tuning run realised RTP 0.97004.
//
// Imported by the server router AND the in-browser verifier. No React, no DOM, no second HMAC
// implementation: crypto lives only in fairness.ts, and this module's whole value is that both
// consumers run the SAME function (the five-game precedent this phase inherits).
//
// ponytail: this file exports three things (playAviaRound, deriveAviamasters, AVIA_MODEL/consts)
// and is not a base class, an interface, or a registry entry — six games is still not a
// framework (RESEARCH § Anti-Patterns).

import { floats, type SeedInput } from "@/lib/casino/fairness"

// Designed — and simultaneously the exact float budget. A water crash is an early stop applied
// to this FIXED-length draw, never a shorter draw: the verifier must always be able to request
// the same 16 floats without already knowing whether the round crashes (16-RESEARCH § Float
// Budget and Verifier Reproducibility).
export const AVIA_STEPS = 16

// OFFICIAL (BGaming) — published max multiplier. Never a tuning knob.
export const AVIA_MAX_MULT = 250

// DESIGNED, not published. Tuned by Monte-Carlo in 16-RESEARCH.md § The Spawn Model / § 2.
// The RTP test is the contract; these constants are its solution, not a published table.
export const AVIA_MODEL = {
  altStart: 5,
  altMax: 12,
  pickRise: 1,
  rocketDrop: 2,
  altGain: 0.1, // pickup probability grows 10% of base per altitude unit — the self-reinforcement
  pickCap: 0.55, // pPick is never allowed above this
  pickScale: 0.03009, // the RTP solution knob; bisected against 97%
  rocketBase: 0.12,
  dropBase: 0.06,
  mulShare: 0.3, // share of pickups that are multiplicative
  // Values are OFFICIAL (BGaming); the weights are DESIGNED.
  addTable: [
    [1, 0.62],
    [2, 0.24],
    [5, 0.11],
    [10, 0.03],
  ],
  mulTable: [
    [2, 0.6],
    [3, 0.25],
    [4, 0.1],
    [5, 0.05],
  ],
} as const

export type AviaEvent =
  | { kind: "rocket" }
  | { kind: "add"; value: 1 | 2 | 5 | 10 }
  | { kind: "mul"; value: 2 | 3 | 4 | 5 }
  | { kind: "drop" }
  | { kind: "level" }

export type AviaStep = { event: AviaEvent; altitude: number; counter: number }
export type AviaRound = { steps: AviaStep[]; landed: boolean; multiplier: number }

function pickFrom(u: number, table: readonly (readonly [number, number])[]): number {
  let acc = 0
  for (const [v, w] of table) {
    acc += w
    if (u < acc) return v
  }
  return table[table.length - 1][0] // u < 1 and weights sum to 1, so this is unreachable
}

/** PURE. Synchronous. Takes floats, not a seed — this is what makes the 2,000,000-round
 *  Monte-Carlo RTP test a ~450ms unit test instead of a multi-minute one (derivePlinko/
 *  plinkoPath precedent, 16-RESEARCH § Pitfall 1). */
export function playAviaRound(fs: readonly number[]): AviaRound {
  const M = AVIA_MODEL
  let alt: number = M.altStart
  let counter = 1
  const steps: AviaStep[] = []

  for (let i = 0; i < AVIA_STEPS; i++) {
    const f = fs[i]
    const pPick = Math.min(M.pickCap, M.pickScale * (1 + M.altGain * alt))
    let event: AviaEvent

    if (f < M.rocketBase) {
      counter = counter / 2
      alt -= M.rocketDrop
      event = { kind: "rocket" }
    } else if (f < M.rocketBase + pPick) {
      // The SAME float, rescaled — (f - rocketBase) / pPick is exactly uniform on [0,1), so no
      // second draw is needed. Do not "clean this up" into a second float; that would double
      // the budget for nothing.
      const g = (f - M.rocketBase) / pPick
      if (g < M.mulShare) {
        const v = pickFrom(g / M.mulShare, M.mulTable) as 2 | 3 | 4 | 5
        // Clamp AT ACCUMULATION, not only at return: the Counter Balance is displayed live
        // during the flight, so the live readout can never show more than settle pays. A
        // rocket after a clamp halves FROM 250 below — the clamp is not sticky.
        counter = Math.min(counter * v, AVIA_MAX_MULT)
        event = { kind: "mul", value: v }
      } else {
        const v = pickFrom((g - M.mulShare) / (1 - M.mulShare), M.addTable) as 1 | 2 | 5 | 10
        counter = Math.min(counter + v, AVIA_MAX_MULT)
        event = { kind: "add", value: v }
      }
      alt = Math.min(alt + M.pickRise, M.altMax)
    } else if (f < M.rocketBase + pPick + M.dropBase) {
      alt -= 1
      event = { kind: "drop" }
    } else {
      event = { kind: "level" }
    }

    steps.push({ event, altitude: alt, counter })
    if (alt <= 0) return { steps, landed: false, multiplier: 0 } // water: loses everything
  }
  // Belt-and-braces clamp — cheap, and it documents the invariant; the real clamp already
  // happened at every accumulation above.
  return { steps, landed: true, multiplier: Math.min(counter, AVIA_MAX_MULT) }
}

/** Always requests exactly AVIA_STEPS floats — never a length that depends on the outcome, or
 *  the verifier could not reproduce a round without already knowing it. The ONLY thing in this
 *  module that touches fairness.ts. */
export async function deriveAviamasters(seed: SeedInput): Promise<AviaRound> {
  return playAviaRound(await floats(seed, AVIA_STEPS))
}
