// Blackjack isomorphic core — server router, UI totals, and the verifier share this module.
// No React, no DOM, no second HMAC: crypto lives only in fairness.ts.
//
// Anti-leak contract (same ruling as Mines): the shoe and dealer hole are derived per request
// from the seed and NEVER written into ACTIVE CasinoBet.state. Only public cards, the deal
// cursor, and phase flags are persisted. activeRound returns state verbatim — a hole card in
// that JSON would be a one-query leak.

import { floats, type SeedInput } from "@/lib/casino/fairness"
import { MAX_PAYOUT } from "@/lib/casino/limits"

export const BJ_DECKS = 6
export const BJ_SHOE_SIZE = BJ_DECKS * 52 // 312
export const BJ_FLOATS = BJ_SHOE_SIZE - 1 // 311 — Fisher-Yates swap count

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const
export const SUITS = ["S", "H", "D", "C"] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]
export type Card = { rank: Rank; suit: Suit }

export type BlackjackAction = "hit" | "stand" | "double" | "split" | "insure" | "no_insurance"

export type PlayerHand = {
  cards: Card[]
  /** ZP staked on this hand (grows on double). */
  stake: number
  /** Stood, busted, or finished after double / split-aces. */
  done: boolean
  doubled: boolean
  /** Hand came from a split (blocks resplit; split Aces get one card). */
  fromSplit: boolean
  splitAces: boolean
}

/** Safe-to-persist ACTIVE state — no hole card, no remaining shoe. */
export type BlackjackPersistedState = {
  nextCardIndex: number
  hands: PlayerHand[]
  activeHand: number
  dealerUp: Card
  /** Initial deal uses shoe[3] as hole — never stored. */
  phase: "insurance" | "playing"
  /** 0 if declined / not taken; >0 if insured. */
  insuranceStake: number
  /** After Ace-up insurance decision, peek has been resolved. */
  peeked: boolean
}

export type HandResult = "blackjack" | "win" | "push" | "lose" | "bust"

export type SettledHand = PlayerHand & {
  result: HandResult
  payout: number
}

export type BlackjackSettlement = {
  dealerCards: Card[]
  hands: SettledHand[]
  insuranceStake: number
  insurancePayout: number
  /** Gross ZP returned (includes stake on wins/pushes). */
  payout: number
  /** payout / totalWager — for CasinoBet.multiplier display. */
  multiplier: number
}

export type BlackjackPublicView = {
  hands: PlayerHand[]
  activeHand: number
  dealerUp: Card
  /** Present only when the hole is revealed (peek BJ or end of round). */
  dealerCards: Card[] | null
  holeHidden: boolean
  phase: "insurance" | "playing" | "settled"
  insuranceStake: number
  actions: BlackjackAction[]
  totals: { player: Array<{ total: number; soft: boolean; label: string }>; dealer: { total: number; soft: boolean; label: string } | null }
}

function cardFromShoeIndex(i: number): Card {
  const c = i % 52
  return { rank: RANKS[c % 13]!, suit: SUITS[Math.floor(c / 13)]! }
}

/** Ordered 6-deck shoe before shuffle — deterministic, used only as Fisher-Yates input. */
export function orderedShoe(): Card[] {
  return Array.from({ length: BJ_SHOE_SIZE }, (_, i) => cardFromShoeIndex(i))
}

/** Provably-fair 6-deck shuffle. 311 floats drive Fisher-Yates (mirrors deriveMines). */
export async function deriveBlackjackShoe(seed: SeedInput): Promise<Card[]> {
  const fs = await floats(seed, BJ_FLOATS)
  const deck = orderedShoe()
  for (let i = BJ_FLOATS; i > 0; i--) {
    const j = Math.floor(fs[BJ_FLOATS - i]! * (i + 1))
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return deck
}

export function rankValue(rank: Rank): number {
  if (rank === "A") return 11
  if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") return 10
  return Number(rank)
}

export function isTenValue(card: Card): boolean {
  return rankValue(card.rank) === 10
}

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const c of cards) {
    if (c.rank === "A") {
      aces++
      total += 11
    } else {
      total += rankValue(c.rank)
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 && total <= 21 }
}

export function handLabel(cards: Card[], fromSplit = false): string {
  if (cards.length === 0) return ""
  const { total, soft } = handValue(cards)
  // Split 21 is not a natural — label as the total, not "Blackjack".
  if (!fromSplit && isBlackjack(cards)) return "Blackjack"
  if (total > 21) return "Bust"
  return soft ? `Soft ${total}` : String(total)
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21
}

/** Vegas: only a non-split two-card 21 is a natural (3:2). Split 21 pays 1:1. */
export function isNaturalBlackjack(hand: { cards: Card[]; fromSplit: boolean }): boolean {
  return !hand.fromSplit && isBlackjack(hand.cards)
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21
}

/** S17 — hit while under 17; stand on soft OR hard 17+ (never hit 17–21). */
export function dealerShouldHit(cards: Card[]): boolean {
  const { total } = handValue(cards)
  // Explicit ceiling — total >= 17 must never draw, including soft 17 and hard 17–21.
  return total > 0 && total < 17
}

export function dealerPlay(shoe: Card[], startIndex: number, initialDealer: Card[]): { cards: Card[]; nextCardIndex: number } {
  const cards = [...initialDealer]
  let idx = startIndex
  while (dealerShouldHit(cards)) {
    const next = shoe[idx]
    if (!next) break
    cards.push(next)
    idx++
    // Belt-and-braces: if a draw somehow left us at 17+, stop immediately.
    if (handValue(cards).total >= 17) break
  }
  return { cards, nextCardIndex: idx }
}

/** Gross return for one hand's stake (includes stake on win/push). */
export function handPayout(stake: number, result: HandResult): number {
  switch (result) {
    case "blackjack":
      return Math.floor(stake * 2.5) // 3:2
    case "win":
      return stake * 2
    case "push":
      return stake
    case "lose":
    case "bust":
      return 0
  }
}

export function compareHand(player: Card[], dealer: Card[], fromSplit = false): HandResult {
  if (isBust(player)) return "bust"
  const pBj = !fromSplit && isBlackjack(player)
  const dBj = isBlackjack(dealer)
  if (pBj && dBj) return "push"
  if (pBj) return "blackjack"
  if (dBj) return "lose"
  if (isBust(dealer)) return "win"
  const p = handValue(player).total
  const d = handValue(dealer).total
  if (p > d) return "win"
  if (p < d) return "lose"
  return "push"
}

/** Insurance pays 2:1 → gross return 3× stake when dealer has blackjack. */
export function insurancePayout(stake: number, dealerHasBj: boolean): number {
  if (stake <= 0) return 0
  return dealerHasBj ? stake * 3 : 0
}

export function settleRound(
  state: BlackjackPersistedState,
  shoe: Card[],
  totalWager: number,
): BlackjackSettlement {
  const hole = shoe[3]!
  let dealerCards = [state.dealerUp, hole]
  let next = state.nextCardIndex

  const playerAllDone = state.hands.every((h) => h.done || isBust(h.cards))
  const playerAllBust = state.hands.every((h) => isBust(h.cards))
  const dealerNatural = isBlackjack(dealerCards)
  // Naturals are already settled vs the two-card dealer — do not draw extra dealer cards
  // (looks like the dealer is hitting 17–21 after the player already won).
  // Split 21 is NOT a natural — dealer must still play out against it.
  const needsDealerDraw = state.hands.some((h) => !isBust(h.cards) && !isNaturalBlackjack(h))

  // Dealer plays only when a non-natural hand must be compared and no dealer peek-BJ.
  if (!dealerNatural && playerAllDone && !playerAllBust && needsDealerDraw) {
    const played = dealerPlay(shoe, next, dealerCards)
    dealerCards = played.cards
    next = played.nextCardIndex
  }

  const hands: SettledHand[] = state.hands.map((h) => {
    const result = compareHand(h.cards, dealerCards, h.fromSplit)
    return { ...h, result, payout: handPayout(h.stake, result) }
  })

  const insPay = insurancePayout(state.insuranceStake, isBlackjack([state.dealerUp, hole]))
  let payout = hands.reduce((s, h) => s + h.payout, 0) + insPay
  payout = Math.min(payout, MAX_PAYOUT)
  const multiplier = totalWager > 0 ? payout / totalWager : 0

  return {
    dealerCards,
    hands,
    insuranceStake: state.insuranceStake,
    insurancePayout: insPay,
    payout,
    multiplier,
  }
}

function sameRank(a: Card, b: Card): boolean {
  return a.rank === b.rank
}

export function availableActions(state: BlackjackPersistedState): BlackjackAction[] {
  if (state.phase === "insurance") return ["insure", "no_insurance"]
  if (state.phase !== "playing") return []

  const hand = state.hands[state.activeHand]
  if (!hand || hand.done) return []

  const actions: BlackjackAction[] = ["hit", "stand"]
  if (hand.cards.length === 2 && !hand.splitAces) {
    actions.push("double")
    if (
      state.hands.length === 1 &&
      !hand.fromSplit &&
      sameRank(hand.cards[0]!, hand.cards[1]!)
    ) {
      actions.push("split")
    }
  }
  return actions
}

export function toPublicView(
  state: BlackjackPersistedState,
  opts?: { dealerCards?: Card[] | null; settled?: boolean },
): BlackjackPublicView {
  const dealerCards = opts?.dealerCards ?? null
  const holeHidden = !dealerCards || dealerCards.length < 2
  const dealerForTotal = dealerCards && dealerCards.length >= 2 ? dealerCards : [state.dealerUp]

  return {
    hands: state.hands,
    activeHand: state.activeHand,
    dealerUp: state.dealerUp,
    dealerCards,
    holeHidden,
    phase: opts?.settled ? "settled" : state.phase,
    insuranceStake: state.insuranceStake,
    actions: opts?.settled ? [] : availableActions(state),
    totals: {
      player: state.hands.map((h) => {
        const v = handValue(h.cards)
        return { ...v, label: handLabel(h.cards, h.fromSplit) }
      }),
      dealer: {
        ...handValue(dealerForTotal),
        label: holeHidden ? handLabel([state.dealerUp]) : handLabel(dealerForTotal),
      },
    },
  }
}

/** Deal order: player, dealer-up, player, dealer-hole (indices 0..3). */
export function dealInitial(shoe: Card[], baseWager: number): BlackjackPersistedState {
  const player = [shoe[0]!, shoe[2]!]
  const dealerUp = shoe[1]!
  const hole = shoe[3]!

  const state: BlackjackPersistedState = {
    nextCardIndex: 4,
    hands: [
      {
        cards: player,
        stake: baseWager,
        done: false,
        doubled: false,
        fromSplit: false,
        splitAces: false,
      },
    ],
    activeHand: 0,
    dealerUp,
    phase: "playing",
    insuranceStake: 0,
    peeked: false,
  }

  // Ace up → offer insurance before peek.
  if (dealerUp.rank === "A") {
    state.phase = "insurance"
    return state
  }

  // Ten-value up → peek immediately.
  if (isTenValue(dealerUp)) {
    state.peeked = true
    if (isBlackjack([dealerUp, hole])) {
      // Dealer BJ — round will settle immediately in the router.
      state.hands[0]!.done = true
      return state
    }
  }

  // Player natural with no dealer peek threat (or peek cleared).
  if (isBlackjack(player)) {
    state.hands[0]!.done = true
  }

  return state
}

export function dealerHasBlackjack(shoe: Card[], dealerUp: Card): boolean {
  return isBlackjack([dealerUp, shoe[3]!])
}

export function shouldAutoSettleAfterDeal(state: BlackjackPersistedState, shoe: Card[]): boolean {
  if (state.phase === "insurance") return false
  if (state.peeked && dealerHasBlackjack(shoe, state.dealerUp)) return true
  if (state.hands.length === 1 && isBlackjack(state.hands[0]!.cards) && state.hands[0]!.done) {
    // Player BJ and dealer did not peek-BJ (or non-peek upcard).
    if (isTenValue(state.dealerUp) || state.dealerUp.rank === "A") {
      return state.peeked && !dealerHasBlackjack(shoe, state.dealerUp)
    }
    return true
  }
  return false
}

export type ActionResult =
  | { kind: "continue"; state: BlackjackPersistedState; extraStake: number }
  | { kind: "settle"; state: BlackjackPersistedState; extraStake: number }

function advanceActiveHand(state: BlackjackPersistedState): void {
  const hand = state.hands[state.activeHand]
  if (hand && !hand.done) return
  for (let i = state.activeHand + 1; i < state.hands.length; i++) {
    if (!state.hands[i]!.done) {
      state.activeHand = i
      return
    }
  }
  // All hands done — leave activeHand as-is; caller settles.
}

function allHandsDone(state: BlackjackPersistedState): boolean {
  return state.hands.every((h) => h.done)
}

export function applyNoInsurance(state: BlackjackPersistedState, shoe: Card[]): ActionResult {
  if (state.phase !== "insurance") throw new Error("not in insurance phase")
  const next = { ...state, hands: state.hands.map((h) => ({ ...h, cards: [...h.cards] })) }
  next.phase = "playing"
  next.peeked = true
  next.insuranceStake = 0

  if (dealerHasBlackjack(shoe, next.dealerUp)) {
    next.hands = next.hands.map((h) => ({ ...h, done: true }))
    return { kind: "settle", state: next, extraStake: 0 }
  }
  if (isBlackjack(next.hands[0]!.cards)) {
    next.hands[0] = { ...next.hands[0]!, done: true }
    return { kind: "settle", state: next, extraStake: 0 }
  }
  return { kind: "continue", state: next, extraStake: 0 }
}

export function applyInsure(state: BlackjackPersistedState, shoe: Card[], insuranceStake: number): ActionResult {
  if (state.phase !== "insurance") throw new Error("not in insurance phase")
  if (insuranceStake < 1) throw new Error("bad insurance stake")
  const next = { ...state, hands: state.hands.map((h) => ({ ...h, cards: [...h.cards] })) }
  next.phase = "playing"
  next.peeked = true
  next.insuranceStake = insuranceStake

  if (dealerHasBlackjack(shoe, next.dealerUp)) {
    next.hands = next.hands.map((h) => ({ ...h, done: true }))
    return { kind: "settle", state: next, extraStake: insuranceStake }
  }
  if (isBlackjack(next.hands[0]!.cards)) {
    next.hands[0] = { ...next.hands[0]!, done: true }
    return { kind: "settle", state: next, extraStake: insuranceStake }
  }
  return { kind: "continue", state: next, extraStake: insuranceStake }
}

export function applyHit(state: BlackjackPersistedState, shoe: Card[]): ActionResult {
  if (state.phase !== "playing") throw new Error("not playing")
  const actions = availableActions(state)
  if (!actions.includes("hit")) throw new Error("hit not allowed")

  const next = structuredClone(state) as BlackjackPersistedState
  const hand = next.hands[next.activeHand]!
  hand.cards.push(shoe[next.nextCardIndex]!)
  next.nextCardIndex++

  if (isBust(hand.cards) || handValue(hand.cards).total === 21) {
    hand.done = true
    advanceActiveHand(next)
  }

  if (allHandsDone(next)) return { kind: "settle", state: next, extraStake: 0 }
  return { kind: "continue", state: next, extraStake: 0 }
}

export function applyStand(state: BlackjackPersistedState): ActionResult {
  if (state.phase !== "playing") throw new Error("not playing")
  const actions = availableActions(state)
  if (!actions.includes("stand")) throw new Error("stand not allowed")

  const next = structuredClone(state) as BlackjackPersistedState
  next.hands[next.activeHand]!.done = true
  advanceActiveHand(next)

  if (allHandsDone(next)) return { kind: "settle", state: next, extraStake: 0 }
  return { kind: "continue", state: next, extraStake: 0 }
}

export function applyDouble(state: BlackjackPersistedState, shoe: Card[]): ActionResult {
  if (state.phase !== "playing") throw new Error("not playing")
  const actions = availableActions(state)
  if (!actions.includes("double")) throw new Error("double not allowed")

  const next = structuredClone(state) as BlackjackPersistedState
  const hand = next.hands[next.activeHand]!
  const extra = hand.stake
  hand.stake += extra
  hand.doubled = true
  hand.cards.push(shoe[next.nextCardIndex]!)
  next.nextCardIndex++
  hand.done = true
  advanceActiveHand(next)

  if (allHandsDone(next)) return { kind: "settle", state: next, extraStake: extra }
  return { kind: "continue", state: next, extraStake: extra }
}

export function applySplit(state: BlackjackPersistedState, shoe: Card[]): ActionResult {
  if (state.phase !== "playing") throw new Error("not playing")
  const actions = availableActions(state)
  if (!actions.includes("split")) throw new Error("split not allowed")

  const next = structuredClone(state) as BlackjackPersistedState
  const hand = next.hands[0]!
  const extra = hand.stake
  const a = hand.cards[0]!
  const b = hand.cards[1]!
  const splitAces = a.rank === "A"

  const hand0: PlayerHand = {
    cards: [a, shoe[next.nextCardIndex]!],
    stake: hand.stake,
    done: splitAces,
    doubled: false,
    fromSplit: true,
    splitAces,
  }
  next.nextCardIndex++
  const hand1: PlayerHand = {
    cards: [b, shoe[next.nextCardIndex]!],
    stake: hand.stake,
    done: splitAces,
    doubled: false,
    fromSplit: true,
    splitAces,
  }
  next.nextCardIndex++
  next.hands = [hand0, hand1]
  next.activeHand = splitAces ? 0 : hand0.done ? 1 : 0
  if (splitAces) {
    hand0.done = true
    hand1.done = true
    return { kind: "settle", state: next, extraStake: extra }
  }
  // Auto-finish a hand that already has 21.
  if (handValue(hand0.cards).total === 21) hand0.done = true
  if (handValue(hand1.cards).total === 21) hand1.done = true
  advanceActiveHand(next)
  if (allHandsDone(next)) return { kind: "settle", state: next, extraStake: extra }
  return { kind: "continue", state: next, extraStake: extra }
}

export function insuranceCost(baseWager: number): number {
  return Math.floor(baseWager / 2)
}

/** Card → short code for verifier / history ("AS", "10H"). */
export function cardCode(card: Card): string {
  return `${card.rank}${card.suit}`
}

export function parseCardCode(code: string): Card | null {
  const m = /^(10|[A2-9JQK])([SHDC])$/.exec(code)
  if (!m) return null
  return { rank: m[1] as Rank, suit: m[2] as Suit }
}
