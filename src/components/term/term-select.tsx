"use client"

// TermSelect — the app's one control for "which term am I looking at?".
//
// Used by every competitive leaderboard (Term scope), the shop's Lootboxes tab, and
// the Posts feed filter. One component so the affordance is identical everywhere:
// same trigger shape, same option rows, same "Current" marker, same keyboard model.
//
// Built on the DropdownMenu primitive, not a new Select dependency — Radix's menu is
// already installed, portals out of the tab panels' overflow (a `position: absolute`
// popover would be clipped inside TabsContent and the game dialogs), and ships focus
// trapping, roving focus, type-ahead and Escape for free. The options are a
// RadioGroup, so each row is a `menuitemradio` with real checked state rather than a
// button that only looks selected.
//
// Mobile is the design target, not a fallback:
//   - trigger and every option clear the 44px touch floor (min-h-11 / min-h-[44px])
//   - the panel matches the trigger's width and never exceeds the viewport, so a long
//     term name truncates instead of pushing the document wide at 360px
//   - it collision-pads off the screen edges and scrolls internally when the term
//     list outgrows the available height (both inherited from DropdownMenuContent)
//   - the label collapses to the term name alone on narrow screens; the date range
//     lives in the panel, where there is room for it

import { useQuery } from "@tanstack/react-query"
import { CalendarRange, ChevronDown } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type TermOption = {
  id: string
  name: string
  startsAt: Date
  endsAt: Date
}

// Sentinel for the "no term selected" row. DropdownMenuRadioGroup's value is a string,
// so null needs a stand-in; it never leaves this file — onChange always emits null.
const ALL = "__all__"

/**
 * The term list every TermSelect (and every caller that needs to know which term is
 * current) reads. One shared query key, so N selectors on a page are one request.
 * Terms only change when an admin edits them, hence the long staleTime — the same
 * reasoning TermCountdown uses.
 */
export function useTerms() {
  const trpc = useTRPC()
  const q = useQuery(trpc.term.listStarted.queryOptions(undefined, { staleTime: 5 * 60_000 }))
  return {
    terms: q.data?.terms ?? [],
    /** Latest STARTED term — what a picker or board should default to. */
    currentTermId: q.data?.currentTermId ?? null,
    /** The term the server will actually let you mint from. Null between terms. */
    buyableTermId: q.data?.buyableTermId ?? null,
    isLoading: q.isLoading,
  }
}

/** "5 Jan – 20 Mar 2026", or "5 Jan 2026 – 20 Mar 2027" when the years differ. */
function formatWindow(startsAt: Date, endsAt: Date): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const sameYear = start.getFullYear() === end.getFullYear()
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    })
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`
}

export function TermSelect({
  value,
  onChange,
  allLabel,
  className,
  ariaLabel = "Select term",
}: {
  /** Selected term id. null = `allLabel` when one is given, else the current term. */
  value: string | null
  onChange: (termId: string | null) => void
  /** Render a "no term" row (e.g. "All terms"). Omit to force a term choice. */
  allLabel?: string
  className?: string
  ariaLabel?: string
}) {
  const { terms, currentTermId, isLoading } = useTerms()

  // A null value means "current term" unless the caller offered an All row — that
  // keeps the trigger honest on first paint, before the list has resolved and the
  // parent has had a chance to fill in an id.
  const selectedId = value ?? (allLabel ? null : currentTermId)
  const selected = terms.find((t) => t.id === selectedId) ?? null
  const label = selected ? selected.name : (allLabel ?? "Term")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isLoading || terms.length === 0}
        aria-label={ariaLabel}
        className={cn(
          // button-outline (DESIGN.md §5): surface fill, 1px border-subtle, ink text,
          // rounded-md. Flat at rest — the lift belongs to the panel, not the trigger.
          "inline-flex min-h-11 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium",
          "transition-colors duration-150 hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          // The chevron flips while the panel is open — the only state the trigger
          // animates, and it reads as "this is the thing that opened".
          "[&[data-state=open]>svg:last-child]:rotate-180",
          className,
        )}
      >
        <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {/* truncate + min-w-0 on the flex parent: a long term name shortens rather
            than widening the trigger past its container (360px is the design floor). */}
        <span className="truncate">{isLoading ? "—" : label}</span>
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        // Match the trigger so options land directly under the label they replace,
        // with a floor so an icon-narrow trigger still gets a readable panel.
        className="max-w-[calc(100vw-24px)] min-w-[max(var(--radix-dropdown-menu-trigger-width),14rem)]"
      >
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Term
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={selectedId ?? ALL}
          onValueChange={(next) => onChange(next === ALL ? null : next)}
        >
          {allLabel ? (
            <DropdownMenuRadioItem value={ALL} className="min-h-11 pr-3">
              {allLabel}
            </DropdownMenuRadioItem>
          ) : null}
          {terms.map((term) => (
            <DropdownMenuRadioItem key={term.id} value={term.id} className="min-h-11 pr-3">
              <span className="flex min-w-0 flex-1 flex-col py-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{term.name}</span>
                  {term.id === currentTermId ? (
                    // Neutral, not brand crimson: this marks state, and DESIGN.md
                    // reserves the accent for primary actions.
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Current
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs tabular-nums text-muted-foreground">
                  {formatWindow(term.startsAt, term.endsAt)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
