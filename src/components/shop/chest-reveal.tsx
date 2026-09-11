"use client"

// ChestReveal — presentational chest-open stage for the Phase-18 lootbox
// reveal (18-04-PLAN.md Task 1). Renders the layers cosmetics.css's
// data-phase keyframes target (.chest/.chest__glow/.flash/.shaft/.beam/
// .prize) plus a scoped confetti canvas, tier-gated by rarity. Owns NO
// timing: the modal's reveal driver (lootbox-modal.tsx) writes data-phase
// on the ancestor `.lootbox-stage` and calls fireBurst() via ref at the
// bursting transition — this component never calls setPhase/setTimeout.
// ponytail: presentational stage only, timeline logic lives in the modal.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react"
import confetti from "canvas-confetti"
import { ChestSvg } from "@/components/shop/chest-svg"
import { fireRevealConfetti } from "@/lib/confetti"
import { RARITY_META, type Rarity } from "@/lib/cosmetics"

// Shared with lootbox-modal.tsx, which drives this via data-phase on the
// `.lootbox-stage` ancestor — 'browsing'/'opening' render no chest layers.
export type Phase = "browsing" | "opening" | "arming" | "bursting" | "revealing" | "settled"

export type ChestRevealHandle = {
  /** Fires the rarity-tuned confetti burst from the chest's on-screen
   * center. Called by the modal's driver at the bursting transition —
   * never on mount, never decided in here. */
  fireBurst: () => void
}

const ANIMATING_PHASES = new Set<Phase>(["arming", "bursting", "revealing"])

export const ChestReveal = forwardRef<
  ChestRevealHandle,
  { rarity: Rarity; phase: Phase; prizeSlot: ReactNode }
>(function ChestReveal({ rarity, phase, prizeSlot }, ref) {
  const chestRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const confettiRef = useRef<confetti.CreateTypes | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const instance = confetti.create(canvasRef.current, {
      resize: true,
      useWorker: true,
      // Confetti fires for everyone, regardless of OS reduced-motion (by request) —
      // the reveal is the reward moment, matching the casino always-animate convention.
      disableForReducedMotion: false,
    })
    confettiRef.current = instance
    return () => {
      instance.reset()
      confettiRef.current = null
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      fireBurst() {
        const instance = confettiRef.current
        const chestEl = chestRef.current
        if (!instance || !chestEl) return
        const rect = chestEl.getBoundingClientRect()
        const origin = {
          x: (rect.left + rect.width / 2) / window.innerWidth,
          y: (rect.top + rect.height / 2) / window.innerHeight,
        }
        fireRevealConfetti(instance, rarity, origin)
      },
    }),
    [rarity],
  )

  const isLegendary = rarity === "LEGENDARY"
  const isRareOrAbove = isLegendary || rarity === "RARE"
  const animating = ANIMATING_PHASES.has(phase)

  return (
    <div
      className="relative flex flex-col items-center gap-3"
      style={{ "--rarity": RARITY_META[rarity].hex } as CSSProperties}
    >
      <div className="relative flex h-32 w-32 items-center justify-center">
        {isLegendary && <div className="beam" aria-hidden="true" />}
        {/* Common gets no light effect (UI-SPEC §4 "none/faint shaft"); Rare+
            get the shaft, Legendary layers the conic beam above underneath it. */}
        {isRareOrAbove && <div className="shaft absolute inset-0" aria-hidden="true" />}
        <div className="stage-shake relative flex items-center justify-center">
          <div className="flash pointer-events-none absolute inset-0" style={{ opacity: 0 }} aria-hidden="true" />
          <div ref={chestRef} className="chest relative">
            <div className="chest__glow absolute inset-0" style={{ opacity: 0 }} aria-hidden="true" />
            <ChestSvg size={128} />
          </div>
        </div>
      </div>

      <div
        className="prize flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg"
        style={{ opacity: 0, willChange: animating ? "transform" : undefined }}
      >
        {prizeSlot}
      </div>

      {/* Scoped canvas (research §7) — kept local to the stage rather than
          the library's default full-viewport canvas, so it layers correctly
          inside the modal instead of floating above everything at z:100. */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  )
})

ChestReveal.displayName = "ChestReveal"
