// Single source of truth for the home/bottom-bar tab vocabulary. Both the `?tab=`
// URL param (home-tabs.tsx) and the `bottom-bar-tab` sessionStorage value
// (nav/bottom-bar.tsx) flow through normalizeTab, so the legacy aliases (pre-rename
// links, installed PWAs, stale sessionStorage) are handled in exactly ONE place
// instead of being duplicated across both call sites.

export type TabValue = "posts" | "exchange" | "podium" | "people"

export const TAB_VALUES: readonly TabValue[] = ["posts", "exchange", "podium", "people"]

export function normalizeTab(raw: string | null | undefined): TabValue {
  if (raw === "transfer") return "exchange"
  // "tasks" was the Activities tab, removed with the feature. Installed PWAs and
  // sessionStorage still hold it, and old links still point at it, so it resolves to
  // the tab that replaced its slot rather than silently bouncing people to Posts.
  if (raw === "tasks") return "podium"
  if (TAB_VALUES.includes(raw as TabValue)) return raw as TabValue
  return "posts"
}
