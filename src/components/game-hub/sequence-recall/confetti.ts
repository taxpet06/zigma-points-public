// Scoped-canvas confetti firer for Sequence Recall's tier-clear celebration
// (21-03-PLAN.md). This is a NEW helper, not a reuse of src/lib/confetti.ts's
// fireRevealConfetti — that helper is typed to cosmetics Rarity, which does
// not apply here. Structural shape copied from that file (typed CreateTypes
// instance param, void instance({...}) call, no canvas ownership inside the
// helper — the caller owns the canvas element, per the Phase 18-01 decision).
// ponytail: one tiny helper, no class, no registry.

import type confetti from "canvas-confetti";

export function fireTierCelebration(
  instance: confetti.CreateTypes,
  tier: number,
  origin: { x: number; y: number },
) {
  void instance({
    origin,
    colors: ["#F43F5E", "#FDA4AF", "#FBBF24", "#FFFFFF"],
    spread: 70,
    startVelocity: 40,
    ticks: 140,
    particleCount: Math.min(30 + tier * 4, 90),
    // Deliberate inversion of the lootbox precedent (fireRevealConfetti uses
    // false), not a copy error: a lootbox open is a rare per-purchase moment,
    // while a tier clear can fire many times in one sitting (every
    // floor(25/tier) rounds, looping at tier 25). The informational content
    // of a tier clear is fully carried by the always-current HUD Tier chip
    // and the "Tier N" banner text, so the "nothing left to show without
    // motion" justification that earns the casino/lootbox exemption does
    // not apply here — the burst simply doesn't fire under reduced motion.
    disableForReducedMotion: true,
  });
}
