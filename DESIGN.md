---
name: Zigma Points
description: Community points and recognition platform for closed groups and teams
colors:
  brand-crimson: "oklch(0.53 0.235 5)"
  ink: "oklch(0.145 0 0)"
  surface: "oklch(1 0 0)"
  surface-muted: "oklch(0.97 0.008 5)"
  border-subtle: "oklch(0.922 0.005 5)"
  text-muted: "oklch(0.556 0.008 5)"
  accent-fill: "oklch(0.94 0.015 5)"
  semantic-award: "#059669"
  semantic-award-bg: "#ecfdf5"
  semantic-deduct: "oklch(0.52 0.19 50)"
  semantic-deduct-bg: "#fffbeb"
  semantic-pending: "#d97706"
typography:
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-crimson}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "oklch(0.53 0.235 5 / 90%)"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline-hover:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-destructive:
    backgroundColor: "{colors.semantic-deduct}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card-post:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Zigma Points

## 1. Overview

**Creative North Star: "The Community Scoreboard"**

Zigma Points is a live community ledger — every point request is a public proposal, every vote is a statement, and every settled outcome is a fact the group made together. The design serves that dynamic. It's a scoreboard, not a timeline. Outcomes land with clarity. Votes feel consequential. The feed reads fast. When the group is watching, nothing should be ambiguous.

The system is product-register first: design disappears into the task. Users aren't here to scroll — they're here to vote, post, and check the standings. Every surface prioritizes scannability over decoration. Inter runs every label, the semantic color vocabulary carries meaning without ornament, and flat tonal surfaces keep focus on the content, not the chrome.

This system explicitly rejects social-media clone grammar — no algorithmic feed aesthetics, no endless passive scroll, no engagement-bait visual patterns. It also rejects the gamified trophy-case aesthetic — no streaks, no progress rings, no confetti. Points matter because the community says so. The design respects that weight.

**Key Characteristics:**
- High-contrast, fast reads — outcomes scannable in under two seconds
- Semantic color vocabulary — chromatic color carries meaning, not decoration
- Flat tonal layering — no shadows; depth from surface contrast and borders
- Bold and clear affordances — no ambiguity about what's interactive
- App-first — mobile touch targets and interaction patterns throughout
- Inter + JetBrains Mono — humanist warmth for UI, technical precision for data

## 2. Colors: The Community Scoreboard Palette

The palette is a vivid crimson brand primary (`oklch(0.53 0.235 5)`) on a pure white canvas, with crimson micro-tints (+0.005–0.015 chroma at H=5) applied to all neutral surfaces for subconscious brand coherence. The semantic color set (emerald, amber) carries outcome meaning; the brand crimson claims primary actions, focus rings, the app identity, and interactive states.

The semantic colors (`semantic-award`, `semantic-deduct`, `semantic-pending`) are expressed as Tailwind utility classes directly in components. They are real design decisions, not accidents.

**The Semantic First Rule.** The semantic set (emerald = Award/Agree outcomes, amber = Deduct/Disagree/Error, amber-600 = Pending) carries outcome meaning. Brand crimson is reserved for primary actions and interactive states — never for outcome signals.

### Primary

- **Brand Crimson** (`oklch(0.53 0.235 5)` / cool blueish-red, 22° toward magenta from sRGB red): `--primary` in CSS. Primary action buttons (Create Post, Sign Up, Agree vote active), the "Zigma Points" app name in the header, and focus rings. White text (`oklch(0.985 0 0)`) is required on this fill — contrast 5.3:1.
- **Accent Fill** (`oklch(0.94 0.015 5)` / very light crimson tint): `--accent` in CSS. Ghost button hover fill and interactive surface tints. Below conscious perception as color; present as brand coherence.
- **Ink** (`oklch(0.145 0 0)` / near-black): Default text. All body copy, headings, and labels on light surfaces.

### Neutral (crimson-tinted)

All neutral surfaces carry a micro-tint toward H=5 — subconscious brand coherence, not visible as "tinted."

- **Pure Surface** (`oklch(1 0 0)` / white): Page background and card faces. Untinted — brand crimson's vividness comes from contrast against a clean white canvas.
- **Muted Surface** (`oklch(0.97 0.008 5)` / crimson-tinted near-white): Ghost button hover, badge backgrounds, empty state fills.
- **Subtle Border** (`oklch(0.922 0.005 5)` / hairline crimson tint): Card outlines, input borders, dividers.
- **Text Muted** (`oklch(0.556 0.008 5)` / crimson-tinted medium gray): Timestamps, metadata, helper copy. At the 4.5:1 contrast floor on white. Never lighten further.

### Semantic

- **Award / Agree** (`#059669` / emerald-600 on `#ecfdf5` / emerald-50 bg): Award post type badge, "Awarded" outcome indicator.
- **Deduct / Disagree / Error** (`oklch(0.52 0.19 50)` / deep amber-gold on `#fffbeb` / amber-50 bg): Deduct post type badge (`text-amber-700 bg-amber-50`), Disagree vote button active state (`variant="destructive"`), form errors (`text-destructive`). Contrast 5.5:1 on white.
- **Pending** (`#d97706` / amber-600): Unsettled post state — clock icon + "Pending" text. No fill background.

**The No Chroma Creep Rule.** Do not introduce chromatic colors outside the brand crimson and semantic set without a formal token decision.

### Dark Mode

Dark mode carries brand crimson through consistently. Page bg is crimson-tinted near-black (`oklch(0.145 0.010 5)`); cards step to `oklch(0.205 0.012 5)`; brand crimson primary stays identical at `oklch(0.53 0.235 5)` — it works against both white and near-black. Focus ring brightens to `oklch(0.68 0.20 5)` for dark-surface visibility. Destructive amber brightens to `oklch(0.73 0.18 57)` with dark ink text for dark-mode button fills.

## 3. Typography

**Body / UI Font:** Inter, system-ui, sans-serif
**Data Font:** JetBrains Mono, monospace

**Character:** Inter is the humanist without the quirk — legible at small sizes, neutral enough to disappear into the product, warm enough to avoid clinical coldness. JetBrains Mono carries precision where data needs to breathe: ZP balances in the header, point amounts in post cards, any tabular numeric display where character-level alignment matters. The pairing is product-standard: one voice for context, one for data.

No display or headline font. A display scale would introduce noise without a brand payoff. Hierarchy is weight and color within Inter, not scale.

### Hierarchy

- **Title** (Inter 600, 1rem / 1.4): Post titles, modal headings, section labels. Hard ceiling at 1.25rem.
- **Body** (Inter 400, 1rem / 1.5): Explanations, reply content, longer prose. Apply `text-wrap: pretty`. Cap at 65ch.
- **Label** (Inter 500, 0.875rem / 1.25): Author names, metadata, badge text, button labels, form labels. The workhorse weight — everything interactive or named.
- **Caption** (Inter 400, 0.875rem / 1.25): Timestamps, vote counts, helper text. Always `text-muted`. Never below 0.75rem on mobile.
- **Mono** (JetBrains Mono 400, 0.875rem / 1.5): ZP balance in the header. Any tabular numbers. Tabular-nums feature active.

**The One-Size Rule.** No element inside the app shell uses a font size above 1.5rem. There is no hero here. Hierarchy is weight and color, not scale.

## 4. Elevation

This system is flat by default. No `box-shadow` declarations appear in the current codebase, and none should be added to card elements. Depth is conveyed entirely through tonal surface contrast: white page, near-white muted surface, light-gray border.

**The Flat-by-Default Rule.** Surfaces never lift at rest. The sole exception is overlays (modals, dropdown menus, popovers) — these must feel above the page plane, not just different from it.

### Shadow Vocabulary

- **Overlay lift** (`0 8px 32px oklch(0 0 0 / 0.12)`): Applied to modal dialogs and dropdown menus only. Ambient and diffuse. Not structural; not dramatic.
- **Card surfaces:** No shadow. `border: 1px solid {colors.border-subtle}` is the sole depth cue on post cards and all panel surfaces.

## 5. Components

### Buttons

**Bold and clear — no ambiguity about what's interactive.**

- **Shape:** `rounded-md` (8px). Not pill, not square. Consistent across all variants. No size variation on border-radius.
- **Primary:** Brand crimson fill (`oklch(0.53 0.235 5)`) + white text. `h-11 px-4 py-2` (default), `h-10 px-3` (sm). Hover: 90% opacity.
- **Outline:** White fill + `border-subtle` border + ink text. Hover: fills with `surface-muted`. Secondary action alongside a primary.
- **Destructive:** Deep amber fill (`oklch(0.52 0.19 50)`) + white text. Disagree vote and destructive actions only.
- **Ghost:** Transparent + ink text. Hover: `surface-muted` fill. Navigation icon buttons, utility actions.
- **Focus:** `ring-2` at `oklch(0.53 0.235 5)` (brand crimson) with `ring-offset-2`. Keyboard-visible; same ring across all variants.
- **Disabled:** 50% opacity, `pointer-events-none`. Never a different color.

### Vote Buttons (Signature Component)

The most important interaction in the product.

- **Layout:** Full-width, space-between, inside the post card footer (`CardFooter`). Agree on the left, Disagree on the right.
- **Active Agree:** `button-primary` (brand crimson fill). ThumbsUp icon + count. `aria-pressed="true"`.
- **Active Disagree:** `button-destructive` (amber fill). ThumbsDown icon + count. `aria-pressed="true"`.
- **Inactive (both):** `button-outline`. Equal visual weight when neither is cast.
- **Closed voting:** Text-only summary (`"Agree: N  Disagree: N"` in `text-muted`). No buttons rendered.
- **Pending mutation:** Both buttons `disabled` while the vote is in flight.

**The Vote Clarity Rule.** When a vote is cast, the active button is full-fill — not a border shift, not a tint change. The difference between "I voted" and "voting is open" must be unmistakable at a glance on a 390px screen.

### Post Cards (Core Display Unit)

The feed is a list of these. Each must be scannable in under two seconds.

- **Shape:** `rounded-lg` (10px), `border-subtle` border (1px), white background. No shadow.
- **Header (`CardHeader`):** Type badge + ZP amount (bold, `±N ZP`) + outcome badge right-aligned.
- **Type badge:** Full-pill (`rounded-full`, `px-2 py-0.5 text-xs font-semibold`). Emerald bg/text for Award; amber bg/text (`text-amber-700 bg-amber-50`) for Deduct. TypeIcon (ArrowUpCircle / ArrowDownCircle) + label.
- **Outcome indicator:** Icon + text inline, no pill background. Clock + amber "Pending"; CheckCircle2 + emerald "Awarded"; XCircle + muted "Rejected".
- **Author line:** `"Author → Target"` — names bolded inline within muted-foreground text.
- **Body (`CardContent`):** Post title in `font-semibold`, timestamp in `text-muted text-sm`, explanation in `text-muted text-sm` below.
- **Footer (`CardFooter`):** Vote section → voting deadline → reply count link. Separated from body by `border-t pt-2`. All stacked in a `flex-col gap-2`.
- **Reply link:** Full-pill, border-only style when no replies; filled with primary tint when replies exist.

**The No Nested Cards Rule.** Never place a `Card` inside another `Card`. This pattern does not exist in the current codebase; do not introduce it.

### Semantic Badges

- **Type badge (Award / Deduct):** Full pill, `text-xs font-semibold`. Emerald fill for Award; amber fill for Deduct. Icon + label. `aria-label` describes the type for screen readers.
- **Do not badge-stack.** The type badge and outcome indicator are different visual weights intentionally: pill badge for type, icon+text for outcome. Never two adjacent pill badges in contrasting colors on the same card.

### Navigation Header

- **Container:** `h-14` (56px), sticky top (`z-10`), white bg / zinc-950 dark, `border-b`.
- **App name:** "Zigma Points" in Inter 600, `text-lg tracking-tight`, `text-primary` (brand crimson). Left-anchored — the only brand color in the header chrome.
- **ZP Balance:** `N ZP` in Inter 500 `text-sm`. The user's live score — tabular feel, not a decorative badge. Candidate for JetBrains Mono in a more polished pass.
- **Profile / theme toggle / dropdown:** Icon buttons using ghost variant. 40px touch targets.

### Inputs / Form Fields

- **Style:** White bg, `border-subtle` stroke (1px), `rounded-md` (8px).
- **Focus:** Ring-2 at `oklch(0.708 0 0)`, ring-offset-background. Border stays the same on focus; the ring appears outside.
- **Placeholder:** `text-muted` (`oklch(0.556 0 0)`). At the 4.5:1 floor. Never lighter.
- **Error:** Amber border + error text below in `text-destructive` (amber). The input does not change background color.
- **Disabled:** 50% opacity.

## 6. Do's and Don'ts

### Do:
- **Do** use semantic colors to carry outcome meaning — emerald for Award/Agree/Awarded, amber for Deduct/Disagree/Error, amber-600 for Pending. These are the only committed chromatic colors. Brand crimson is for primary actions only.
- **Do** keep post card surfaces flat with `border-subtle` (1px) as the sole depth cue. No card shadows.
- **Do** use Inter 500 (label weight) for all button text, badge text, and interactive labels.
- **Do** make vote buttons full-width and full-fill when active. Half-measures on the core interaction are not acceptable.
- **Do** use `text-wrap: pretty` on explanation and reply text to prevent orphans.
- **Do** maintain ≥ 44px touch targets on all interactive elements. This is an app-first product.
- **Do** show skeleton states (animated `bg-muted` placeholder bars) while the feed loads. Not spinners in the content well.
- **Do** use JetBrains Mono for ZP balance numbers and any tabular numeric display.
- **Do** keep `text-muted` at `oklch(0.556 0 0)` or darker. Never lighten secondary text "for elegance."

### Don't:
- **Don't** build social media clone patterns — no Twitter/Reddit feed grammar, no retweet patterns, no trending/explore surfaces, no infinite-scroll-as-default. The feed is a ledger.
- **Don't** add gamified visuals — no achievement rings, no streak counters, no XP bars, no confetti, no level-up animations. Points have weight because the community assigns them.
- **Don't** introduce chromatic color outside the semantic set without a formal brand accent decision. A colored card border, gradient header, or tinted background that carries no semantic meaning is prohibited.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on any card, alert, or list item. Use full borders, background tints, or nothing.
- **Don't** add `box-shadow` to post cards or feed surfaces at rest. Shadows belong on overlays only.
- **Don't** use gradient text (`background-clip: text` with a gradient fill). Never meaningful; always decorative.
- **Don't** write secondary text smaller than `text-sm` (0.875rem) on mobile. Timestamps already push the readability floor.
- **Don't** invent non-standard affordances for standard tasks. Button shape, input style, and modal vocabulary must be identical across all screens.
- **Don't** place a Card inside another Card. The pattern does not exist in this codebase for good reason.
