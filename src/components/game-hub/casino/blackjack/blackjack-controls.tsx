"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { BlackjackAction } from "@/lib/casino/blackjack"
import { MAX_PAYOUT, payoutFor } from "@/lib/casino/limits"

const ACTION_LABEL: Record<BlackjackAction, string> = {
  hit: "Hit",
  stand: "Stand",
  double: "Double",
  split: "Split",
  insure: "Take insurance",
  no_insurance: "No thanks",
}

export function BlackjackActions({
  actions,
  busy,
  onAction,
  canAffordDouble,
  canAffordSplit,
  canAffordInsurance,
  splitHint,
}: {
  actions: BlackjackAction[]
  busy: boolean
  onAction: (a: BlackjackAction) => void
  canAffordDouble: boolean
  canAffordSplit: boolean
  canAffordInsurance: boolean
  /** Shown under the action bar while a split is available / in play. */
  splitHint?: string | null
}) {
  if (actions.length === 0) return null

  function disabledReason(a: BlackjackAction): string | null {
    if (a === "double" && !canAffordDouble) return "Need more ZP to double"
    if (a === "split" && !canAffordSplit) return "Need more ZP to split"
    if (a === "insure" && !canAffordInsurance) return "Need more ZP for insurance"
    return null
  }

  const primary = actions.filter((a) => a === "hit" || a === "stand")
  const secondary = actions.filter((a) => a !== "hit" && a !== "stand")

  return (
    <div className="flex flex-col gap-2">
      {primary.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {primary.map((a) => (
            <ActionBtn
              key={a}
              label={ACTION_LABEL[a]}
              disabled={busy || Boolean(disabledReason(a))}
              title={disabledReason(a) ?? undefined}
              primary={a === "hit"}
              onClick={() => onAction(a)}
            />
          ))}
        </div>
      )}
      {secondary.length > 0 && (
        <div className={cn("grid gap-2", secondary.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {secondary.map((a) => (
            <ActionBtn
              key={a}
              label={ACTION_LABEL[a]}
              disabled={busy || Boolean(disabledReason(a))}
              title={disabledReason(a) ?? undefined}
              onClick={() => onAction(a)}
            />
          ))}
        </div>
      )}
      {splitHint && (
        <p className="text-center text-[11px] text-muted-foreground text-pretty">{splitHint}</p>
      )}
    </div>
  )
}

function ActionBtn({
  label,
  disabled,
  title,
  primary,
  onClick,
}: {
  label: string
  disabled?: boolean
  title?: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-lg border px-3 text-sm font-semibold transition active:scale-[0.98]",
        primary
          ? "border-emerald-700/40 bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
          : "border-border bg-background hover:bg-muted disabled:opacity-50",
      )}
    >
      {label}
    </button>
  )
}

export function BlackjackCapNote({ bet }: { bet: number }) {
  // Natural BJ 2.5× is the best single-hand mult at base stake; double can be 2× on 2× stake.
  const best = Math.max(payoutFor(bet, 2.5), payoutFor(bet * 2, 2))
  if (best < MAX_PAYOUT) return null
  return (
    <p className="text-center text-[11px] text-muted-foreground">
      Payouts cap at {MAX_PAYOUT.toLocaleString()} ZP
    </p>
  )
}
