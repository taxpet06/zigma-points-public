// The header's shared control shape — the one outline every top-bar element wears.
//
// This exists because the shell (height, radius, border, hover) was copy-pasted across
// four buttons in two files and drifted. Import it instead of restating the classes, so
// "all the top bar elements match" stays true without anyone having to remember.
//
// navItemClass  — the outline itself. For every top-bar element, interactive or not.
// navButtonClass — navItemClass + square icon-button sizing and pressable states.

import { cn } from "@/lib/utils"

export const navItemClass =
  "flex h-11 items-center justify-center rounded-md border border-border bg-background " +
  "text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out"

export const navButtonClass = cn(
  navItemClass,
  "w-11 hover:bg-muted hover:text-foreground active:scale-95",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "motion-reduce:transition-none motion-reduce:active:scale-100"
)
