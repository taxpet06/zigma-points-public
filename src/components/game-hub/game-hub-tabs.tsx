"use client"

// GameHubTabs — Casual vs Competitive vs Casino. Same shadcn Tabs primitives the home
// page uses, so the hub reads as part of the app rather than its own thing.
//
//   Casual      — no leaderboard. One free ZP-earning try a day; some can be replayed
//                 for ZP (the slot machine), some can't (Wordle is one word a day).
//   Competitive — leaderboards. One free ZP-earning run a day, then paid replays that
//                 rank but don't bank. The real money is the podium.
//   Casino      — wager ZP against the house, provably fair. No free plays (10-CONTEXT.md
//                 § Economy rejects them). Phase 10 was the foundation only; Phases 11-16
//                 each wired up one live game, and all seven now ship (Plinko, Mines, Dice,
//                 Wheel, Chicken Cross, Avia Masters, Blackjack) — no inert "coming soon" tile remains.
//
// Grid + card shell are shared with the People grid (feed/home-tabs.tsx) via GameCard.
//
// TabsList/TabsTrigger sizing below overrides the shadcn defaults (fixed-height list,
// `px-3 text-sm` triggers) for the WHOLE row, not just Casino. The shipped list height
// caps every trigger at 32px, under the 44px touch-target floor (MOBL-02) — a pre-existing
// bug across Casual and Competitive too, fixed here because adding a third label is what
// surfaced it. See 10-UI-SPEC.md § the 3-tab question for the arithmetic.

import { Dices, Trophy, Spade } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DailyReward } from "@/components/daily-reward/daily-reward"
import { Wordle } from "@/components/game-hub/wordle"
import { Minezweeper } from "@/components/game-hub/minezweeper/minezweeper"
import { Flappy } from "@/private-games/flappy/flappy"
import { Tetris } from "@/components/game-hub/tetris/tetris"
import { Znake } from "@/private-games/znake/znake"
import { Jj } from "@/private-games/jj/jj"
import { BombAxa } from "@/private-games/bomb-axa/bomb-axa"
import { Zross } from "@/components/game-hub/zross/zross"
import { SequenceRecall } from "@/components/game-hub/sequence-recall/sequence-recall"
import { Insamotherfuckingllah } from "@/private-games/insamotherfuckingllah/insamotherfuckingllah"
import { ZpRules } from "@/components/game-hub/zp-rules"
import { CasinoFairnessDialog } from "@/components/game-hub/casino/casino-fairness-dialog"
import { Plinko } from "@/components/game-hub/casino/plinko/plinko"
import { Mines } from "@/components/game-hub/casino/mines/mines"
import { Dice } from "@/components/game-hub/casino/dice/dice"
import { Wheel } from "@/components/game-hub/casino/wheel/wheel"
import { Chicken } from "@/private-games/chicken/chicken"
import { Aviamasters } from "@/components/game-hub/casino/aviamasters/aviamasters"
import { Blackjack } from "@/components/game-hub/casino/blackjack/blackjack"
import { COMPETITIVE_REPLAY_COST, DAILY_PRIZES } from "@/lib/game-economy"
import { MIN_BET, MAX_BET, MAX_PAYOUT } from "@/lib/casino/limits"
import { CASINO_GAMES, CASINO_RULES } from "@/lib/casino/games"

const TAB_TRIGGER = "min-h-11 px-2 text-xs sm:px-3 sm:text-sm"

export function GameHubTabs() {
  return (
    <Tabs defaultValue="casual">
      <TabsList className="grid h-auto w-full grid-cols-3 p-1">
        <TabsTrigger value="casual" className={TAB_TRIGGER}>
          <Dices className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Casual
        </TabsTrigger>
        <TabsTrigger value="competitive" className={TAB_TRIGGER}>
          <Trophy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Competitive
        </TabsTrigger>
        <TabsTrigger value="casino" className={TAB_TRIGGER}>
          <Spade className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Casino
        </TabsTrigger>
      </TabsList>

      <TabsContent value="casual" className="mt-4">
        <p className="mb-4 text-sm text-muted-foreground text-pretty">
          Games without a leaderboard. You get{" "}
          {/* Explicit {" "}: SWC drops a text node's leading space when that node also
              carries an HTML entity (&rsquo; below), which ate the space after the bold
              run. The competitive copy has no entity, which is why only this one broke. */}
          <span className="font-medium text-foreground">1 free try a day</span>{" "}
          for each game. Some can be replayed for ZP — check each game&rsquo;s rules.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DailyReward variant="card" />
          <Wordle index={1} />
          {/* JJ is the one casual game with no per-day allowance to spend: it's a
              streak, so the card is "available" whenever he's hungry or owes ZP. */}
          <Jj index={2} />
          <Minezweeper index={3} />
          {/* Bomb AXA is the other card with no allowance to spend — it can't be lost, so
              the day's ZP is only consumed by finishing, and replays are free forever. */}
          <BombAxa index={4} />
        </div>
      </TabsContent>

      <TabsContent value="competitive" className="mt-4">
        <p className="mb-4 text-sm text-muted-foreground text-pretty">
          Compete with your friends for the best score. You get{" "}
          <span className="font-medium text-foreground">1 free try a day</span> for each
          game — replays cost {COMPETITIVE_REPLAY_COST} ZP and still climb the
          leaderboard, but bank no ZP of their own.{" "}
          <span className="font-medium text-foreground">
            Topping the leaderboard pays up to {DAILY_PRIZES[0]} ZP a day.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Flappy index={0} />
          <Tetris index={1} />
          <Znake index={2} />
          <Zross index={3} />
          <SequenceRecall index={4} />
          <Insamotherfuckingllah index={5} />
        </div>
      </TabsContent>

      <TabsContent value="casino" className="mt-4">
        <p className="mb-4 text-sm text-muted-foreground text-pretty">
          Wager your ZP against the house. Every round is provably fair — the outcome is
          fixed before you bet, and you can check it yourself. Bets are {MIN_BET}–
          {MAX_BET} ZP, and a single round pays at most {MAX_PAYOUT.toLocaleString()} ZP.
        </p>
        <ZpRules
          rules={CASINO_RULES}
          replayNote="Every round is provably fair — you can check the maths yourself in Provably fair below."
          className="mb-4"
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CASINO_GAMES.map((game, i) =>
            // Plinko, Mines, Dice, Wheel, Chicken Cross and Avia Masters are all six games
            // shipped now (11-06-PLAN.md, 12-04-PLAN.md, 13-04-PLAN.md, 14-03-PLAN.md,
            // 15-05-PLAN.md, 16-04-PLAN.md) — a plain conditional here is still smaller and
            // clearer than a slug→component lookup. The chain being complete is exactly when a
            // slug-to-component lookup could be revisited — but six games is still not a
            // framework, and extracting the commonality now, at the end of the milestone, buys
            // nothing.
            game.slug === "PLINKO" ? (
              <Plinko key={game.slug} index={i} />
            ) : game.slug === "MINES" ? (
              <Mines key={game.slug} index={i} />
            ) : game.slug === "DICE" ? (
              <Dice key={game.slug} index={i} />
            ) : game.slug === "WHEEL" ? (
              <Wheel key={game.slug} index={i} />
            ) : game.slug === "CHICKEN" ? (
              <Chicken key={game.slug} index={i} />
            ) : game.slug === "AVIAMASTERS" ? (
              <Aviamasters key={game.slug} index={i} />
            ) : game.slug === "BLACKJACK" ? (
              <Blackjack key={game.slug} index={i} />
            ) : null,
          )}
        </div>
        {/* Muted, not crimson — "provably fair" never becomes a badge, an overlay or a
            toast (10-UI-SPEC.md § 4). This is the fairness surface's only entry point
            while no game has shipped yet. */}
        <div className="mt-4">
          <CasinoFairnessDialog />
        </div>
      </TabsContent>
    </Tabs>
  )
}
