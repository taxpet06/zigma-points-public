// Dice's isomorphic core — imported by the server router AND the in-browser verifier. No
// React, no DOM, and NO second HMAC implementation: crypto lives only in fairness.ts, and this
// module's whole value is that server and verifier run the SAME function.
//
// All state and wire values are integer hundredths (targetH, chanceH, rollH), which removes
// float drift as a category and collapses the zod boundary to one predicate:
// chanceH = mode === "UNDER" ? targetH : 10000 - targetH, valid iff 1 <= chanceH <= 9800.

import { floats, type SeedInput } from "@/lib/casino/fairness"

export const DICE_EDGE = 1 // percent — the published nominal edge

// 0.00..100.00 inclusive — 10001 outcomes, NOT 10000. 100.00 IS reachable; using 10000 would
// break the 9900/10001 EV identity (see tests/unit/dice-math.test.ts "EV sweep").
export const DICE_OUTCOMES = 10001

export const CHANCE_H_MIN = 1 // 0.01% in hundredths
export const CHANCE_H_MAX = 9800 // 98.00% in hundredths

export const DICE_MODES = ["UNDER", "OVER"] as const
export type DiceMode = (typeof DICE_MODES)[number]

/** Truncate, never round, to 4dp — the displayed multiplier must equal the paid multiplier. */
export function diceMultiplier(chanceH: number): number {
  return Math.floor(((100 - DICE_EDGE) / (chanceH / 100)) * 1e4) / 1e4
}

/** The one predicate that is the server's whole validation, in both modes. */
export function chanceHFor(targetH: number, mode: DiceMode): number {
  return mode === "UNDER" ? targetH : 10000 - targetH
}

/** STRICT in both branches — `rollH === targetH` is a LOSS in both modes. Exported on its own
 *  so the equality-is-a-loss case is a unit test rather than a UAT eyeball. */
export function diceWin(rollH: number, targetH: number, mode: DiceMode): boolean {
  return mode === "UNDER" ? rollH < targetH : rollH > targetH
}

/** The ONLY way the triad ever changes. Every edit path (slider, target field, chance field,
 *  multiplier field, preset chip) routes through here. Clamping is always a CHANCE clamp —
 *  clamping the multiplier directly would produce an unrepresentable target. */
export function fromChanceH(chanceH: number, mode: DiceMode) {
  const c = Math.min(CHANCE_H_MAX, Math.max(CHANCE_H_MIN, Math.round(chanceH)))
  return {
    targetH: mode === "UNDER" ? c : 10000 - c,
    chanceH: c,
    multiplier: diceMultiplier(c),
  }
}

/** One float, cursor 0, round 0 — one HMAC call is the entire derivation. */
export async function deriveDice(seed: SeedInput, targetH: number, mode: DiceMode) {
  const [f] = await floats(seed, 1)
  const rollH = Math.floor(f * DICE_OUTCOMES)
  const win = diceWin(rollH, targetH, mode)
  const multiplier = diceMultiplier(chanceHFor(targetH, mode))
  return { rollH, roll: rollH / 100, win, multiplier }
}
