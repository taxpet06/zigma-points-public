# Product

## Register

product

## Users

Members of a closed private group or team who know each other personally. They use Zigma Points as a shared recognition and accountability layer within their community — not a public social network. Users nominate each other for point awards or deductions, vote to validate, and watch balances shift in real time. The primary context is mobile: members will pull up the feed between other activities to vote, post, and check standings.

## Product Purpose

A community-owned reputation ledger. Users publicly nominate each other for ZP awards or deductions; the group votes agree/disagree within a time window; outcomes are settled automatically. Admins can post Task Posts and directly manage balances. The feed of point requests and their voting outcomes is the product — it's the shared record of what the group values and holds accountable. Success looks like: every member checks the feed regularly, votes feel meaningful, and the point balance reflects something the community actually believes.

## Brand Personality

Energetic · Playful · Social

The product should feel alive — actions happen, outcomes land, the group reacts. Playful doesn't mean frivolous: point transfers have real weight in the community, and that tension (fun + accountability) is the brand's core energy. Think recognition system inside a tool people actually use (Figma Community), not a social destination competing for attention.

## Anti-references

- **Social media clone**: No Twitter/Reddit reskin — no algorithmic feed aesthetic, no engagement-bait patterns, no "endless scroll" visual grammar. The feed is a ledger, not a timeline.
- **Gamified trophy case**: No Duolingo-style streaks, achievement rings, or confetti overload. Points matter because the community says so — not because the app is trying to make them dopamine hits.

## Design Principles

1. **The feed is a ledger** — every card is a record of community judgment. Design for scannability: type (Award/Deduct), amount, outcome, and status should be readable in under two seconds.
2. **App-first, not page-first** — this is installed-feeling, not visited-feeling. Mobile interaction patterns lead; desktop is a larger canvas of the same product.
3. **Playful but honest** — energy comes through in motion, color, and micro-interactions. Outcomes (Awarded/Rejected/Pending) are unambiguous; the playful layer never obscures the signal.
4. **Recognition has weight** — the voting window, agree/disagree counts, and settlement outcome should feel deliberate and consequential, not casual.
5. **The group is the interface** — every action is visible to everyone. Design as if the whole community is watching, because they are.

## Accessibility & Inclusion

- WCAG AA minimum (4.5:1 body contrast, keyboard nav, screen reader support)
- Mobile-first and feels native — touch targets ≥ 44px, no hover-only affordances, smooth 60fps interactions
- Reduced motion alternatives for all animations (prefers-reduced-motion)
- Dark mode supported (already in codebase via next-themes)
