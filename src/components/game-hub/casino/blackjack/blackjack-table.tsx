"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { Card, PlayerHand } from "@/lib/casino/blackjack"
import { handLabel } from "@/lib/casino/blackjack"
import { BlackjackCard } from "./blackjack-card"
import { ChipStack } from "./blackjack-chips"

export type ResultBanner = {
  kind: "win" | "lose" | "push"
  title: string
  detail: string
}

export function BlackjackTable({
  dealerUp,
  dealerCards,
  holeHidden,
  forceHoleBack = false,
  hands,
  activeHand,
  wager,
  flash,
  dealKey,
  banner,
  animateEnter = true,
  hitSeq = 0,
  dealerHitFrom = 2,
  insurancePrompt = false,
}: {
  dealerUp: Card | null
  dealerCards: Card[] | null
  holeHidden: boolean
  /** Show a face-down hole even when dealerCards isn't revealed yet. */
  forceHoleBack?: boolean
  hands: PlayerHand[]
  activeHand: number
  wager: number
  flash?: "win" | "lose" | "push" | null
  dealKey: number
  banner?: ResultBanner | null
  animateEnter?: boolean
  hitSeq?: number
  /** Dealer card index at which enter="hit" starts (hole=1, first draw=2). */
  dealerHitFrom?: number
  insurancePrompt?: boolean
}) {
  const dealerShow =
    dealerCards && dealerCards.length > 0 ? dealerCards : dealerUp ? [dealerUp] : []

  // Label tracks what's face-up on the table (sliced progressive reveal included).
  const dealerLabel =
    dealerShow.length === 0
      ? ""
      : holeHidden || forceHoleBack
        ? dealerUp
          ? handLabel([dealerUp])
          : ""
        : handLabel(dealerShow)

  const enterBase = animateEnter ? "deal" : "none"

  return (
    <div
      className={cn(
        "bj-table relative mx-auto w-full max-w-md overflow-hidden rounded-2xl",
        flash === "win" && "bj-flash-win",
        flash === "lose" && "bj-flash-lose",
        flash === "push" && "bj-flash-push",
      )}
    >
      <div className="bj-felt absolute inset-0" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/game-hub/casino/blackjack/felt.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-55 mix-blend-soft-light"
        onError={(e) => {
          e.currentTarget.style.display = "none"
        }}
      />
      <div className="bj-rail absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#d4af37]/25" aria-hidden="true" />

      {banner && (
        <div
          className={cn(
            "bj-banner pointer-events-none absolute top-1/2 z-20 rounded-xl px-4 py-3 text-center shadow-lg backdrop-blur-sm",
            banner.kind === "win" && "bg-emerald-950/85 text-emerald-100 ring-1 ring-emerald-400/40",
            banner.kind === "lose" && "bg-red-950/85 text-red-100 ring-1 ring-red-400/40",
            banner.kind === "push" && "bg-slate-900/85 text-slate-100 ring-1 ring-slate-400/40",
          )}
          role="status"
        >
          <p className="text-lg font-bold tracking-wide">{banner.title}</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums opacity-90">{banner.detail}</p>
        </div>
      )}

      {insurancePrompt && !banner && (
        <div className="pointer-events-none absolute inset-x-4 top-[42%] z-10 rounded-lg bg-black/55 px-3 py-2 text-center text-sm text-[#f5e6a8] ring-1 ring-[#d4af37]/35 backdrop-blur-sm">
          Insurance?
        </div>
      )}

      <div className="relative flex min-h-[24rem] flex-col justify-between px-3 py-4 sm:min-h-[26rem] sm:px-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/90">Dealer</p>
            {dealerLabel && (
              <span className="bj-total-pill rounded-full bg-black/45 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-white">
                {dealerLabel}
              </span>
            )}
          </div>
          <div className="flex min-h-[5.4rem] items-end justify-center -space-x-5 sm:-space-x-6">
            {dealerShow.map((card, i) => {
              const isHole = i === 1
              const showFace = !(forceHoleBack && isHole && holeHidden)
              const isDealerHit = i >= dealerHitFrom
              return (
                <BlackjackCard
                  key={`d-${dealKey}-${i}-${card.rank}${card.suit}-${showFace ? "up" : "dn"}`}
                  card={showFace ? card : undefined}
                  faceDown={!showFace}
                  flip={Boolean(dealerCards && isHole && !holeHidden && showFace)}
                  enter={isDealerHit ? "hit" : enterBase}
                  dealDelayMs={0}
                />
              )
            })}
            {forceHoleBack && dealerUp && dealerShow.length <= 1 && (
              <BlackjackCard key={`d-hole-${dealKey}`} faceDown enter={enterBase} dealDelayMs={0} />
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 py-3">
          <div className="bj-bet-circle flex h-16 w-16 items-center justify-center rounded-full border border-[#d4af37]/50 bg-black/25 shadow-inner">
            <ChipStack amount={wager} />
          </div>
          <p className="font-mono text-[11px] tabular-nums text-white/80">
            {wager > 0 ? `${wager} ZP` : "—"}
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className={cn("flex w-full justify-center gap-5", hands.length > 1 && "flex-wrap")}>
            {hands.map((hand, hi) => {
              if (hand.cards.length === 0 && hands.length === 1) {
                return <div key={`h-${dealKey}-${hi}`} className="min-h-[5.4rem]" />
              }
              const label = hand.cards.length ? handLabel(hand.cards, hand.fromSplit) : ""
              return (
                <div
                  key={`h-${dealKey}-${hi}`}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl px-1 py-1 transition-shadow",
                    hands.length > 1 && hi === activeHand && !hand.done && "ring-2 ring-[#d4af37]/80",
                  )}
                >
                  <div className="flex min-h-[5.4rem] items-end -space-x-5 sm:-space-x-6">
                    {hand.cards.map((card, ci) => {
                      const isNewHit = hitSeq > 0 && ci === hand.cards.length - 1 && hand.cards.length > 2
                      const isSplitChild = hitSeq > 0 && hands.length > 1 && ci === 1
                      const isSplitParent = hitSeq > 0 && hands.length > 1 && ci === 0
                      const enter = isNewHit || isSplitChild ? "hit" : isSplitParent ? "none" : enterBase
                      // Slot key only — face must not be in the key or a redeal can morph
                      // an old card in-place when the new hand lands before the table clears.
                      return (
                        <BlackjackCard
                          key={`p-${dealKey}-${hi}-${ci}`}
                          card={card}
                          enter={enter}
                          dealDelayMs={isNewHit || isSplitChild ? 40 + hi * 90 : 0}
                        />
                      )
                    })}
                  </div>
                  {label && (
                    <span className="bj-total-pill rounded-full bg-black/45 px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-white">
                      {label}
                      {hand.doubled ? " · ×2" : ""}
                    </span>
                  )}
                </div>
              )
            })}
            {hands.length === 0 && (
              <p className="py-8 text-center text-sm text-white/60">Place a bet to start</p>
            )}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/90">You</p>
        </div>
      </div>
    </div>
  )
}
