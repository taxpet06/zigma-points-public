"use client"

// CasinoFairnessDialog — the home for the whole fairness surface in the Casino tab
// (10-UI-SPEC.md § CasinoShell). No game ships in Phase 10 (10-CONTEXT.md § Scope
// fence), so this hosts FairnessPanel + BetHistory through the existing GameDialog/
// CasinoShell with an empty board and no bet control — CASN-06 and FAIR-01…04 need a
// real, reachable screen well before Phase 11's first game exists.
//
// Self-contained trigger + dialog, mirroring the existing Wordle/Tetris GameCard
// pattern (game-hub/wordle.tsx) rather than lifting open state into game-hub-tabs.tsx.

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ShieldCheck } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { CasinoShell } from "./casino-shell"
import { FairnessPanel } from "./fairness-panel"
import { BetHistory, type HistoryRowSelection } from "./bet-history"

export function CasinoFairnessDialog() {
  const trpc = useTRPC()
  const [open, setOpen] = React.useState(false)
  // Shared between the two panels: a bet-history row tap sets this, FairnessPanel reads
  // it to drive (and scroll to) the Verifier it hosts internally. Carries `config` and
  // `recordedMultiplier` (11-07) straight through unchanged — this dialog never reads
  // them itself, it only holds and forwards the HistoryRowSelection.
  const [historyPrefill, setHistoryPrefill] = React.useState<HistoryRowSelection | null>(null)

  const meQ = useQuery(trpc.user.getMe.queryOptions())

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Provably fair
      </Button>

      <GameDialog open={open} onOpenChange={setOpen} title="Provably fair">
        <CasinoShell
          board={null}
          outcome={null}
          balance={meQ.data?.zigmaPoints ?? 0}
          // ponytail: the control bar's second row (BetInput + Bet button) is filled in by
          // each game starting Phase 11. No game ships in Phase 10 (10-CONTEXT.md § Scope
          // fence) — a disabled bet control here would stake nothing and lie about what
          // this screen does, so the row is simply absent rather than faked.
          controls={null}
          panels={
            <>
              <FairnessPanel historyPrefill={historyPrefill} />
              <BetHistory onSelectRow={setHistoryPrefill} />
            </>
          }
        />
      </GameDialog>
    </>
  )
}
