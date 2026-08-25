"use client"

import * as React from "react"

import "./cosmetics.css"
import { ZpLogo } from "@/components/nav/zp-logo"

export const RING_SLUGS = [
  "spectrum",
  "glow",
  "dash",
  "shimmer",
  "comet",
  "breathe",
  "cloudring",
  "ropering",
  "chrysanthemumring",
  "logoring",
] as const

// Cloud Ring — a band of soft white puffs around the avatar. Blobs sit in the
// visible annulus (avatar masks the inner half), radii vary a touch so the edge
// reads as lumpy cloud, not a bead necklace. Computed once at module load
// (deterministic → SSR/CSR match); CSS blurs the group into fluff + drifts it.
const CLOUD_BLOBS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2
  const r = 38 // ring radius in the 100-unit viewBox; avatar masks the inner half
  const br = 7.5 + (i % 4) * 1.2 // 7.5 / 8.7 / 9.9 / 11.1, cycling — r+br ≤ 49 < 50 (no edge clip)
  return { cx: 50 + r * Math.cos(a), cy: 50 + r * Math.sin(a), r: br }
})

export type RingSlug = (typeof RING_SLUGS)[number]

function isRingSlug(value: string): value is RingSlug {
  return (RING_SLUGS as readonly string[]).includes(value)
}

export function AvatarRing({
  variant,
  size = 80,
  children,
}: {
  variant: string | null
  /** Pixel size of the wrapped avatar — drives ring geometry so it scales. */
  size?: number
  children: React.ReactNode
}) {
  if (!variant || !isRingSlug(variant)) return <>{children}</>

  return (
    <div
      className={`cosmetic-motion avatar-ring r-${variant}`}
      style={{ ["--ring-size" as string]: `${size}px` }}
    >
      {variant === "dash" && (
        <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--primary)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="9 11"
          />
        </svg>
      )}
      {variant === "comet" && (
        <span className="comet" aria-hidden="true">
          <i />
        </span>
      )}
      {variant === "logoring" && (
        <span className="logo-orbit" aria-hidden="true">
          <ZpLogo className="ring-logo ring-logo--top" />
          <ZpLogo className="ring-logo ring-logo--right" />
          <ZpLogo className="ring-logo ring-logo--bottom" />
          <ZpLogo className="ring-logo ring-logo--left" />
        </span>
      )}
      {variant === "cloudring" && (
        <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
          <g className="cloud-blobs">
            {CLOUD_BLOBS.map((b, i) => (
              <circle key={i} cx={b.cx} cy={b.cy} r={b.r} />
            ))}
          </g>
        </svg>
      )}
      <div className="avatar-ring__inner">{children}</div>
    </div>
  )
}
