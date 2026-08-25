"use client"

import { cn } from "@/lib/utils"

const DENOMS = [
  { value: 100, src: "/game-hub/casino/blackjack/chip-100.png", label: "100" },
  { value: 25, src: "/game-hub/casino/blackjack/chip-25.png", label: "25" },
  { value: 5, src: "/game-hub/casino/blackjack/chip-5.png", label: "5" },
] as const

/** Break `amount` into 100 / 25 / 5 chips (greedy). Exact ZP is shown as text under the stack. */
export function chipBreakdown(amount: number): Array<{ value: number; src: string; label: string; count: number }> {
  let left = Math.max(0, Math.floor(amount))
  const out: Array<{ value: number; src: string; label: string; count: number }> = []
  for (const d of DENOMS) {
    const count = Math.floor(left / d.value)
    if (count > 0) {
      out.push({ ...d, count })
      left -= count * d.value
    }
  }
  // Stakes under 5 ZP still need a visible chip.
  if (out.length === 0 && amount > 0) {
    out.push({ ...DENOMS[2]!, count: 1 })
  }
  return out
}

/** Compact chip stack for the bet circle — denomination-accurate + PNG art with CSS fallback. */
export function ChipStack({ amount, className }: { amount: number; className?: string }) {
  if (amount <= 0) {
    return <span className="text-[10px] text-white/40">Bet</span>
  }

  const parts = chipBreakdown(amount)
  // Flatten to individual disks (cap visual height).
  const disks: Array<{ value: number; src: string; label: string; key: string }> = []
  for (const p of parts) {
    const n = Math.min(p.count, p.value >= 100 ? 3 : p.value >= 25 ? 4 : 5)
    for (let i = 0; i < n; i++) {
      disks.push({ value: p.value, src: p.src, label: p.label, key: `${p.value}-${i}` })
    }
  }
  // Prefer showing largest on top of stack visually (last in DOM = top).
  const stack = disks.slice(0, 6)

  return (
    <div className={cn("relative h-10 w-10", className)} aria-hidden="true">
      {stack.map((disk, i) => (
        <div
          key={disk.key}
          className="bj-chip absolute left-1/2 h-9 w-9 -translate-x-1/2"
          style={{ bottom: i * 3, zIndex: i }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Hobby image-opt quota; plain img like Chicken */}
          <img
            src={disk.src}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-full object-cover drop-shadow-md"
            onError={(e) => {
              const el = e.currentTarget
              el.style.display = "none"
              const fb = el.nextElementSibling as HTMLElement | null
              if (fb) fb.hidden = false
            }}
          />
          <div
            hidden
            className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/40 bg-red-700 font-mono text-[9px] font-bold text-white"
            style={{
              background: disk.value >= 100 ? "#1a1a1a" : disk.value >= 25 ? "#1d4ed8" : "#b91c1c",
            }}
          >
            {disk.label}
          </div>
        </div>
      ))}
    </div>
  )
}
