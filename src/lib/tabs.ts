// Single source of truth for the home/bottom-bar tab vocabulary. Both the `?tab=`
// URL param (home-tabs.tsx) and the `bottom-bar-tab` sessionStorage value
// (nav/bottom-bar.tsx) flow through normalizeTab, so the legacy `"transfer"` alias
// (pre-rename links, installed PWAs, stale sessionStorage) is handled in exactly
// ONE place instead of being duplicated across both call sites.

export type TabValue = "posts" | "exchange" | "tasks" | "people"

export const TAB_VALUES: readonly TabValue[] = ["posts", "exchange", "tasks", "people"]

export function normalizeTab(raw: string | null | undefined): TabValue {
  if (raw === "transfer") return "exchange"
  if (TAB_VALUES.includes(raw as TabValue)) return raw as TabValue
  return "posts"
}
