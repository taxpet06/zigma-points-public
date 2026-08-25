"use client"

// DailyReward — the slot machine. One free spin a day, then SLOTS_REPLAY_COST ZP a
// re-spin (a wager — paid spins pay out exactly like the free one).
//
// Two triggers, one machine: variant="header" is the compact icon button; variant
// "card" is a game-hub tile (see /game-hub, Casual tab). Both open the same dialog.
// Shows a pulse until the user has taken the free spin; tapping it opens the machine.
// The reels animate to the SERVER's result (dailyReward.claim decides the payout AND
// the debit — the client only plays it back).
//
// Reels: an HTML window (overflow-hidden) scrolling a column of SVG tick/cross
// symbols via the Web Animations API — no motion library. Reduced motion snaps to
// the result instantly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Cherry, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { navButtonClass } from "@/components/nav/nav-item"
import { cn } from "@/lib/utils"
import { Countdown } from "@/components/game-hub/countdown"
import { GameCard } from "@/components/game-hub/game-card"
import { GameDialog } from "@/components/game-hub/game-dialog"
import { ZpRules } from "@/components/game-hub/zp-rules"
import { ZP_BY_TICKS } from "@/lib/daily-reward"
import { SLOTS_REPLAY_COST } from "@/lib/game-economy"
import { Button } from "@/components/ui/button"

type SpinResult = { slots: boolean[]; ticks: number; zp: number; costZp: number }
type Phase = "idle" | "spinning" | "done"

const FILLER = 14 // scroll cells before the target lands (index FILLER)

export function DailyReward({ variant = "header" }: { variant?: "header" | "card" }) {
  const { status } = useSession()
  const trpc = useTRPC()
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [result, setResult] = useState<SpinResult | null>(null)

  const statusQ = useQuery(
    trpc.dailyReward.getStatus.queryOptions(undefined, {
      enabled: status === "authenticated",
    }),
  )

  const claim = useMutation(
    trpc.dailyReward.claim.mutationOptions({
      onSuccess: (data) => setResult(data),
      onError: (err) => {
        toast.error(err.message || "Couldn't spin — try again.")
        setPhase("idle")
        setResult(null)
        // Rejected by the server (can't afford a replay, or a stale button): resync
        // status + balance so the UI matches what the server will actually allow.
        void qc.invalidateQueries(trpc.dailyReward.getStatus.queryFilter())
        void qc.invalidateQueries(trpc.user.getMe.queryFilter())
      },
    }),
  )

  // Build one strip per reel: FILLER random cells, then the real target last.
  const strips = useMemo(
    () =>
      result
        ? result.slots.map((target) => {
            const s = Array.from({ length: FILLER }, () => Math.random() < 0.5)
            s.push(target)
            return s
          })
        : null,
    [result],
  )

  // Called once the last (slowest) reel finishes. Reveal the payout + refresh balance.
  const handleSettled = useCallback(() => {
    setPhase("done")
    void qc.invalidateQueries(trpc.user.getMe.queryFilter())
  }, [qc, trpc])

  function onOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      // Reset for the next open, and resync so the card reflects the spins just taken.
      setPhase("idle")
      setResult(null)
      if (result || phase === "done") {
        void qc.invalidateQueries(trpc.dailyReward.getStatus.queryFilter())
      }
    }
  }

  function spin() {
    if (phase !== "idle") return
    setPhase("spinning")
    setResult(null)
    claim.mutate()
  }

  /** Back to a fresh idle machine, for a paid re-spin in the same session. */
  function resetForReplay() {
    setPhase("idle")
    setResult(null)
    void qc.invalidateQueries(trpc.dailyReward.getStatus.queryFilter())
  }

  if (status !== "authenticated") return null

  const freeSpinUsed = statusQ.data?.claimedToday === true
  const available = statusQ.data?.claimedToday === false // known AND free spin unused
  const replayCost = statusQ.data?.replayCost ?? SLOTS_REPLAY_COST
  const canAffordReplay = statusQ.data?.canAffordReplay ?? false
  // What the NEXT spin from an idle machine costs. A paid re-spin is allowed only
  // when the balance covers it — the server enforces the same thing.
  const nextSpinCost = freeSpinUsed ? replayCost : 0
  const canSpin = !freeSpinUsed || canAffordReplay

  return (
    <>
      {variant === "card" ? (
        <GameCard
          icon={Cherry}
          name="Daily Spin"
          hint={available ? "Free spin ready" : canAffordReplay ? `Re-spin · ${replayCost} ZP` : "Back tomorrow"}
          available={available}
          onClick={() => setOpen(true)}
          ariaLabel={available ? "Daily Spin — free spin to win ZP" : `Daily Spin — re-spin for ${replayCost} ZP`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={available ? "Daily reward — spin to win ZP" : "Daily reward — time until next spin"}
          className={cn(navButtonClass, "relative")}
        >
          <Cherry className="h-5 w-5" aria-hidden="true" />
          {/* Notification dot — only while today's spin is unclaimed */}
          {available && (
            <>
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            </>
          )}
        </button>
      )}

      <GameDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Daily Spin"
        description="Line up the ticks. Your first spin each day is free."
      >
        <Machine strips={strips} phase={phase} onSettled={handleSettled} />

        <ResultBar phase={phase} zp={result?.zp ?? 0} ticks={result?.ticks ?? 0} />

        {phase === "done" ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="outline"
              onClick={resetForReplay}
              disabled={!canAffordReplay}
            >
              {canAffordReplay ? `Spin again · ${replayCost} ZP` : `Need ${replayCost} ZP`}
            </Button>
            <Button className="flex-1" onClick={() => onOpenChange(false)}>
              Collect
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={spin} disabled={phase === "spinning" || !canSpin}>
            {phase === "spinning" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Spinning…
              </>
            ) : nextSpinCost > 0 ? (
              canSpin ? `Spin again · ${nextSpinCost} ZP` : `Need ${nextSpinCost} ZP to spin again`
            ) : (
              "Spin — free"
            )}
          </Button>
        )}

        {/* The same "How ZP works here" panel every game modal renders. */}
        <ZpRules
          rules={[
            { what: "3 ticks — jackpot", zp: `+${ZP_BY_TICKS[3]} ZP` },
            { what: "2 ticks", zp: `+${ZP_BY_TICKS[2]} ZP` },
            { what: "1 tick", zp: `+${ZP_BY_TICKS[1]} ZP` },
            { what: "No ticks", zp: "0 ZP" },
          ]}
          replayNote={
            <>
              First spin each day is free.{" "}
              <span className="font-semibold text-foreground">Re-spins cost {replayCost} ZP</span>{" "}
              and pay out exactly the same — the odds are in your favour, but the ZP is real.
            </>
          }
        />

        {/* Out of affordable spins: show when the free one comes back. */}
        {!canSpin && phase === "idle" && (
          <Countdown
            label="Free spin resets in"
            onExpire={() => void qc.invalidateQueries(trpc.dailyReward.getStatus.queryFilter())}
          />
        )}
      </GameDialog>
    </>
  )
}

/** The three-reel machine frame. */
function Machine({
  strips,
  phase,
  onSettled,
}: {
  strips: boolean[][] | null
  phase: Phase
  onSettled: () => void
}) {
  const won = phase === "done"
  return (
    <div className="relative overflow-hidden rounded-2xl bg-zinc-950 p-5 ring-1 ring-border">
      {/* Win glow — brightens with the payout */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: won ? 1 : 0,
          // Win glow sourced from the same emerald token as the tick glyphs (the
          // semantic "win" accent) so there's one green, not a bespoke literal.
          backgroundImage:
            "radial-gradient(60% 50% at 50% 45%, color-mix(in oklab, var(--color-emerald-500) 28%, transparent), transparent 70%)",
        }}
      />
      <div className="relative flex items-center justify-center gap-3">
        {[0, 1, 2].map((i) => (
          <Reel
            key={i}
            strip={strips ? strips[i] : null}
            index={i}
            // Only the last reel (slowest) reports settle — it always finishes last.
            onSettled={i === 2 ? onSettled : undefined}
          />
        ))}
      </div>
    </div>
  )
}

/** One reel: a fixed window scrolling a column of SVG symbols to the target. */
function Reel({
  strip,
  index,
  onSettled,
}: {
  strip: boolean[] | null
  index: number
  onSettled?: () => void
}) {
  const winRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const win = winRef.current
    const col = colRef.current
    if (!strip || !win || !col) return

    const cellH = win.offsetHeight
    const finalY = -(strip.length - 1) * cellH

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      col.style.transform = `translateY(${finalY}px)`
      onSettled?.()
      return
    }

    const anim = col.animate(
      [{ transform: "translateY(0px)" }, { transform: `translateY(${finalY}px)` }],
      {
        duration: 1500 + index * 450,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    )
    if (onSettled) anim.addEventListener("finish", onSettled, { once: true })
    return () => anim.cancel()
  }, [strip, index, onSettled])

  const cells = strip ?? [null]

  return (
    <div
      ref={winRef}
      className="relative h-20 w-16 overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10 sm:h-24 sm:w-20"
    >
      {/* Glass highlight over the reel */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-white/10 via-transparent to-black/40"
      />
      <div ref={colRef} className="absolute inset-x-0 top-0" style={{ willChange: "transform" }}>
        {cells.map((tick, i) => (
          <div key={i} className="flex h-20 w-full items-center justify-center p-2 sm:h-24">
            <Glyph tick={tick} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** tick = ✓ (win), false = ✗, null = idle "?". */
function Glyph({ tick }: { tick: boolean | null }) {
  return (
    <svg viewBox="0 0 84 84" className="h-full w-full" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="72"
        height="72"
        rx="16"
        className={tick ? "fill-emerald-500/15" : "fill-white/5"}
      />
      {tick === null ? (
        <text
          x="42"
          y="56"
          textAnchor="middle"
          className="fill-zinc-500"
          fontSize="42"
          fontWeight="700"
        >
          ?
        </text>
      ) : tick ? (
        <path
          d="M28 44 L38 55 L58 29"
          fill="none"
          className="stroke-emerald-400"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <g className="stroke-zinc-600" strokeWidth="8" strokeLinecap="round">
          <path d="M32 32 L52 52" />
          <path d="M52 32 L32 52" />
        </g>
      )}
    </svg>
  )
}

/** Below-the-reels status line: prompt → spinning → payout. */
function ResultBar({ phase, zp, ticks }: { phase: Phase; zp: number; ticks: number }) {
  if (phase !== "done") {
    return (
      <p className="text-center text-sm text-muted-foreground">
        {phase === "spinning" ? "Rolling the reels…" : "Tap Spin to try your luck."}
      </p>
    )
  }

  if (zp === 0) {
    return (
      <p className="text-center text-sm font-medium text-muted-foreground">
        No ticks this time.
      </p>
    )
  }

  return (
    <div className="text-center motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {ticks === 3 ? "Jackpot!" : "You won"}
      </p>
      <p className="text-3xl font-bold tabular-nums text-emerald-500">+{zp} ZP</p>
    </div>
  )
}
