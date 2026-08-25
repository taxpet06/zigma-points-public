// Root tRPC router — composes all sub-routers.
// AppRouter is exported as a type so client code can infer types without bundling server code.

import { createTRPCRouter } from "@/trpc/init"
import { userRouter } from "@/trpc/routers/user"
import { postRouter } from "@/trpc/routers/post"
import { replyRouter } from "@/trpc/routers/reply"
import { taskRouter } from "@/trpc/routers/task"    // Phase 6
import { adminRouter } from "@/trpc/routers/admin"  // Phase 6
import { betRouter } from "@/trpc/routers/bet"
import { pushRouter } from "@/trpc/routers/push"    // Phase 7
import { transferRouter } from "@/trpc/routers/transfer"
import { dailyRewardRouter } from "@/trpc/routers/dailyReward"
import { wordleRouter } from "@/trpc/routers/wordle"
import { minezweeperRouter } from "@/trpc/routers/minezweeper"
import { flappyRouter } from "@/private-games/flappy/router"
import { shopRouter } from "@/trpc/routers/shop"
import { tetrisRouter } from "@/trpc/routers/tetris"
import { casinoRouter } from "@/trpc/routers/casino"
import { plinkoRouter } from "@/trpc/routers/plinko" // Phase 11
import { minesRouter } from "@/trpc/routers/mines"   // Phase 12
import { diceRouter } from "@/trpc/routers/dice"     // Phase 13
import { wheelRouter } from "@/trpc/routers/wheel"   // Phase 14
import { chickenRouter } from "@/private-games/chicken/router" // Phase 15
import { aviamastersRouter } from "@/trpc/routers/aviamasters" // Phase 16
import { blackjackRouter } from "@/trpc/routers/blackjack"
import { znakeRouter } from "@/private-games/znake/router"
import { jjRouter } from "@/private-games/jj/router"
import { bombAxaRouter } from "@/private-games/bomb-axa/router"
import { zrossRouter } from "@/components/game-hub/zross/router"
import { sequenceRecallRouter } from "@/components/game-hub/sequence-recall/router"
import { insamotherfuckingllahRouter } from "@/private-games/insamotherfuckingllah/router"
import { listingRouter } from "@/trpc/routers/listing" // Phase 20
import { termRouter } from "@/trpc/routers/term"

export const appRouter = createTRPCRouter({
  user: userRouter,
  post: postRouter,
  reply: replyRouter,
  task: taskRouter,    // Phase 6
  admin: adminRouter,  // Phase 6
  bet: betRouter,
  push: pushRouter,    // Phase 7
  transfer: transferRouter,
  dailyReward: dailyRewardRouter,
  wordle: wordleRouter,
  minezweeper: minezweeperRouter,
  flappy: flappyRouter,
  shop: shopRouter,    // Phase 8
  tetris: tetrisRouter, // Phase 9
  casino: casinoRouter, // Phase 10
  plinko: plinkoRouter, // Phase 11
  mines: minesRouter,   // Phase 12
  dice: diceRouter,     // Phase 13
  wheel: wheelRouter,   // Phase 14
  chicken: chickenRouter, // Phase 15
  aviamasters: aviamastersRouter, // Phase 16
  blackjack: blackjackRouter,
  znake: znakeRouter,
  jj: jjRouter,
  bombAxa: bombAxaRouter,
  zross: zrossRouter,
  sequenceRecall: sequenceRecallRouter,
  insamotherfuckingllah: insamotherfuckingllahRouter,
  listing: listingRouter, // Phase 20
  term: termRouter,
})

// Export type only — client-side code imports this for type inference
export type AppRouter = typeof appRouter
