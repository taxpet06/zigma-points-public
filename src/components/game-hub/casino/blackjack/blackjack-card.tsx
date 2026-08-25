"use client"

// SVG playing card — crisp at any DPR. Deal/hit enter via CSS; flip is 3D rotateY.

import * as React from "react"
import { cn } from "@/lib/utils"
import type { Card, Rank, Suit } from "@/lib/casino/blackjack"

const SUIT_PATH: Record<Suit, string> = {
  S: "M12 2C12 2 4 10 4 15.5C4 19 7 21 10 21C11 21 11.5 20.5 12 20C12.5 20.5 13 21 14 21C17 21 20 19 20 15.5C20 10 12 2 12 2Z",
  H: "M12 21S3 14 3 8.5C3 5.5 5.5 3 8.5 3C10.2 3 11.5 4 12 5C12.5 4 13.8 3 15.5 3C18.5 3 21 5.5 21 8.5C21 14 12 21 12 21Z",
  D: "M12 2L20 12L12 22L4 12L12 2Z",
  C: "M12 4.5c-1.8 0-3.2 1.5-3.2 3.3 0 1.2.7 2.2 1.7 2.8C8.2 11 7 12.5 7 14.3 7 16.5 8.8 18 11.2 18c.3 0 .6 0 .8-.1V21H10v2h2 2v-2h-1.8v-3.1c.3.1.6.1.9.1 2.4 0 4.2-1.5 4.2-3.7 0-1.8-1.2-3.3-2.5-3.7 1-.6 1.7-1.6 1.7-2.8C17.2 6 15.8 4.5 14 4.5c-.7 0-1.3.2-1.8.5-.5-.3-1.1-.5-1.8-.5H12z",
}

const RED: Suit[] = ["H", "D"]

function FacePip({ suit, className }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={SUIT_PATH[suit]} fill="currentColor" />
    </svg>
  )
}

function faceOrnament(rank: Rank): string | null {
  if (rank === "J" || rank === "Q" || rank === "K") return rank
  return null
}

export function BlackjackCardFace({ card, className }: { card: Card; className?: string }) {
  const red = RED.includes(card.suit)
  const ornament = faceOrnament(card.rank)
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[0.45rem] border border-black/10 bg-[#f7f4ec] p-1 shadow-md",
        red ? "text-[#c41e3a]" : "text-neutral-900",
        className,
      )}
    >
      <div className="flex flex-col items-start leading-none">
        <span className="font-serif text-[0.8rem] font-bold tabular-nums leading-none">{card.rank}</span>
        <FacePip suit={card.suit} className="mt-0.5 h-2.5 w-2.5" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        {ornament ? (
          <span className="font-serif text-xl font-bold opacity-90 sm:text-2xl">{ornament}</span>
        ) : (
          <FacePip suit={card.suit} className="h-7 w-7 opacity-90 sm:h-8 sm:w-8" />
        )}
      </div>
      <div className="flex rotate-180 flex-col items-start leading-none">
        <span className="font-serif text-[0.8rem] font-bold tabular-nums leading-none">{card.rank}</span>
        <FacePip suit={card.suit} className="mt-0.5 h-2.5 w-2.5" />
      </div>
    </div>
  )
}

export function BlackjackCardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-[0.45rem] border border-white/20 shadow-md",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/game-hub/casino/blackjack/card-back.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none"
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(145deg, #1e3a5f 0%, #0f2744 45%, #1a4a6e 100%)",
          zIndex: -1,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d4af37]/60 bg-[#d4af37]/15">
          <span className="font-serif text-[10px] font-bold text-[#d4af37]">ZP</span>
        </div>
      </div>
    </div>
  )
}

export function BlackjackCard({
  card,
  faceDown = false,
  dealDelayMs = 0,
  flip = false,
  enter = "deal",
  className,
}: {
  card?: Card | null
  faceDown?: boolean
  dealDelayMs?: number
  flip?: boolean
  /** deal = from shoe; hit = sharper slide-in; none = static (resume). */
  enter?: "deal" | "hit" | "none"
  className?: string
}) {
  const [flipped, setFlipped] = React.useState(!flip && !faceDown)
  const showFace = Boolean(card) && (flipped || (!faceDown && !flip))

  React.useEffect(() => {
    if (!flip || !card) return
    const t = window.setTimeout(() => setFlipped(true), Math.max(0, dealDelayMs) + 60)
    return () => window.clearTimeout(t)
  }, [flip, card, dealDelayMs])

  return (
    <div
      className={cn(
        "pointer-events-none h-[4.75rem] w-[3.3rem] shrink-0 [perspective:800px] sm:h-[5.4rem] sm:w-[3.75rem]",
        enter === "deal" && "bj-card-deal",
        enter === "hit" && "bj-card-hit",
        className,
      )}
      style={enter === "none" ? undefined : { animationDelay: `${dealDelayMs}ms` }}
    >
      <div
        className={cn(
          "relative h-full w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-style:preserve-3d]",
          showFace ? "[transform:rotateY(0deg)]" : "[transform:rotateY(180deg)]",
        )}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">
          {card ? <BlackjackCardFace card={card} /> : <BlackjackCardBack />}
        </div>
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <BlackjackCardBack />
        </div>
      </div>
    </div>
  )
}
