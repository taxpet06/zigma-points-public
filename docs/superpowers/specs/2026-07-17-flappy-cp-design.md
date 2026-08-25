# Flappy CP — Design Spec

**Date:** 2026-07-17
**Branch:** `aaron/flappy-bird`
**Status:** Approved by user; ready for implementation planning.

## 1. Overview

**Flappy CP** is a Flappy Bird clone in the game hub (`/game-hub`).

- Tap-to-flap arcade physics.
- Costs **5 CP** to start a run (debited authoritatively on the server).
- Earn **+1 CP live** for each edible eaten — the user's real balance updates mid-run.
- Run ends on collision with a pillar, floor, or ceiling.
- **3 runs per calendar day**, reset at midnight America/New_York (matches Wordle).
- Rendered on `<canvas>` inside the existing `GameDialog`.
- Anti-cheat: server-issued deterministic seed + claim-once edibles + rate limiting.
- Placeholder-rectangle art in v1; sprite loader is asset-agnostic so real PNGs (bird-mouth-closed, bird-mouth-open, pillar, edible) can be dropped in later with a one-file change.

**Explicitly out of scope for v1 (planned as v2 follow-ups):**
- Sound effects (`sounds.ts` sibling hook point reserved next to `sprites.ts`).
- Leaderboard (`FlappyRun` schema is designed to support it with zero migrations).

## 2. UX & Game Feel

### Controls

- **Mobile:** `pointerdown` on the canvas triggers a flap (not `click`, to avoid the ~300ms mobile delay).
- **Desktop:** `Space` and `ArrowUp` also flap. A `keydown` listener is attached only while the modal is open (same pattern as `wordle.tsx`).

### Pull-to-refresh conflict

The app uses `PullToRefresh`. The canvas element sets `touch-action: none` and calls `preventDefault` on pointer events while the modal is open, so in-game swipes never bubble to the refresh gesture.

### Game states

Three states, all rendered as canvas overlays (no separate screens):

1. **Ready** — bird hovers static. Overlay text: `"Tap to start · 5 CP to play"`. **Nothing is debited yet.** The `start` mutation fires on the **first flap**, so opening and closing the dialog costs nothing.
2. **Playing** — physics + scrolling world. HUD top-left: `+N CP earned` (this run). HUD top-right: current live balance from `trpc.user.getMe`.
3. **Over** — bird falls, world freezes. Overlay: `"Run over · +N CP earned · {runsRemaining} left today"`. Buttons: **Play again** (only when `runsRemaining > 0` AND `balance >= 5`) or **Close**.

### Visual polish (v1, no assets)

- Sky background (Tailwind `sky-400` fill).
- Bird: yellow rounded square, tilted via `atan2(vy, 300)`.
- Pillars: green rectangles.
- Edibles: white circles.
- On eat: a brief scale-pop on the bird via a `mouthOpenUntil` timestamp — this render pathway is the same one that will later swap the mouth-open sprite in.

### Mobile canvas sizing

- Canvas is 100% of modal width, fixed `aspect-ratio: 3/4` (portrait).
- All physics constants are per-second and expressed in canvas-relative units (fractions of width/height), so a phone and a desktop see the same game shape at different scales.

### Accessibility

- Respects `prefers-reduced-motion`: eat scale-pop and death shake are disabled; core physics remain (the game *is* motion).

## 3. Architecture

### New files

```
src/components/game-hub/flappy/
  flappy.tsx              # GameCard + GameDialog host; owns tRPC calls; mounts <FlappyGame/>.
  flappy-game.tsx         # <canvas> host; owns requestAnimationFrame loop; forwards
                          # eat/end events up via callbacks.
  engine.ts               # Pure physics/state. No React, no DOM, no tRPC.
                          # Exports: createWorld(seed), step(world, dt, input), eat(world, idx).
  rng.ts                  # Deterministic PRNG (mulberry32).
  sprites.ts              # Sprite indirection layer. v1: draws colored primitives.
                          # v2: loads /game-hub/flappy/*.png and swaps to drawImage().
  constants.ts            # Physics + layout tunables.
  engine.test.ts          # Vitest unit tests for engine.ts.
  rng.test.ts             # Vitest unit tests for rng.ts.

src/trpc/routers/flappy.ts      # tRPC router (Section 5).
src/trpc/routers/flappy.test.ts # Integration tests.

src/lib/flappy-seed.ts       # Shared seed→layout function. Imported by BOTH the
                             # client (to render) AND the server (to validate). Single
                             # source of truth for anti-cheat.
src/lib/flappy-seed.test.ts  # Determinism + layout constraint tests.

prisma/schema.prisma         # +model FlappyRun, +enum FlappyRunStatus (Section 4).

tests/e2e/flappy.spec.ts     # Playwright E2E.
```

### Modified files

```
src/app/game-hub/page.tsx    # Add <Flappy index={2} /> to the game grid.
src/trpc/routers/_app.ts     # Register flappyRouter.
```

### Constants (`constants.ts`)

```ts
export const ENTRY_COST = 5
export const PLAYS_PER_DAY = 3
export const PIPE_INTERVAL_PX = 260      // gap-to-gap horizontal spacing
export const GAP_HEIGHT = 180            // vertical opening between top/bottom pillars
export const SCROLL_SPEED = 200          // px/sec
export const GRAVITY = 1200              // px/sec²
export const FLAP_VELOCITY = -420        // negative = up
export const MOUTH_OPEN_MS = 200
export const SWEEP_ACTIVE_AFTER_MS = 5 * 60_000   // 5min → sweep to ABANDONED
export const MIN_MS_PER_EDIBLE = 600     // physical minimum; server rate-limit ceiling
```

### Module boundaries — rationale

- **`engine.ts` is pure** — no `window`, no React, no fetch. It's a state machine over a `World` value plus a `step()` function. This makes it 100% unit-testable without a browser.
- **`flappy-seed.ts` is the load-bearing shared truth** — both the client renderer and the server validator import it. Kept out of `engine.ts` so the server never pulls engine code that touches `window`.
- **`sprites.ts` is the only file that knows about primitive-vs-image** — when real PNGs arrive, we replace `ctx.fillRect(...)` with `ctx.drawImage(...)` inside this one file. Nothing else in the tree changes. A future `sounds.ts` sibling will follow the same pattern.

## 4. Data Model

New Prisma model + enum. Single migration; no data backfill.

```prisma
enum FlappyRunStatus {
  ACTIVE      // debited 5, run in progress on the client
  ENDED       // client sent 'end' — final CP already credited
  ABANDONED   // no activity for > 5min — swept by next start() call
}

model FlappyRun {
  id          String          @id @default(cuid())
  userId      String
  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  day         String          // dayKey(); used for 3-runs-per-day cap and future leaderboard
  seed        Int             // 32-bit uint; both sides derive layout from it
  status      FlappyRunStatus @default(ACTIVE)

  entryCost   Int             @default(5)  // captured at start for future price flexibility
  cpEarned    Int             @default(0)  // running total; incremented on each valid eat
  eatsClaimed Int[]           @default([]) // edible indexes already claimed; O(1) dup check

  startedAt   DateTime        @default(now())
  endedAt     DateTime?

  @@index([userId, day])                     // 3-runs-per-day count
  @@index([day, cpEarned(sort: Desc)])       // v2 leaderboard: "top runs today"
}
```

### Design notes

- `day` uses the existing `dayKey()` helper — same reset window as Wordle, midnight America/New_York.
- `seed` stored per-row → server re-derives edible layout on any future `eat` call without in-memory state (stateless-function-friendly).
- `eatsClaimed` as a native Postgres `Int[]` — an eat is `if (idx in array) reject; else push`. No `FlappyEat` join table needed.
- **No unique constraint on `(userId, day)`** — unlike Wordle. Instead we count rows per `(userId, day)` at `start` time and reject when count ≥ 3.
- The `(day, cpEarned DESC)` index is the only future-leaderboard scaffolding. When we build the leaderboard: `orderBy: [{ day }, { cpEarned: "desc" }] take: 10` — no schema change needed.
- **`cpEarned` and score are identical** since one edible = 1 CP. Simpler.
- Balance updates live on the existing `User.cigmaPoints` field (`increment: 1` per eat, `decrement: 5` at start), so `notifyCpChange` behaves identically to Wordle and daily-reward code paths.

## 5. Server Contract (tRPC)

Four `protectedProcedure`s on `flappyRouter`. Naming mirrors `wordleRouter` (`getStatus`) so the hub card driver is symmetrical.

### `getStatus` (query)

Drives the hub card. Returns:

```ts
{
  day: string
  runsToday: number
  runsRemaining: number        // max(0, PLAYS_PER_DAY - runsToday)
  canPlay: boolean             // runsRemaining > 0 && userBalance >= ENTRY_COST
}
```

### `start` (mutation)

Debits 5 CP and issues a run token. Runs in one transaction:

1. Count today's runs; throw `FORBIDDEN` if `>= PLAYS_PER_DAY`.
2. Check balance `>= ENTRY_COST`; throw `FORBIDDEN` otherwise.
3. Sweep the caller's `ACTIVE` runs older than `SWEEP_ACTIVE_AFTER_MS` → mark `ABANDONED` (no refund).
4. Debit `user.cigmaPoints -= ENTRY_COST`.
5. Generate `seed = crypto.randomInt(0, 2**32)`.
6. Insert `FlappyRun { status: ACTIVE, seed, entryCost: ENTRY_COST, day }`.

After the transaction: `after(() => notifyCpChange(userId))`.

Returns:

```ts
{ runId: string, seed: number, entryCost: number, runsRemaining: number }
```

### `eat` (mutation) — the hot path

Input: `{ runId: string, edibleIndex: number (int, >= 0) }`. In one transaction:

1. Load `FlappyRun`; throw `FORBIDDEN` if not `ACTIVE` or `userId` mismatch.
2. Validate `edibleIndex` against `layoutForSeed(run.seed)`; throw `BAD_REQUEST` if it doesn't exist.
3. Rate limit: if `run.eatsClaimed.length > 0` and `(now - run.startedAt) / eatsClaimed.length < MIN_MS_PER_EDIBLE`, throw `TOO_MANY_REQUESTS`.
4. If `edibleIndex` already in `run.eatsClaimed`, throw `CONFLICT`.
5. Append `edibleIndex` → `eatsClaimed`; increment `cpEarned`.
6. `user.cigmaPoints += 1`.

**No `notifyCpChange` here** — would spam email/push. Fires once on `end`.

Returns: `{ cpEarned: number }`.

### `end` (mutation)

Input: `{ runId: string }`. **Idempotent** — calling twice returns the same summary.

1. Load `FlappyRun`; if already `ENDED`, return the existing summary.
2. Mark `ENDED`, set `endedAt = now()`.

After the transaction: `after(() => notifyCpChange(userId))` (once per run).

Returns: `{ cpEarned: number, net: number }` where `net = cpEarned - entryCost`.

### Anti-cheat coverage matrix

| Attack | Blocked by |
|---|---|
| Fake `runId` | `runId` must belong to `ctx.session.user.id` |
| Replay same edible | `edibleIndex` uniqueness check on `eatsClaimed` |
| Fabricate a huge `edibleIndex` | Validated against `layoutForSeed(seed)` |
| Rapid-fire `eat` calls | `MIN_MS_PER_EDIBLE` timing check |
| Skip `start`, call `eat` directly | Row must exist AND be `ACTIVE` |
| Play more than 3× | Row-count check in both `getStatus` and `start` |
| Farm by starting many runs | Every `start` costs 5 CP up front |

## 6. Client Render Loop & Physics

### World state

Single object, mutated in place by the loop for GC-free updates:

```ts
type World = {
  seed: number
  bird: { x: number; y: number; vy: number; tilt: number; mouthOpenUntil: number }
  scrollX: number             // total px scrolled — sole input to layout()
  layout: Layout              // { pipes: Pipe[], edibles: Edible[] } from seed
  eatenLocal: Set<number>     // edibleIndexes eaten this run (client-side)
  status: "ready" | "playing" | "over"
  startedAt: number           // performance.now() when 'playing' began
}
```

### `step(world, dt, input)` — every frame

1. If `input.flap`: `bird.vy = FLAP_VELOCITY`; `bird.mouthOpenUntil = now + MOUTH_OPEN_MS`.
2. `bird.vy += GRAVITY * dt`; `bird.y += bird.vy * dt`; `bird.tilt = atan2(bird.vy, 300)`.
3. `world.scrollX += SCROLL_SPEED * dt`.
4. **Collision checks, in this order** (order matters for correctness):
   a. Bird vs floor/ceiling → `status = "over"`.
   b. Bird vs any pipe rect in visible window → `status = "over"`.
   c. Bird vs any edible in visible window NOT in `eatenLocal` → add to `eatenLocal`; extend `mouthOpenUntil`; emit `onEat(idx)`.
5. Return the mutated world.

### React host (`flappy-game.tsx`)

- Holds a `ref` to the canvas and a `ref` to the world (avoids re-renders).
- `useEffect` starts a `requestAnimationFrame` loop; the loop calls `step` and then `sprites.draw(ctx, world)`.
- Pointer/keyboard listeners set `input.flap = true`; the loop consumes and clears it each frame.
- `onEat` callback (from `flappy.tsx`) fires the tRPC `eat` mutation.
- `onEnd` callback fires the tRPC `end` mutation.
- **Cleanup on unmount** (or modal close): cancels RAF, removes listeners, fires `end` if the run is still `playing`. Belt-and-suspenders: the 5-min sweep in `start` catches anything that slips through.

### Optimistic UI on eat

- The instant `eatenLocal` grows, the HUD shows `+N earned` (client-side count).
- `eat` mutation fires in the background; success invalidates `user.getMe` so the top-right balance updates.
- **On failure** (rate limit, network), log but **do not rewind the client score** — the authoritative run number comes from the server's `end` response. Prevents mid-run number flicker.

### Frame independence

- `dt` is real elapsed ms clamped to 33ms max (prevents tab-backgrounding from teleporting the bird through a pipe).
- All physics constants are per-second. 30Hz phone and 120Hz desktop behave identically.

### Deterministic layout

- `layoutForSeed(seed)` in `src/lib/flappy-seed.ts` returns an infinite lazy generator; `sliceForWindow(scrollX)` grabs pipes/edibles in the visible window.
- Fixed `PIPE_INTERVAL_PX = 260` between pipe centers.
- Each gap contains **exactly one edible** at the vertical center of the gap ± seed-derived jitter.
- Edible `index === pipeIndex` — unambiguous identifier on both client and server.

## 7. Error Handling & Edge Cases

### Network / mutation failures

- **`start` fails** → game stays in **Ready**, error toasted, no debit. 5 CP is safe.
- **`start` succeeds but network dies before first paint** → row is `ACTIVE`; next `start` sweeps it to `ABANDONED`. User loses 5 CP for a run they didn't play. Mitigated by firing `start` on **first flap**, not modal open.
- **`eat` fails** → logged, run continues, `eatenLocal` unchanged (see Section 6). Game-over screen uses server's number as truth.
- **`end` fails** → retry once after 1s backoff. If still failing, row stays `ACTIVE` and is swept by the next `start`. Balance reconciles on next `user.getMe` fetch.

### Session / auth

- All four procedures are `protectedProcedure`. Session expiry mid-run → `eat` throws `UNAUTHORIZED`, logged; the run continues locally until death, then `end` also fails and the sweep handles cleanup.

### Concurrency

- Two devices, same user, both press "play" → row-count check runs inside each transaction with the Prisma default isolation level. If both slip past the count check, one transaction rolls back on the balance decrement (row lock) and the user sees `FORBIDDEN` on the losing side.
- Same user, two runs `ACTIVE` at once → allowed by design; both count against the daily cap. `eat` events name their `runId` so they can't cross-contaminate.

### Corrupted local state

- No mid-run `localStorage` persistence. Refresh mid-run = lost client world; server row stays `ACTIVE` until swept. Player forfeits the run. Matches "arcade cabinet" mental model.

### Modal close during play

- `useEffect` cleanup fires `end`. Mobile back-swipe dismissal runs the same cleanup. The 5-min sweep is the belt-and-suspenders safety net.

### Layout edge cases

- Non-portrait viewports → canvas keeps `aspect-ratio: 3/4`; letterbox on wide screens. Physics feel identical because constants are relative to canvas height.
- Rotation mid-run → canvas resizes; bird `y` is expressed as a fraction so it stays put. Physics don't restart.

### Time zones

- `dayKey()` uses America/New_York consistently (same as Wordle). Reset at midnight ET regardless of device timezone.

### Prisma migration

- One migration for the new table + enum. No backfill, zero downtime.

## 8. Testing Strategy

### Unit tests (Vitest)

**`engine.test.ts`**
- Gravity/flap physics: velocity updates as expected.
- Floor/ceiling collision sets `status = "over"`.
- Pipe collision sets `status = "over"`.
- Passing over an edible adds it to `eatenLocal`; not added twice.
- Frame independence: same input at 16ms and 33ms `dt` produces equivalent final position (within ε).

**`flappy-seed.test.ts`**
- Determinism: same seed → identical pipes and edibles.
- Different seeds → different layouts.
- Each gap has exactly one edible, placed within the gap bounds.
- `sliceForWindow(scrollX)` returns exactly the pipes visible in the viewport window.

**`rng.test.ts`**
- `mulberry32` is deterministic.
- Basic uniformity check over 10k iterations (mean ~0.5, no visible bias).

### Integration tests — tRPC router (Vitest)

**`flappy.test.ts`**
- `start` debits 5 CP and creates an `ACTIVE` row.
- `start` throws `FORBIDDEN` when balance < 5 (no debit).
- `start` throws `FORBIDDEN` after 3 runs the same day.
- `start` sweeps stale `ACTIVE` runs (> 5 min) to `ABANDONED`.
- Two `start` calls the same day both succeed; third fails.
- `eat` credits 1 CP and appends `edibleIndex`.
- `eat` rejects a duplicate `edibleIndex` (`CONFLICT`).
- `eat` rejects an `edibleIndex` outside the layout (`BAD_REQUEST`).
- `eat` rejects when the eat rate exceeds `MIN_MS_PER_EDIBLE` (`TOO_MANY_REQUESTS`).
- `eat` rejects a `runId` belonging to a different user (`FORBIDDEN`).
- `end` is idempotent — second call returns the same summary.
- `end` fires `notifyCpChange` exactly once.

Uses whatever integration harness `wordle.test.ts` uses; if a router-level integration harness doesn't exist yet, follow the closest existing pattern.

### E2E (Playwright)

**`tests/e2e/flappy.spec.ts`**
- User with ≥ 5 CP: open card → dialog opens; tap-to-start debits 5 CP; balance drops.
- Simulate a flap-and-eat: balance increments by 1 in real time.
- Trigger death: game-over overlay shows correct summary; balance stops changing.
- User with < 5 CP: card is disabled ("Insufficient CP").
- After 3 runs: card shows "Back tomorrow".
- Close modal mid-run: run marked `ENDED` server-side (verified via `getStatus`).
- Keyboard: `Space` and `ArrowUp` both flap.
- Pointer: `pointerdown` on canvas flaps.

### Explicitly not tested

- Pixel-perfect canvas rendering.
- Frame rate on real hardware.
- Adversarial anti-cheat (a red-team pass is out of scope for v1).

## 9. Asset Strategy

### v1 — placeholder rectangles

`sprites.ts` exports two functions: `draw(ctx, world)` and `preload(): Promise<void>`. In v1, `draw` calls `ctx.fillRect/fillCircle` with named colors from `constants.ts`; `preload` resolves immediately. Everything renders without external files.

### v2 — real PNGs (drop-in swap)

Four files at `public/game-hub/flappy/`:

```
bird-closed.png    # mouth closed frame
bird-open.png      # mouth open frame (alternates with bird-closed on flap;
                   # also snapped when mouthOpenUntil > now)
pillar.png         # single pillar; flipped vertically for the top pipe
edible.png         # the eatable object
```

**Supported formats** (all served by Next.js):
- **PNG** with transparency — the default for sprites at ~2× intended pixel size.
- **WebP** — smaller; universally supported now.
- **SVG** — vector for simple shapes/logos.
- **AVIF** — smaller still, supported by `next/image`.
- **JPG** — only for opaque backgrounds without transparency.

**Recommendation:** PNG (transparent) or WebP for all four sprites.

**Swap procedure:** update `preload()` to `Promise.all` an `Image()` for each file; update the `draw` branches inside `sprites.ts` to call `ctx.drawImage`. **No other file in the tree changes.**

### v2 — sound (reserved hook point)

A sibling `sounds.ts` will follow the same shape as `sprites.ts` (`preload`, per-event `play` functions like `playFlap()`, `playEat()`, `playDeath()`). Not implemented in v1; the render loop already has the event hooks (flap, eat, death) — they just don't call anything sound-related yet.

## 10. Deferred to v2

- **Sound effects** — hook points in place; add `sounds.ts` and file drops.
- **Leaderboard** — index on `(day, cpEarned DESC)` already reserved; add a `getLeaderboard` query and a UI surface.
- **Real sprite assets** — sprite loader indirection already isolates this to one file swap.
- **Difficulty ramp** — v1 uses constant `SCROLL_SPEED`. A tunable curve can be added inside `engine.ts` without touching the server contract.
