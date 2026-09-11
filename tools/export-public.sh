#!/usr/bin/env bash
# Publish the face-free public mirror. See docs/public-mirror.md.
#
# Usage:  tools/export-public.sh <public-remote-url>
#         PUBLIC_REMOTE=<url> tools/export-public.sh
#
# Builds a sanitized copy of HEAD in a temp dir, proves no face asset survives, runs a real
# `next build` against it, and force-pushes it as a SINGLE orphan commit. The public remote is
# never added to this repo's remotes — the separation is the whole security property.

set -euo pipefail

REMOTE="${1:-${PUBLIC_REMOTE:-}}"
if [ -z "$REMOTE" ]; then
  echo "error: public remote URL required (argv[1] or \$PUBLIC_REMOTE)" >&2
  exit 1
fi

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

# HEAD is what gets published, so a dirty tree means what you see is not what ships.
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty — commit or stash first (this script publishes HEAD)" >&2
  exit 1
fi

STUBS="$REPO/tools/public-stubs/src/private-games"
[ -d "$STUBS" ] || { echo "error: stub tree missing at $STUBS" >&2; exit 1; }

WORK="$(mktemp -d -t zigma-public-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
mkdir -p "$TREE"

SRC_SHA="$(git rev-parse --short HEAD)"
git archive HEAD | tar -x -C "$TREE"

# ---- 1. drop the private namespace ------------------------------------------------------
EXCLUDED=()
# .planning is the GSD history — plans, code reviews and phase summaries that quote private
# file paths, symbol names and line numbers while explaining what was cloned from where. Same
# category as graphify-out below, and the reason it's excluded wholesale rather than
# allowlisted per-file: every new phase summary that cites a sibling would re-trip the check.
# graphify-out is a knowledge graph of THIS repo: every node carries a source_file, a
# symbol name and a line number, so it maps the private games' internals even though it
# holds no face. The assertions below cannot see it — they match path NAMES (its files are
# graph.json, manifest.json) and grep only src/ and tools/ for asset URLs.
for d in public/private-games tests/private-games scratchpad assets/videos graphify-out .planning; do
  if [ -e "$TREE/$d" ]; then
    rm -rf "${TREE:?}/$d"
    EXCLUDED+=("$d")
  fi
done

# ---- 2. swap real game code for the committed stubs -------------------------------------
rm -rf "${TREE:?}/src/private-games"
mkdir -p "$TREE/src"
cp -R "$STUBS" "$TREE/src/private-games"
EXCLUDED+=("src/private-games (replaced with tools/public-stubs/)")

rm -f "$TREE/src/lib/title-names.ts"
cp "$REPO/tools/public-stubs/src/lib/title-names.ts" "$TREE/src/lib/title-names.ts"
EXCLUDED+=("src/lib/title-names.ts (replaced with tools/public-stubs/)")

# Every private module the PUBLIC tree imports must now exist as a stub. `next build` in
# step 4 would catch a gap too, but only after an npm ci and a full compile — and a stub
# missed when a game was added (Znake shipped without one) is the likeliest failure here.
MISSING=""
while read -r mod; do
  [ -n "$mod" ] || continue
  [ -e "$TREE/src/private-games/$mod.ts" ] || [ -e "$TREE/src/private-games/$mod.tsx" ] || MISSING="$MISSING  @/private-games/$mod"$'\n'
done < <(grep -rhoE '@/private-games/[a-zA-Z0-9_/-]+' "$TREE/src" 2>/dev/null \
  | sed 's|@/private-games/||' | sort -u)
if [ -n "$MISSING" ]; then
  echo "error: public tree imports private modules with no stub in tools/public-stubs/:" >&2
  printf '%s' "$MISSING" >&2
  exit 1
fi

# ---- 3. assertions — nothing here may be skipped ----------------------------------------
# Named face assets, wherever they ended up. Chicken Cross ships head-*.png, Flappy ships
# bird-*.png, JJ ships frames cut from a video of a real person (the clips eat*/give/pet
# plus the idle and death stills), and INSMOTHAFUCKINGLLAH ships coston.png. Add a pattern
# here whenever a game gains a face.
FACES="$(find "$TREE" -type f \( \
  -name 'head-*.png' -o -name 'bird-*.png' -o -name 'coston.png' \
  -o -name 'eat[0-9].mp4' -o -name 'give.mp4' -o -name 'pet.mp4' \
  -o -name 'idle.jpg' -o -name 'dead.jpg' \
\) -print)"
if [ -n "$FACES" ]; then
  echo "error: face assets survived sanitization:" >&2
  echo "$FACES" >&2
  exit 1
fi

# The 26X title strings are this repo's other secret — inside jokes rather than faces, so
# none of the checks above can see them. Step 2 swapped the private file for the stub;
# prove it landed, and prove nothing else in the tree defines TITLE_NAMES. A rename of
# src/lib/title-names.ts would turn step 2's `rm -f` into a silent no-op and publish the
# real names. Checks structure only, never the secret strings — this script ships too.
if ! cmp -s "$REPO/tools/public-stubs/src/lib/title-names.ts" "$TREE/src/lib/title-names.ts"; then
  echo "error: src/lib/title-names.ts in the mirror is not the stub — real title names would leak." >&2
  exit 1
fi
# The needle is assembled from two halves rather than written out, so this script does not
# match its OWN grep line — it ships in the mirror, so spelling the pattern out here made
# the check fail on itself every run. Concatenating keeps the check at full strength: a
# genuine definition pasted into this file would still be caught. Careful: do NOT spell the
# needle out in a comment below either, or the self-match comes straight back.
TITLE_NEEDLE="export const TITLE""_NAMES"
TITLEDEFS="$(cd "$TREE" && grep -rIl "$TITLE_NEEDLE" . --exclude-dir=node_modules 2>/dev/null \
  | sed 's|^\./||' | grep -Ev '^(src/lib/title-names\.ts|tools/public-stubs/)' || true)"
if [ -n "$TITLEDEFS" ]; then
  echo "error: unexpected TITLE_NAMES definition survived (real title names may leak):" >&2
  echo "$TITLEDEFS" >&2
  echo "if src/lib/title-names.ts moved, update the step-2 swap and this check together." >&2
  exit 1
fi

# Raw source media is worse than a derived frame — it is uncropped and long. assets/videos
# is gitignored so it should never reach `git archive` at all; this is the backstop for the
# day someone force-adds one.
RAWMEDIA="$(find "$TREE" -type f \( -name '*.qt' -o -name '*.mov' \) -print)"
if [ -n "$RAWMEDIA" ]; then
  echo "error: raw source media survived sanitization:" >&2
  echo "$RAWMEDIA" >&2
  exit 1
fi

# Any file that CITES a real private source path — `src/private-games/…` — is either a
# deliberate comment or a generated artifact that mapped the private tree. graphify-out was
# the latter: a knowledge graph naming every private file, symbol and line number, with no
# "private-games" in any of its own filenames, so the path check below never saw it. This
# check is fail-closed on purpose: a new generated artifact must be added here consciously,
# not discovered in the published mirror.
CITES_OK='^(docs/public-mirror\.md|src/private-games/|tools/public-stubs/|tools/export-public\.sh|src/lib/casino/mines\.ts|src/trpc/routers/mines\.ts|src/lib/tetris/constants\.ts)'
CITES="$(cd "$TREE" && grep -rIl 'src/private-games/' . --exclude-dir=node_modules 2>/dev/null \
  | sed 's|^\./||' | grep -Ev "$CITES_OK" || true)"
if [ -n "$CITES" ]; then
  echo "error: files citing private source paths survived (leaks the private tree's structure):" >&2
  echo "$CITES" >&2
  echo "if this file is legitimately face-free, add it to CITES_OK in this script." >&2
  exit 1
fi

# Any *path* still named private-games must be the stub tree or the stub source.
BADPATHS="$(cd "$TREE" && find . -path ./node_modules -prune -o -path '*private-games*' -print \
  | grep -v '^\./src/private-games' | grep -v '^\./tools/public-stubs' || true)"
if [ -n "$BADPATHS" ]; then
  echo "error: non-stub private-games paths survived:" >&2
  echo "$BADPATHS" >&2
  exit 1
fi

# Any runtime reference to a private-games ASSET url would 404 in the mirror (and name a face
# file). Source comments that merely mention the path are fine and are not matched.
ASSETREFS="$(grep -rIl '["'"'"'`]/private-games/' "$TREE/src" "$TREE/tools" 2>/dev/null || true)"
if [ -n "$ASSETREFS" ]; then
  echo "error: runtime /private-games/ asset references survived:" >&2
  echo "$ASSETREFS" >&2
  exit 1
fi

# ---- 4. real build — a broken mirror must never be published -----------------------------
cd "$TREE"
# Placeholders only — `prisma generate` and `next build` resolve these at build time and never
# connect. Real secrets live in the deployment, never in the mirror.
export DATABASE_URL="postgresql://mirror:mirror@localhost:5432/mirror"
export DIRECT_URL="$DATABASE_URL"
export NEXTAUTH_SECRET="public-mirror-build-placeholder"
export NEXTAUTH_URL="http://localhost:3000"
export NEXT_PUBLIC_APP_URL="http://localhost:3000"

npm ci --silent || npm install --silent
npx next build

# ---- 5. single orphan commit, force-pushed ------------------------------------------------
git init -q -b main
git add -A
git -c user.name="zigma-points" -c user.email="noreply@zigma-points.local" \
  commit -q -m "Public mirror of zigma-points @ ${SRC_SHA} (face-bearing games removed)"
git push -q --force "$REMOTE" main

COMMITS="$(git rev-list --count HEAD)"
[ "$COMMITS" = "1" ] || { echo "error: mirror history is $COMMITS commits, expected 1" >&2; exit 1; }

echo
echo "Published mirror of $SRC_SHA -> $REMOTE (main, 1 orphan commit)"
echo "Excluded:"
printf '  - %s\n' "${EXCLUDED[@]}"
echo "Asserted: no head-*.png / bird-*.png, no non-stub private-games path, no /private-games/ asset URL."
