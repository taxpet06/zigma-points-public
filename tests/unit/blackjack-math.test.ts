import { describe, it, expect } from "vitest"
import {
  handValue,
  isBlackjack,
  isBust,
  dealerShouldHit,
  dealerPlay,
  handPayout,
  compareHand,
  insurancePayout,
  insuranceCost,
  deriveBlackjackShoe,
  dealInitial,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
  applyInsure,
  applyNoInsurance,
  availableActions,
  toPublicView,
  settleRound,
  shouldAutoSettleAfterDeal,
  dealerHasBlackjack,
  cardCode,
  orderedShoe,
  BJ_SHOE_SIZE,
  type Card,
  type BlackjackPersistedState,
} from "@/lib/casino/blackjack"

const SEED = { serverSeed: "a".repeat(64), clientSeed: "test", nonce: 1 }

function c(rank: Card["rank"], suit: Card["suit"] = "S"): Card {
  return { rank, suit }
}

function baseState(overrides: Partial<BlackjackPersistedState> = {}): BlackjackPersistedState {
  return {
    nextCardIndex: 4,
    hands: [
      {
        cards: [c("10"), c("9")],
        stake: 10,
        done: false,
        doubled: false,
        fromSplit: false,
        splitAces: false,
      },
    ],
    activeHand: 0,
    dealerUp: c("6"),
    phase: "playing",
    insuranceStake: 0,
    peeked: true,
    ...overrides,
  }
}

describe("handValue / naturals", () => {
  it("counts hard totals", () => {
    expect(handValue([c("10"), c("9")])).toEqual({ total: 19, soft: false })
  })

  it("counts soft ace", () => {
    expect(handValue([c("A"), c("6")])).toEqual({ total: 17, soft: true })
  })

  it("keeps one ace soft when total allows", () => {
    // A+A+9 → one ace as 1, one as 11 → soft 21
    expect(handValue([c("A"), c("A"), c("9")])).toEqual({ total: 21, soft: true })
  })

  it("goes hard when both aces must count as 1", () => {
    expect(handValue([c("A"), c("A"), c("10"), c("9")])).toEqual({ total: 21, soft: false })
  })

  it("detects blackjack only on two-card 21", () => {
    expect(isBlackjack([c("A"), c("K")])).toBe(true)
    expect(isBlackjack([c("A"), c("5"), c("5")])).toBe(false)
  })

  it("detects bust", () => {
    expect(isBust([c("10"), c("9"), c("5")])).toBe(true)
  })
})

describe("dealer S17", () => {
  it("stands on soft 17", () => {
    expect(dealerShouldHit([c("A"), c("6")])).toBe(false)
  })

  it("hits soft 16", () => {
    expect(dealerShouldHit([c("A"), c("5")])).toBe(true)
  })

  it("hits hard 16", () => {
    expect(dealerShouldHit([c("10"), c("6")])).toBe(true)
  })

  it("stands on hard 17", () => {
    expect(dealerShouldHit([c("10"), c("7")])).toBe(false)
  })

  it("never hits 18–21", () => {
    expect(dealerShouldHit([c("10"), c("8")])).toBe(false)
    expect(dealerShouldHit([c("10"), c("9")])).toBe(false)
    expect(dealerShouldHit([c("10"), c("A")])).toBe(false)
    expect(dealerShouldHit([c("9"), c("5"), c("4")])).toBe(false) // hard 18
    expect(dealerShouldHit([c("7"), c("4"), c("6")])).toBe(false) // hard 17
  })

  it("dealerPlay leaves a 17 untouched", () => {
    const shoe = Array.from({ length: 20 }, () => c("9"))
    const { cards, nextCardIndex } = dealerPlay(shoe, 5, [c("10"), c("7")])
    expect(cards).toHaveLength(2)
    expect(nextCardIndex).toBe(5)
    expect(handValue(cards).total).toBe(17)
  })

  it("draws until 17+", () => {
    // Build a tiny fake shoe tail: dealer has 10+2, next cards 3 then 4 → 19
    const shoe = Array.from({ length: 20 }, () => c("2"))
    shoe[5] = c("3")
    shoe[6] = c("4")
    const { cards, nextCardIndex } = dealerPlay(shoe, 5, [c("10"), c("2")])
    expect(handValue(cards).total).toBeGreaterThanOrEqual(17)
    expect(nextCardIndex).toBeGreaterThan(5)
  })
})

describe("payouts", () => {
  it("pays blackjack 3:2 as 2.5× gross", () => {
    expect(handPayout(10, "blackjack")).toBe(25)
  })

  it("pays win 1:1 as 2× gross", () => {
    expect(handPayout(10, "win")).toBe(20)
  })

  it("push returns stake", () => {
    expect(handPayout(10, "push")).toBe(10)
  })

  it("lose/bust return 0", () => {
    expect(handPayout(10, "lose")).toBe(0)
    expect(handPayout(10, "bust")).toBe(0)
  })

  it("insurance pays 2:1 gross 3×", () => {
    expect(insurancePayout(5, true)).toBe(15)
    expect(insurancePayout(5, false)).toBe(0)
  })

  it("insurance cost is floor(half)", () => {
    expect(insuranceCost(10)).toBe(5)
    expect(insuranceCost(5)).toBe(2)
  })
})

describe("compareHand", () => {
  it("player BJ beats non-BJ dealer", () => {
    expect(compareHand([c("A"), c("K")], [c("10"), c("9")])).toBe("blackjack")
  })

  it("both BJ is push", () => {
    expect(compareHand([c("A"), c("K")], [c("A"), c("Q")])).toBe("push")
  })

  it("dealer BJ beats non-BJ", () => {
    expect(compareHand([c("10"), c("9")], [c("A"), c("K")])).toBe("lose")
  })

  it("split 21 is not a natural — pays win 1:1, not blackjack", () => {
    expect(compareHand([c("A"), c("K")], [c("10"), c("9")], true)).toBe("win")
  })

  it("split 21 loses to dealer BJ (not push)", () => {
    expect(compareHand([c("A"), c("K")], [c("A"), c("Q")], true)).toBe("lose")
  })
})

describe("deriveBlackjackShoe", () => {
  it("returns 312 cards deterministically", async () => {
    const a = await deriveBlackjackShoe(SEED)
    const b = await deriveBlackjackShoe(SEED)
    expect(a).toHaveLength(BJ_SHOE_SIZE)
    expect(a.map(cardCode)).toEqual(b.map(cardCode))
  })

  it("differs from ordered shoe (shuffle moved something)", async () => {
    const shuffled = await deriveBlackjackShoe(SEED)
    const ordered = orderedShoe()
    expect(shuffled.map(cardCode).join(",")).not.toBe(ordered.map(cardCode).join(","))
  })

  it("preserves multiset of ranks×suits×6", async () => {
    const shuffled = await deriveBlackjackShoe(SEED)
    const counts = new Map<string, number>()
    for (const card of shuffled) {
      const k = cardCode(card)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    expect(counts.size).toBe(52)
    for (const n of counts.values()) expect(n).toBe(6)
  })
})

describe("dealInitial + peek", () => {
  it("offers insurance on Ace up", async () => {
    const shoe = orderedShoe()
    // Force: P0, Ace up, P2, hole
    shoe[0] = c("10")
    shoe[1] = c("A")
    shoe[2] = c("9")
    shoe[3] = c("5")
    const state = dealInitial(shoe, 10)
    expect(state.phase).toBe("insurance")
    expect(state.dealerUp.rank).toBe("A")
    expect(shouldAutoSettleAfterDeal(state, shoe)).toBe(false)
  })

  it("auto-settles when ten-up dealer has BJ", async () => {
    const shoe = orderedShoe()
    shoe[0] = c("10")
    shoe[1] = c("K")
    shoe[2] = c("9")
    shoe[3] = c("A")
    const state = dealInitial(shoe, 10)
    expect(state.peeked).toBe(true)
    expect(dealerHasBlackjack(shoe, state.dealerUp)).toBe(true)
    expect(shouldAutoSettleAfterDeal(state, shoe)).toBe(true)
  })

  it("auto-settles player BJ vs non-peek upcard", () => {
    const shoe = orderedShoe()
    shoe[0] = c("A")
    shoe[1] = c("6")
    shoe[2] = c("K")
    shoe[3] = c("9")
    const state = dealInitial(shoe, 10)
    expect(isBlackjack(state.hands[0]!.cards)).toBe(true)
    expect(shouldAutoSettleAfterDeal(state, shoe)).toBe(true)
  })
})

describe("actions", () => {
  it("hit can bust and settle", () => {
    const shoe = orderedShoe()
    // Fill index 4 with a bust card
    const state = baseState({
      hands: [
        {
          cards: [c("10"), c("9")],
          stake: 10,
          done: false,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
      nextCardIndex: 4,
    })
    shoe[4] = c("5")
    const result = applyHit(state, shoe)
    expect(result.kind).toBe("settle")
    expect(isBust(result.state.hands[0]!.cards)).toBe(true)
  })

  it("stand settles single hand", () => {
    const result = applyStand(baseState())
    expect(result.kind).toBe("settle")
    expect(result.state.hands[0]!.done).toBe(true)
  })

  it("double adds stake and one card", () => {
    const shoe = orderedShoe()
    shoe[4] = c("2")
    const result = applyDouble(baseState(), shoe)
    expect(result.extraStake).toBe(10)
    expect(result.state.hands[0]!.stake).toBe(20)
    expect(result.state.hands[0]!.cards).toHaveLength(3)
    expect(result.state.hands[0]!.done).toBe(true)
    expect(result.kind).toBe("settle")
  })

  it("split creates two hands and charges equal stake", () => {
    const shoe = orderedShoe()
    shoe[4] = c("2")
    shoe[5] = c("3")
    const state = baseState({
      hands: [
        {
          cards: [c("8"), c("8")],
          stake: 10,
          done: false,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
    })
    expect(availableActions(state)).toContain("split")
    const result = applySplit(state, shoe)
    expect(result.extraStake).toBe(10)
    expect(result.state.hands).toHaveLength(2)
    expect(result.state.hands[0]!.cards[0]!.rank).toBe("8")
    expect(result.state.hands[1]!.cards[0]!.rank).toBe("8")
  })

  it("split aces deals one each and settles", () => {
    const shoe = orderedShoe()
    shoe[4] = c("9")
    shoe[5] = c("5")
    const state = baseState({
      hands: [
        {
          cards: [c("A"), c("A")],
          stake: 10,
          done: false,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
    })
    const result = applySplit(state, shoe)
    expect(result.kind).toBe("settle")
    expect(result.state.hands.every((h) => h.done && h.splitAces)).toBe(true)
  })
})

describe("insurance flow", () => {
  it("no_insurance then dealer BJ settles", () => {
    const shoe = orderedShoe()
    shoe[3] = c("K")
    const state = baseState({
      phase: "insurance",
      dealerUp: c("A"),
      peeked: false,
      hands: [
        {
          cards: [c("10"), c("9")],
          stake: 10,
          done: false,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
    })
    const result = applyNoInsurance(state, shoe)
    expect(result.kind).toBe("settle")
    expect(result.state.peeked).toBe(true)
  })

  it("insure charges extra and continues when no dealer BJ", () => {
    const shoe = orderedShoe()
    shoe[3] = c("5")
    const state = baseState({
      phase: "insurance",
      dealerUp: c("A"),
      peeked: false,
    })
    const result = applyInsure(state, shoe, 5)
    expect(result.kind).toBe("continue")
    expect(result.extraStake).toBe(5)
    expect(result.state.insuranceStake).toBe(5)
    expect(result.state.phase).toBe("playing")
  })
})

describe("insurance + auto-settle gates", () => {
  it("Ace up offers insurance and does not auto-settle", () => {
    const shoe = orderedShoe()
    shoe[0] = c("10")
    shoe[1] = c("A")
    shoe[2] = c("9")
    shoe[3] = c("K") // dealer BJ waiting under Ace
    const state = dealInitial(shoe, 10)
    expect(state.phase).toBe("insurance")
    expect(shouldAutoSettleAfterDeal(state, shoe)).toBe(false)
  })

  it("declining insurance vs dealer BJ settles as a loss", () => {
    const shoe = orderedShoe()
    shoe[0] = c("10")
    shoe[1] = c("A")
    shoe[2] = c("9")
    shoe[3] = c("K")
    const state = dealInitial(shoe, 10)
    const result = applyNoInsurance(state, shoe)
    expect(result.kind).toBe("settle")
    const settled = settleRound(result.state, shoe, 10)
    expect(settled.hands[0]!.result).toBe("lose")
    expect(settled.payout).toBe(0)
  })

  it("taking insurance vs dealer BJ pays 2:1 on the insurance stake", () => {
    const shoe = orderedShoe()
    shoe[0] = c("10")
    shoe[1] = c("A")
    shoe[2] = c("9")
    shoe[3] = c("K")
    const state = dealInitial(shoe, 10)
    const result = applyInsure(state, shoe, 5)
    expect(result.kind).toBe("settle")
    expect(result.extraStake).toBe(5)
    const settled = settleRound(result.state, shoe, 15)
    expect(settled.insurancePayout).toBe(15) // 5 * 3
    expect(settled.hands[0]!.payout).toBe(0)
    expect(settled.payout).toBe(15)
  })

  it("ten-up dealer BJ auto-settles (peek) without insurance", () => {
    const shoe = orderedShoe()
    shoe[0] = c("10")
    shoe[1] = c("K")
    shoe[2] = c("9")
    shoe[3] = c("A")
    const state = dealInitial(shoe, 10)
    expect(state.phase).toBe("playing")
    expect(shouldAutoSettleAfterDeal(state, shoe)).toBe(true)
  })
})

describe("toPublicView anti-leak", () => {
  it("hides hole when dealerCards omitted", () => {
    const view = toPublicView(baseState())
    expect(view.holeHidden).toBe(true)
    expect(view.dealerCards).toBeNull()
    expect(JSON.stringify(view)).not.toMatch(/"hole"/i)
  })
})

describe("settleRound", () => {
  it("pays player win against dealer bust", () => {
    const shoe = orderedShoe()
    // dealer up 10, hole 6, next card 8 → 24 bust
    shoe[3] = c("6")
    shoe[4] = c("8")
    const state = baseState({
      dealerUp: c("10"),
      nextCardIndex: 4,
      hands: [
        {
          cards: [c("10"), c("9")],
          stake: 10,
          done: true,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
    })
    const settled = settleRound(state, shoe, 10)
    expect(isBust(settled.dealerCards)).toBe(true)
    expect(settled.hands[0]!.result).toBe("win")
    expect(settled.payout).toBe(20)
    expect(settled.multiplier).toBe(2)
  })

  it("split 21 pays 1:1 and still forces dealer to draw", () => {
    const shoe = orderedShoe()
    // Dealer 6+5=11, must hit; next card 10 → 21 push against split 21
    shoe[3] = c("5")
    shoe[4] = c("10")
    const state = baseState({
      dealerUp: c("6"),
      nextCardIndex: 4,
      hands: [
        {
          cards: [c("A"), c("K")],
          stake: 10,
          done: true,
          doubled: false,
          fromSplit: true,
          splitAces: false,
        },
      ],
    })
    const settled = settleRound(state, shoe, 10)
    expect(settled.dealerCards).toHaveLength(3)
    expect(settled.hands[0]!.result).toBe("push")
    expect(settled.hands[0]!.payout).toBe(10)
  })

  it("true natural still skips dealer draw and pays 3:2", () => {
    const shoe = orderedShoe()
    shoe[3] = c("5")
    shoe[4] = c("10") // would be drawn if we wrongly treated this like a split 21
    const state = baseState({
      dealerUp: c("6"),
      nextCardIndex: 4,
      hands: [
        {
          cards: [c("A"), c("K")],
          stake: 10,
          done: true,
          doubled: false,
          fromSplit: false,
          splitAces: false,
        },
      ],
    })
    const settled = settleRound(state, shoe, 10)
    expect(settled.dealerCards).toHaveLength(2)
    expect(settled.hands[0]!.result).toBe("blackjack")
    expect(settled.payout).toBe(25)
  })
})
