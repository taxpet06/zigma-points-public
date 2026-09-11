# Public mirror — how the face-free public repo works

**Why:** four minigames embed a real person's face — **Chicken Cross** (a photo cutout),
**Flappy ZP** (bird sprites), **Znake** (a logo), and **JJ** (video clips of a real person).
The main repo is private and keeps them. A separate *public* repo mirrors everything else.

**`.gitignore` cannot do this.** Ignore rules only affect untracked files, and every asset is
already tracked. More importantly, the face assets exist throughout git *history* — including
`scratchpad/chicken/rotated.jpg`, the full original photo. Any public repo that shares history
with the private one exposes all of it. **The public repo therefore has its own orphan history
and is force-pushed, never merged.**

## The namespace

Everything face-related lives under one glob, `**/private-games/**`, in two locations:

| Path | Holds |
|---|---|
| `src/private-games/{chicken,flappy,znake,jj}/` | all game code (lib, router, components) |
| `tests/private-games/` | their unit + e2e tests |
| `public/private-games/{chicken,flappy,znake,jj}/` | all game assets (sprites, sounds, video clips) |

JJ adds a third location: **`assets/videos/`**, the uncut source video its clips are cut from.
That directory is `.gitignore`d, so the raw footage is never committed in the first place — the
export script deletes it and asserts no `*.qt`/`*.mov` survives purely as a backstop. Only the
derived clips under `public/private-games/jj/` are ever tracked, and those are deleted like any
other private asset.

Assets must sit under `public/` because they are fetched by URL at runtime
(`new Image().src = "/private-games/flappy/bird-open.png"`). Next only serves static files from
`public/`, so a literal single directory is not possible without rewriting asset loading. One
glob, two locations, is the compromise.

## Face-free helpers that deliberately stay OUT

These contain no face and are used by Tetris and the daily-prize cron, so removing them would
break unrelated features. They were renamed to drop the Flappy association:

| Was | Now |
|---|---|
| `src/components/game-hub/flappy/rng.ts` | `src/lib/seeded-rng.ts` |
| `src/lib/flappy-prizes.ts` (generic parts) | `src/lib/daily-prizes.ts` |
| `awardFlappyDailyPrizes` (queries `FlappyRun`) | stayed behind in `src/private-games/flappy/` |

Prisma migrations that create `FlappyRun` also stay public — they are SQL and contain no face.

## How the public repo still compiles

No conditional imports and no build-time magic. The export script **replaces**
`src/private-games/` with a committed stub tree at `tools/public-stubs/src/private-games/`.
Every import resolves; each game renders a "This game isn't publicly available." `GameCard`.

The stub tree mirrors the real tree's **externally imported surface**, not every file. Only the
modules imported from outside `private-games/` need stubbing:

| Stub | Exports | Behaviour |
|---|---|---|
| `flappy/flappy.tsx` | `Flappy` | disabled `GameCard`, no dialog |
| `chicken/chicken.tsx` | `Chicken` | disabled `GameCard`, no dialog |
| `znake/znake.tsx` | `Znake` | disabled `GameCard`, no dialog |
| `jj/jj.tsx` | `Jj` | disabled `GameCard`, no dialog |
| `flappy/router.ts` | `flappyRouter` | same procedure names, all throw `NOT_FOUND` |
| `chicken/router.ts` | `chickenRouter` | same procedure names, all throw `NOT_FOUND` |
| `znake/router.ts` | `znakeRouter` | same procedure names, all throw `NOT_FOUND` |
| `jj/router.ts` | `jjRouter` | same procedure names, all throw `NOT_FOUND` |
| `flappy/prizes.ts` | `awardFlappyDailyPrizes` | no-op, resolves `0` |
| `znake/prizes.ts` | `awardZnakeDailyPrizes` | no-op, resolves `0` |
| `chicken/logic.ts` | `CHICKEN_DIFFICULTIES`, `ChickenDifficulty`, `CHICKEN_TRAPS`, `deriveTraps` | real types, zeroed trap counts, `deriveTraps` **throws** |

**Adding a game means adding its stubs in the same commit.** Znake shipped without them, which
left the mirror unbuildable until JJ was added. The export script now fails fast on any
`@/private-games/…` import with no matching stub instead of letting `next build` discover it
several minutes in.

`deriveTraps` throws rather than returning `[]` on purpose: `[]` is a plausible trap layout, so
the verifier would render a confident green "verified" for a derivation it never performed —
the one failure mode a provably-fair tool must not have.

Consequences worth remembering:
- **The stub tree must stay in sync with the real one's public API.** If a real module gains an
  export, the stub needs it too or the public build breaks. The export script's build step is
  what catches this — do not skip it.
- Stubs are committed in *both* repos and are typechecked by the private repo's `tsc` (tsconfig
  includes `**/*.ts(x)`), so drift shows up locally too. They contain nothing sensitive.

## Publishing

```
tools/export-public.sh <public-remote-url>     # or: PUBLIC_REMOTE=<url> tools/export-public.sh
```

It refuses to run without a remote URL, and refuses to run with a **dirty working tree** — it
publishes `HEAD` via `git archive`, so a dirty tree would mean what you see is not what ships
(and untracked junk could otherwise leak).

What it does:
1. `git archive HEAD` into a temp dir (no git history, no untracked files).
2. Delete `public/private-games/`, `tests/private-games/`, and `scratchpad/`.
3. Replace `src/private-games/` with `tools/public-stubs/src/private-games/`.
4. Assert, and abort on any hit:
   - no file matches `head-*.png` or `bird-*.png`;
   - no surviving *path* contains `private-games` except the stub tree and `tools/public-stubs/`;
   - no file under `src/` or `tools/` contains a quoted `/private-games/` **asset URL**.
     Plain prose mentions of the path in comments are deliberately not matched — three public
     files (`src/lib/casino/mines.ts`, `src/lib/tetris/constants.ts`, `src/trpc/routers/mines.ts`)
     legitimately cite `src/private-games/...` in comments, and a naive `grep -ril private-games`
     would fail on those forever.
5. `npm ci --silent || npm install --silent`, then `npx next build` — **abort on failure**, so a
   broken public repo can never be published. Placeholder `DATABASE_URL` / `DIRECT_URL` /
   `NEXTAUTH_*` values are exported for the build only (Prisma's config resolves `DIRECT_URL` at
   generate time and hard-fails without it); nothing connects and no secret is written to the tree.
6. Commit as a single orphan commit on `main` and force-push. `node_modules/` and `.next/` are
   excluded automatically by the repo's own `.gitignore`.
7. Print what was excluded.

Safe to re-run: everything happens in a `mktemp -d` that is trapped for cleanup, and the push is
a force-push of a fresh one-commit history.

**Never** add the public remote as a push target for the real branch, and never merge between
them. The separation is the whole security property — the script takes the URL as an argument
and never runs `git remote add`.

## Checklist before publishing

The script asserts all of these; the list is here so a future reader knows what it is buying.

- [ ] no surviving `private-games` path outside the stub tree, and no runtime `/private-games/`
      asset URL
- [ ] no file under the sanitized tree is a face asset
- [ ] `npx next build` passes on the sanitized tree
- [ ] the public remote's history is exactly one commit deep
