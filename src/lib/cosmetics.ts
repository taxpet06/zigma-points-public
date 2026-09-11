// Hardcoded cosmetic catalog — the single source of truth for slugs, display
// metadata, and rarity/collection. No DB-backed catalog this phase (08-CONTEXT.md,
// extended 17-CONTEXT.md): ownership rows reference these slugs; getCosmetic is the
// server's slug-validation gate and the UI's catalog source. Lootboxes (not per-item
// price) are the only acquisition path — see LOOTBOXES and rollLootbox below.
// ponytail: plain array + Map, no DB, no class.

import { TITLE_NAMES } from "./title-names";

export type CosmeticKind = "BACKGROUND" | "RING" | "TITLE";
export type Collection = "26X" | "26F";
export type Rarity = "COMMON" | "RARE" | "LEGENDARY";

// Drop weight is a property of RARITY, not the individual item (RARITY_WEIGHT
// below) — so tuning odds is one knob per tier, not per-item bookkeeping.
export type Cosmetic = {
  slug: string;
  kind: CosmeticKind;
  name: string;
  tag: string;
  collection: Collection;
  rarity: Rarity;
};

const RAW_COSMETICS = [
  // Backgrounds — 26X Collection lootbox (100 ZP)
  { slug: "aurora", kind: "BACKGROUND", name: "Aurora Drift", tag: "Crimson borealis · slow", collection: "26X", rarity: "COMMON" },
  { slug: "nebula", kind: "BACKGROUND", name: "Plasma Nebula", tag: "feTurbulence shader · flowing", collection: "26X", rarity: "COMMON" },
  { slug: "holo", kind: "BACKGROUND", name: "Holographic Foil", tag: "Iridescent · specular sweep", collection: "26X", rarity: "COMMON" },
  { slug: "starfield", kind: "BACKGROUND", name: "Starfield", tag: "Twinkling drift · deep space", collection: "26X", rarity: "COMMON" },
  { slug: "ember", kind: "BACKGROUND", name: "Ember", tag: "Brand crimson · rising sparks", collection: "26X", rarity: "COMMON" },
  { slug: "mesh", kind: "BACKGROUND", name: "Liquid Mesh", tag: "Floating metaballs · blurred", collection: "26X", rarity: "COMMON" },
  { slug: "clouds", kind: "BACKGROUND", name: "Cloud Drift", tag: "Seamless sky · scrolling", collection: "26X", rarity: "RARE" },
  { slug: "rope", kind: "BACKGROUND", name: "Rope Weave", tag: "Seamless rope · scrolling", collection: "26X", rarity: "RARE" },
  { slug: "chrysanthemum", kind: "BACKGROUND", name: "Chrysanthemum", tag: "Seamless floral · diagonal", collection: "26X", rarity: "RARE" },
  { slug: "logorain", kind: "BACKGROUND", name: "Logo Storm", tag: "Raining app logos", collection: "26X", rarity: "LEGENDARY" },
  // Rings — 26X Collection lootbox (50 ZP)
  { slug: "spectrum", kind: "RING", name: "Spectrum Spin", tag: "conic", collection: "26X", rarity: "COMMON" },
  { slug: "glow", kind: "RING", name: "Pulse Glow", tag: "brand", collection: "26X", rarity: "COMMON" },
  { slug: "dash", kind: "RING", name: "Dash Orbit", tag: "svg", collection: "26X", rarity: "COMMON" },
  { slug: "shimmer", kind: "RING", name: "Shimmer", tag: "sweep", collection: "26X", rarity: "COMMON" },
  { slug: "comet", kind: "RING", name: "Comet", tag: "orbit", collection: "26X", rarity: "COMMON" },
  { slug: "breathe", kind: "RING", name: "Breathe", tag: "gradient", collection: "26X", rarity: "COMMON" },
  { slug: "cloudring", kind: "RING", name: "Cloud Ring", tag: "White cumulus puffs", collection: "26X", rarity: "RARE" },
  { slug: "ropering", kind: "RING", name: "Rope Ring", tag: "Braided rope band", collection: "26X", rarity: "RARE" },
  { slug: "chrysanthemumring", kind: "RING", name: "Chrysanthemum Ring", tag: "Floral band", collection: "26X", rarity: "RARE" },
  { slug: "logoring", kind: "RING", name: "Logo Orbit", tag: "Four orbiting logos", collection: "26X", rarity: "LEGENDARY" },
  // Titles — 26X Title lootbox (25 ZP). Names resolve from TITLE_NAMES by slug —
  // real (placeholder-for-now) strings committed directly in title-names.ts, redacted
  // only on public export (tools/export-public.sh swaps that file for the mirror).
  { slug: "title-common-1", kind: "TITLE", name: TITLE_NAMES["title-common-1"], tag: "26X Collection title", collection: "26X", rarity: "COMMON" },
  { slug: "title-common-2", kind: "TITLE", name: TITLE_NAMES["title-common-2"], tag: "26X Collection title", collection: "26X", rarity: "COMMON" },
  { slug: "title-common-3", kind: "TITLE", name: TITLE_NAMES["title-common-3"], tag: "26X Collection title", collection: "26X", rarity: "COMMON" },
  { slug: "title-common-4", kind: "TITLE", name: TITLE_NAMES["title-common-4"], tag: "26X Collection title", collection: "26X", rarity: "COMMON" },
  { slug: "title-common-5", kind: "TITLE", name: TITLE_NAMES["title-common-5"], tag: "26X Collection title", collection: "26X", rarity: "COMMON" },
  { slug: "title-common-6", kind: "TITLE", name: TITLE_NAMES["title-common-6"], tag: "26X Collection title", collection: "26X", rarity: "COMMON" },
  { slug: "title-rare-1", kind: "TITLE", name: TITLE_NAMES["title-rare-1"], tag: "26X Collection title", collection: "26X", rarity: "RARE" },
  { slug: "title-rare-2", kind: "TITLE", name: TITLE_NAMES["title-rare-2"], tag: "26X Collection title", collection: "26X", rarity: "RARE" },
  { slug: "title-rare-3", kind: "TITLE", name: TITLE_NAMES["title-rare-3"], tag: "26X Collection title", collection: "26X", rarity: "RARE" },
  { slug: "title-legendary-1", kind: "TITLE", name: TITLE_NAMES["title-legendary-1"], tag: "26X Collection title", collection: "26X", rarity: "LEGENDARY" },

  // Backgrounds — 26F Collection lootbox (100 ZP). Each Common pairs with the ring of
  // the same theme below; the Rares/Legendary are textures from /public/assets/26F/.
  { slug: "foliage", kind: "BACKGROUND", name: "Fall Foliage", tag: "Falling maple leaves · sway", collection: "26F", rarity: "COMMON" },
  { slug: "outrun", kind: "BACKGROUND", name: "Outrun", tag: "Neon grid · striped sun", collection: "26F", rarity: "COMMON" },
  { slug: "lavalamp", kind: "BACKGROUND", name: "Lava Lamp", tag: "Gooey metaballs · rising", collection: "26F", rarity: "COMMON" },
  { slug: "tidepool", kind: "BACKGROUND", name: "Tide Pool", tag: "Water caustics · shimmering", collection: "26F", rarity: "COMMON" },
  { slug: "storm", kind: "BACKGROUND", name: "Thunderstorm", tag: "Rain · lightning strikes", collection: "26F", rarity: "COMMON" },
  { slug: "radar", kind: "BACKGROUND", name: "Radar", tag: "Sweeping scope · live blips", collection: "26F", rarity: "COMMON" },
  { slug: "eyes", kind: "BACKGROUND", name: "Eye Globe", tag: "Fisheye pulse · warped", collection: "26F", rarity: "RARE" },
  { slug: "carpet", kind: "BACKGROUND", name: "Persian Carpet", tag: "Woven indigo · still", collection: "26F", rarity: "RARE" },
  { slug: "steps", kind: "BACKGROUND", name: "Stairwell", tag: "Seamless cubes · stepping", collection: "26F", rarity: "RARE" },
  { slug: "home", kind: "BACKGROUND", name: "Home", tag: "The house", collection: "26F", rarity: "LEGENDARY" },
  // Rings — 26F Collection lootbox (50 ZP)
  { slug: "leafring", kind: "RING", name: "Maple Wreath", tag: "Autumn leaves", collection: "26F", rarity: "COMMON" },
  { slug: "neonsun", kind: "RING", name: "Neon Sun", tag: "Scanline sunset", collection: "26F", rarity: "COMMON" },
  { slug: "lavaring", kind: "RING", name: "Lava Ring", tag: "Gooey orbit", collection: "26F", rarity: "COMMON" },
  { slug: "ripple", kind: "RING", name: "Ripple", tag: "Expanding water rings", collection: "26F", rarity: "COMMON" },
  { slug: "voltage", kind: "RING", name: "Voltage", tag: "Crackling arc", collection: "26F", rarity: "COMMON" },
  { slug: "sweep", kind: "RING", name: "Radar Sweep", tag: "Rotating scope", collection: "26F", rarity: "COMMON" },
  { slug: "eyesring", kind: "RING", name: "Eye Globe Ring", tag: "Fisheye pulse band", collection: "26F", rarity: "RARE" },
  { slug: "carpetring", kind: "RING", name: "Carpet Ring", tag: "Woven indigo band", collection: "26F", rarity: "RARE" },
  { slug: "stepsring", kind: "RING", name: "Stairwell Ring", tag: "Stepping cube band", collection: "26F", rarity: "RARE" },
  { slug: "flagring", kind: "RING", name: "Old Glory", tag: "Stars and stripes", collection: "26F", rarity: "LEGENDARY" },
  // Titles — 26F Title lootbox (25 ZP); names from TITLE_NAMES, redacted on export.
  { slug: "title-26f-common-1", kind: "TITLE", name: TITLE_NAMES["title-26f-common-1"], tag: "26F Collection title", collection: "26F", rarity: "COMMON" },
  { slug: "title-26f-common-2", kind: "TITLE", name: TITLE_NAMES["title-26f-common-2"], tag: "26F Collection title", collection: "26F", rarity: "COMMON" },
  { slug: "title-26f-common-3", kind: "TITLE", name: TITLE_NAMES["title-26f-common-3"], tag: "26F Collection title", collection: "26F", rarity: "COMMON" },
  { slug: "title-26f-common-4", kind: "TITLE", name: TITLE_NAMES["title-26f-common-4"], tag: "26F Collection title", collection: "26F", rarity: "COMMON" },
  { slug: "title-26f-common-5", kind: "TITLE", name: TITLE_NAMES["title-26f-common-5"], tag: "26F Collection title", collection: "26F", rarity: "COMMON" },
  { slug: "title-26f-common-6", kind: "TITLE", name: TITLE_NAMES["title-26f-common-6"], tag: "26F Collection title", collection: "26F", rarity: "COMMON" },
  { slug: "title-26f-rare-1", kind: "TITLE", name: TITLE_NAMES["title-26f-rare-1"], tag: "26F Collection title", collection: "26F", rarity: "RARE" },
  { slug: "title-26f-rare-2", kind: "TITLE", name: TITLE_NAMES["title-26f-rare-2"], tag: "26F Collection title", collection: "26F", rarity: "RARE" },
  { slug: "title-26f-rare-3", kind: "TITLE", name: TITLE_NAMES["title-26f-rare-3"], tag: "26F Collection title", collection: "26F", rarity: "RARE" },
  { slug: "title-26f-legendary-1", kind: "TITLE", name: TITLE_NAMES["title-26f-legendary-1"], tag: "26F Collection title", collection: "26F", rarity: "LEGENDARY" },
] as const;

// Real names are baked into the committed array at build time (title-names.ts) — no
// client-side env var indirection needed.
export const COSMETICS: readonly Cosmetic[] = RAW_COSMETICS;

const COSMETICS_BY_SLUG = new Map(COSMETICS.map((c) => [c.slug, c]));

export function getCosmetic(slug: string): Cosmetic | undefined {
  return COSMETICS_BY_SLUG.get(slug);
}

// Lootboxes — the only acquisition path for cosmetics (no per-item buy).
// Each box rolls a weighted-random slug from COSMETICS filtered by its
// collection + kind. Prices match the old direct per-item prices.
export type Lootbox = {
  id: string;
  collection: Collection;
  kind: CosmeticKind;
  name: string;
  description: string;
  price: number;
};

export const LOOTBOXES: Record<string, Lootbox> = {
  "26x-background": {
    id: "26x-background",
    collection: "26X",
    kind: "BACKGROUND",
    name: "26X Collection Lootbox",
    description: "Contains one random 26X Collection profile background.",
    price: 100,
  },
  "26x-ring": {
    id: "26x-ring",
    collection: "26X",
    kind: "RING",
    name: "26X Collection Lootbox",
    description: "Contains one random 26X Collection avatar ring.",
    price: 50,
  },
  "26x-title": {
    id: "26x-title",
    collection: "26X",
    kind: "TITLE",
    name: "26X Title Lootbox",
    description: "Contains one random 26X Collection title.",
    price: 25,
  },
  "26f-background": {
    id: "26f-background",
    collection: "26F",
    kind: "BACKGROUND",
    name: "26F Collection Lootbox",
    description: "Contains one random 26F Collection profile background.",
    price: 100,
  },
  "26f-ring": {
    id: "26f-ring",
    collection: "26F",
    kind: "RING",
    name: "26F Collection Lootbox",
    description: "Contains one random 26F Collection avatar ring.",
    price: 50,
  },
  "26f-title": {
    id: "26f-title",
    collection: "26F",
    kind: "TITLE",
    name: "26F Title Lootbox",
    description: "Contains one random 26F Collection title.",
    price: 25,
  },
};

export function getLootbox(boxId: string): Lootbox | undefined {
  return LOOTBOXES[boxId];
}

// Lootboxes belong to a TERM, and a term's name IS its collection key ("26X" the term
// runs "26X" the collection). That equality is the entire mapping — no registry table,
// no Term.collection column, nothing for an admin to keep in sync. A term with no
// cosmetics of its own (an older term, or a new one whose catalog isn't written yet)
// simply returns no boxes, and the shop renders its empty state.
//
// Only the CURRENT term's boxes are buyable — shop.openBox enforces that server-side.
// Past terms stay browsable so their contents and odds remain inspectable, which is
// also what makes a listed or traded old-term item legible to a buyer who never saw
// the term. Nothing here mints anything; circulation of a closed term is frozen because
// its boxes can't be opened, not because its items stop existing.
export function lootboxesForTerm(termName: string): Lootbox[] {
  return Object.values(LOOTBOXES).filter((box) => box.collection === termName);
}

// Per-rarity drop weight — the single knob for lootbox odds. Weights are relative
// within a box; each number here is chosen to read as the per-item drop % in a FULL
// 6-Common / 3-Rare / 1-Legendary box:
//   6·13.5 + 3·6 + 1·1 = 100  ->  tier odds Common 81% · Rare 18% · Legendary 1%
// With fewer items of a tier present the tier's share shrinks proportionally — e.g.
// today's single Rare among 6 Commons is 6/(6·13.5 + 6) ≈ 6.9%.
export const RARITY_WEIGHT: Record<Rarity, number> = {
  COMMON: 13.5,
  RARE: 6,
  LEGENDARY: 1,
};

// Standard cumulative-weight scan over rng() * totalWeight. Pure + synchronous
// so it's trivially unit-testable; the roll itself happens server-side only
// (T-17-01 — the client never calls this, weights are hardcoded catalog data).
export function weightedPick(entries: { slug: string; weight: number }[], rng: () => number = Math.random): string {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  const target = rng() * total;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    // Last bucket is inclusive so the max possible draw (rng() just under 1)
    // never falls through with no match.
    if (target < cumulative || entry === entries[entries.length - 1]) {
      return entry.slug;
    }
  }
  // Unreachable given entries is non-empty, but keeps the return type total.
  return entries[entries.length - 1].slug;
}

// Per-rarity drop odds for a box (its collection + kind), for display in the
// lootbox modal. A rarity's share = (its item count × its weight) / total weight.
export function lootboxOdds(boxId: string): { rarity: Rarity; pct: number }[] {
  const box = getLootbox(boxId);
  if (!box) return [];
  const items = COSMETICS.filter((c) => c.collection === box.collection && c.kind === box.kind);
  const total = items.reduce((sum, c) => sum + RARITY_WEIGHT[c.rarity], 0);
  const order: Rarity[] = ["COMMON", "RARE", "LEGENDARY"];
  return order
    .map((rarity) => {
      const w = items
        .filter((c) => c.rarity === rarity)
        .reduce((sum, c) => sum + RARITY_WEIGHT[c.rarity], 0);
      return { rarity, pct: total ? (w / total) * 100 : 0 };
    })
    .filter((o) => o.pct > 0);
}

export function rollLootbox(boxId: string): string {
  const box = getLootbox(boxId);
  if (!box) {
    throw new Error(`Unknown lootbox: ${boxId}`);
  }
  const entries = COSMETICS.filter((c) => c.collection === box.collection && c.kind === box.kind).map((c) => ({
    slug: c.slug,
    weight: RARITY_WEIGHT[c.rarity],
  }));
  return weightedPick(entries);
}

// Rarity → color/label, single source of truth for both the shop's rarity
// glow CSS class and any label text (17-CONTEXT.md "Rarity → color"). Also
// carries the reveal's confetti tints (18-CONTEXT.md "no second rarity
// table") — src/lib/confetti.ts reads confettiColors from here only.
export const RARITY_META: Record<Rarity, { hex: string; label: string; glowClass: string; confettiColors: string[] }> = {
  COMMON: { hex: "#059669", label: "Common", glowClass: "rarity-common", confettiColors: ["#3ec46d", "#9ae6b4", "#ffffff"] },
  RARE: { hex: "#d97706", label: "Rare", glowClass: "rarity-rare", confettiColors: ["#f5b301", "#ffd966", "#fff2c4", "#ffffff"] },
  LEGENDARY: { hex: "var(--primary)", label: "Legendary", glowClass: "rarity-legendary", confettiColors: ["#e11d63", "#ff5c8a", "#ffd0dd", "#ffffff"] },
};

// Admin-only virtual title — deliberately NOT a COSMETICS entry and NOT a Rarity.
// It has no ownable copy (no CosmeticPurchase row is ever created for it), and
// rollLootbox/lootboxOdds both derive their pools by filtering COSMETICS, so its
// absence from that array makes it unrollable by construction with zero extra
// filtering (ADMT-02). Its glow class is deliberately its own "rarity-zigma", never
// RARITY_META.LEGENDARY.glowClass.
export const ADMIN_TITLE = { slug: "the-zigma", name: "The Zigma", collection: "26X", kind: "TITLE", glowClass: "rarity-zigma", hex: "var(--primary)" } as const;

// Collection completion, for the profile Inventory tab's "29/30" fold labels.
// `owned` counts DISTINCT catalog items (fifty copies of one title is still one
// item); `total` is the catalog size for that scope. ADMIN_TITLE is +1 owned and
// +0 total by construction — it is not in COSMETICS, which is the same absence
// that makes it unrollable (ADMT-02) — so a complete admin reads 11/10.
export function collectionProgress(
  ownedSlugs: Iterable<string>,
  collection: string,
  kind?: CosmeticKind,
): { owned: number; total: number } {
  const set = ownedSlugs instanceof Set ? ownedSlugs : new Set(ownedSlugs);
  const pool = COSMETICS.filter((c) => c.collection === collection && (!kind || c.kind === kind));
  const adminBonus =
    set.has(ADMIN_TITLE.slug) &&
    collection === ADMIN_TITLE.collection &&
    (!kind || kind === ADMIN_TITLE.kind)
      ? 1
      : 0;
  return { owned: pool.filter((c) => set.has(c.slug)).length + adminBonus, total: pool.length };
}
