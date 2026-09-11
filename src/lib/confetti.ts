// Scoped-canvas confetti firer for the lootbox reveal (18-01-PLAN.md). Reads
// per-rarity colors/counts from RARITY_META — the single rarity table, never
// a local copy. This helper only fires against a caller-provided scoped
// `confetti.create()` instance; it does not own the canvas element (the
// modal does, per research §7 "Scoped canvas").
// ponytail: one tiny helper, no class, no registry.

import type confetti from "canvas-confetti";
import { RARITY_META, type Rarity } from "@/lib/cosmetics";

const PARTICLE_COUNTS: Record<Rarity, number> = {
  COMMON: 40,
  RARE: 90,
  LEGENDARY: 150,
};

export function fireRevealConfetti(
  instance: confetti.CreateTypes,
  rarity: Rarity,
  origin: { x: number; y: number },
) {
  const colors = RARITY_META[rarity].confettiColors;
  const base = {
    origin,
    colors,
    spread: rarity === "LEGENDARY" ? 90 : 70,
    startVelocity: 45,
    scalar: rarity === "LEGENDARY" ? 1.1 : 0.9,
    ticks: 180,
    // Fires for everyone regardless of OS reduced-motion (by request) — the reveal
    // is the reward moment, matching the casino always-animate convention.
    disableForReducedMotion: false,
  };

  void instance({ ...base, particleCount: PARTICLE_COUNTS[rarity] });

  if (rarity === "LEGENDARY") {
    // Second, wider, slightly delayed burst — reads as "extra" (research §7).
    setTimeout(() => {
      void instance({
        ...base,
        particleCount: 80,
        spread: 140,
        startVelocity: 30,
        shapes: ["star", "circle"],
      });
    }, 120);
  }
}
