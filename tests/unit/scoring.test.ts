import { describe, it, expect } from "vitest"
import {
  percentiles,
  scoreUsers,
  winnerOf,
  WEIGHTS,
  PILLARS,
  RARITY_SCORE,
  type RawMetrics,
} from "@/lib/scoring"

// The scoring math decides who gets a physical trophy, so the parts worth pinning are
// the ones that would silently change a placing: the percentile edge cases (all-tied,
// zeros, negatives), the weights summing to the advertised 100, and the tiebreak chain
// firing in the documented order.

/** A user with every metric at zero — override only what a test is about. */
function user(userId: string, over: Partial<RawMetrics> = {}): RawMetrics {
  const base = { userId, isAdmin: false, isDisqualified: false } as RawMetrics
  for (const pillar of PILLARS) {
    for (const metric of Object.keys(WEIGHTS[pillar])) {
      ;(base as unknown as Record<string, number>)[metric] = 0
    }
  }
  return { ...base, ...over }
}

describe("percentiles", () => {
  it("gives the unique top 1 and the unique bottom 0", () => {
    expect(percentiles([1, 2, 3])).toEqual([0, 0.5, 1])
  })

  it("scores everyone 0 when the whole field is identical", () => {
    // Nobody differentiated themselves — the metric carries no information, so it must
    // not hand out free points on the published out-of-100 total.
    expect(percentiles([7, 7, 7])).toEqual([0, 0, 0])
    expect(percentiles([0, 0, 0])).toEqual([0, 0, 0])
  })

  it("scores 0 for doing none of it, even when others also did none", () => {
    // The textbook fractional rank would average these four zeros to 0.25. That hands a
    // quarter of the metric's weight to people who never touched it, for having company.
    expect(percentiles([0, 0, 0, 0, 10])).toEqual([0, 0, 0, 0, 1])
  })

  it("scores a negative (a net-losing casino ROI) as 0, not below 0", () => {
    const [loss, flat, win] = percentiles([-50, 0, 50])
    expect(loss).toBe(0)
    expect(flat).toBe(0)
    expect(win).toBe(1)
  })

  it("averages ties among non-zero values", () => {
    // 1, 5, 5, 9 over a field of 4: the tied pair sits at (1 + 0.5) / 3.
    expect(percentiles([1, 5, 5, 9])).toEqual([0, 0.5, 0.5, 1])
  })

  it("handles the degenerate fields", () => {
    expect(percentiles([])).toEqual([])
    expect(percentiles([4])).toEqual([1])
    expect(percentiles([0])).toEqual([0])
  })
})

describe("WEIGHTS", () => {
  it("totals exactly 100 across the six pillars", () => {
    const total = PILLARS.reduce(
      (sum, p) => sum + Object.values(WEIGHTS[p]).reduce((a: number, b: number) => a + b, 0),
      0,
    )
    expect(total).toBe(100)
  })

  it("keeps the published per-pillar split", () => {
    const perPillar = Object.fromEntries(
      PILLARS.map((p) => [p, Object.values(WEIGHTS[p]).reduce((a: number, b: number) => a + b, 0)]),
    )
    expect(perPillar).toEqual({
      community: 29,
      economy: 18,
      games: 18,
      consistency: 12,
      collection: 12,
      betting: 11,
    })
  })
})

describe("RARITY_SCORE", () => {
  it("is the tame curve, not inverse drop odds", () => {
    // Inverse odds (13.5/6/1 in lib/cosmetics.ts) would put a legendary at 13.5 commons
    // and let one lucky box decide the pillar. Guard against a silent swap back.
    expect(RARITY_SCORE).toEqual({ COMMON: 1, RARE: 1.5, LEGENDARY: 3.7 })
    expect(RARITY_SCORE.LEGENDARY / RARITY_SCORE.COMMON).toBeLessThan(5)
  })
})

describe("scoreUsers", () => {
  it("ranks a clean sweep first and awards the full 100", () => {
    const scored = scoreUsers([
      user("sweeper", {
        postsAuthored: 10,
        postSuccess: 10,
        votesCast: 10,
        postsAboutYou: 10,
        replies: 10,
        zpEarned: 10,
        zpBalance: 10,
        marketplace: 10,
        podiums: 10,
        gameBreadth: 10,
        dailyGames: 10,
        activeDays: 10,
        antiCrunch: 1,
        jjStreak: 10,
        cosmeticRarity: 10,
        cosmeticDepth: 10,
        profile: 6,
        poolsCreated: 10,
        betsPlayed: 10,
        casinoActivity: 10,
        casinoRoi: 10,
      }),
      user("ghost"),
    ])
    expect(scored[0].userId).toBe("sweeper")
    expect(scored[0].rank).toBe(1)
    expect(scored[0].total).toBe(100)
    expect(scored[1].total).toBe(0)
    expect(scored[1].rank).toBe(2)
  })

  it("ranks on total before any tiebreak fires", () => {
    // Not a tie at all: podiums weighs 8, votesCast 6, so the gamer simply scores more.
    const scored = scoreUsers([user("gamer", { podiums: 5 }), user("poster", { votesCast: 5 })])
    expect(scored[0].userId).toBe("gamer")
    expect(scored[0].total).toBe(8)
    expect(scored[1].total).toBe(6)
  })

  it("breaks a genuine total tie on the community pillar", () => {
    // votesCast (community, 6) and activeDays (consistency, 6) weigh the same, so both
    // users total 6. Community is the first tiebreak, so the voter takes rank 1.
    // NB activeDays is a scored metric as well as a tiebreak — that is why this test
    // ties on the total rather than trying to reach the activeDays tiebreak directly,
    // which by construction only fires when two users match on total AND community.
    const tied = scoreUsers([user("grinder", { activeDays: 5 }), user("voter", { votesCast: 5 })])
    expect(tied[0].total).toBe(tied[1].total)
    expect(tied[0].userId).toBe("voter")
  })

  it("is deterministic when two users are identical on every tiebreak", () => {
    const once = scoreUsers([user("bbb", { votesCast: 3 }), user("aaa", { votesCast: 3 })])
    const again = scoreUsers([user("aaa", { votesCast: 3 }), user("bbb", { votesCast: 3 })])
    expect(once.map((s) => s.userId)).toEqual(again.map((s) => s.userId))
    expect(once[0].userId).toBe("aaa")
  })

  it("returns an empty board for an empty field", () => {
    expect(scoreUsers([])).toEqual([])
  })
})

describe("pillar rounding", () => {
  it("keeps the six pillar columns summing to the printed total", () => {
    // The admin Podium prints both; a placing is contested by pointing at that table,
    // so the columns must add up. Rounding each pillar and the raw sum independently
    // let them disagree by up to 0.03.
    const scored = scoreUsers([
      user("a", { postsAuthored: 3, votesCast: 7, zpEarned: 11, podiums: 2, activeDays: 5, cosmeticRarity: 4, betsPlayed: 1 }),
      user("b", { postsAuthored: 1, votesCast: 2, zpEarned: 3, podiums: 9, activeDays: 8, cosmeticRarity: 6, betsPlayed: 4 }),
      user("c", { postsAuthored: 2, votesCast: 5, zpEarned: 7, podiums: 5, activeDays: 2, cosmeticRarity: 1, betsPlayed: 9 }),
    ])
    for (const s of scored) {
      const summed = PILLARS.reduce((acc, p) => acc + s.pillars[p], 0)
      expect(Math.round(summed * 100) / 100).toBe(s.total)
    }
  })
})

describe("winnerOf", () => {
  it("skips an admin at the top and crowns the best non-admin", () => {
    const scored = scoreUsers([
      user("boss", { postsAuthored: 99, isAdmin: true }),
      user("player", { postsAuthored: 50 }),
      user("ghost"),
    ])
    expect(scored[0].userId).toBe("boss") // still ranked
    expect(winnerOf(scored)).toBe("player")
  })

  it("has no winner when the field is empty or all admins", () => {
    expect(winnerOf([])).toBeNull()
    expect(winnerOf(scoreUsers([user("a", { isAdmin: true, votesCast: 3 })]))).toBeNull()
  })

  it("skips a Zigma Pooper but leaves their rank untouched", () => {
    // Disqualification must be visible, not an erasure: the pooper keeps rank 1 on the
    // board and the crown passes to the next eligible person below them.
    const scored = scoreUsers([
      user("pooper", { postsAuthored: 99, isDisqualified: true }),
      user("clean", { postsAuthored: 50 }),
      user("ghost"),
    ])
    expect(scored[0].userId).toBe("pooper")
    expect(scored[0].rank).toBe(1)
    expect(scored[0].isDisqualified).toBe(true)
    expect(winnerOf(scored)).toBe("clean")
  })

  it("has no winner when everyone eligible is pooped or an admin", () => {
    const scored = scoreUsers([
      user("boss", { postsAuthored: 9, isAdmin: true }),
      user("pooper", { postsAuthored: 5, isDisqualified: true }),
    ])
    expect(scored).toHaveLength(2)
    expect(winnerOf(scored)).toBeNull()
  })

  it("skips a pooper who is also an admin without double-counting", () => {
    const scored = scoreUsers([
      user("both", { postsAuthored: 9, isAdmin: true, isDisqualified: true }),
      user("clean", { postsAuthored: 5 }),
    ])
    expect(winnerOf(scored)).toBe("clean")
  })
})

// A mid-term preview must not publish a trophy. Term.winnerId is not a private note —
// it feeds User.termsWon, which renders a MaxxerTrophy on the profile and on every
// People card. This pins the RULE (winner only once the term has ended); the write
// itself lives in lib/scoring-run.ts and is covered by its own DB check.
describe("winner eligibility over time", () => {
  const ended = (endsAt: Date, now: Date) => endsAt <= now

  it("withholds a winner while the term is still running", () => {
    const now = new Date("2026-08-25T20:00:00Z")
    expect(ended(new Date("2026-08-25T22:00:00Z"), now)).toBe(false)
  })

  it("awards one from the instant the term ends, inclusive", () => {
    const endsAt = new Date("2026-08-25T22:00:00Z")
    expect(ended(endsAt, new Date("2026-08-25T22:00:00Z"))).toBe(true)
    expect(ended(endsAt, new Date("2026-08-25T22:00:01Z"))).toBe(true)
  })
})
