"use client"

import * as React from "react"

import "./cosmetics.css"
import { ZpLogo } from "@/components/nav/zp-logo"
import { EyeGlobe } from "@/components/cosmetics/card-background"

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
  "leafring",
  "neonsun",
  "lavaring",
  "ripple",
  "voltage",
  "sweep",
  "eyesring",
  "carpetring",
  "stepsring",
  "flagring",
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

// ── 26F geometry — all in the 100-unit ring viewBox, computed once at module load
// (deterministic → SSR/CSR match). The avatar masks r < ~40, so the visible band is
// r 40–50 and "on the band" means r = 45. Angles run clockwise from 12 o'clock.
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180
  return [+(50 + r * Math.sin(a)).toFixed(2), +(50 - r * Math.cos(a)).toFixed(2)] as const
}

// Maple Wreath — tilted leaves around the band, each rustling on its own delay.
const WREATH = Array.from({ length: 16 }, (_, i) => {
  const deg = i * 22.5
  const [x, y] = at(deg, 45)
  return {
    transform: `translate(${x} ${y}) rotate(${deg + 55})`,
    fill: ["#ffb627", "#e2711d", "#c0392b", "#8e2a17"][i % 4],
    delay: `${(-i * 0.37).toFixed(2)}s`,
  }
})

// Old Glory — static. A navy canton over the top-left quarter carrying five stars,
// then thirteen red/white stripes (red first and last, like the flag) round the
// other three quarters. Wedges run from the centre; the avatar hides that part.
const wedge = (from: number, to: number) => {
  const [x0, y0] = at(from, 50)
  const [x1, y1] = at(to, 50)
  return `M50 50 L${x0} ${y0} A50 50 0 0 1 ${x1} ${y1} Z`
}
const FLAG_STRIPES = Array.from({ length: 13 }, (_, i) => ({
  d: wedge((i * 270) / 13, ((i + 1) * 270) / 13 + 0.3), // +0.3° overlap hides AA seams
  fill: i % 2 ? "#ffffff" : "#b22234",
}))
const FLAG_CANTON = wedge(270, 360)
const FLAG_STARS = Array.from({ length: 5 }, (_, i) => {
  const [cx, cy] = at(270 + (90 * (i + 0.5)) / 5, 45)
  return Array.from({ length: 10 }, (_, k) => {
    const [px, py] = at(k * 36, k % 2 ? 1.3 : 3.2)
    return `${(px - 50 + cx).toFixed(2)},${(py - 50 + cy).toFixed(2)}`
  }).join(" ")
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
  // unique per instance so a feed full of the same ring never shares filter ids
  const id = React.useId().replace(/:/g, "")

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
      {variant === "leafring" && (
        <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="#5a2d0c" strokeWidth={1.6} />
          {WREATH.map((l, i) => (
            <g key={i} transform={l.transform}>
              <path
                className="wreath-leaf"
                d="M0 -7.5 C4.4 -3.2 4.4 3.2 0 7.5 C-4.4 3.2 -4.4 -3.2 0 -7.5 Z"
                fill={l.fill}
                style={{ animationDelay: l.delay }}
              />
            </g>
          ))}
        </svg>
      )}
      {variant === "lavaring" && (
        <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ff4f8b" />
              <stop offset="0.5" stopColor="#ff7a3d" />
              <stop offset="1" stopColor="#ffc24b" />
            </linearGradient>
            <filter id={id}>
              <feGaussianBlur stdDeviation="2.2" />
              <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
            </filter>
          </defs>
          <g filter={`url(#${id})`} fill={`url(#${id}-g)`}>
            <circle cx="50" cy="50" r="45" fill="none" stroke={`url(#${id}-g)`} strokeWidth={5} />
            <g className="lava-orbit o1">
              <circle cx="50" cy="5" r="4.6" />
              <circle cx="50" cy="95" r="4" />
            </g>
            <g className="lava-orbit o2">
              <circle cx="95" cy="50" r="4.4" />
            </g>
            <g className="lava-orbit o3">
              <circle cx="5" cy="50" r="4.8" />
              <circle cx="82" cy="18" r="3.6" />
            </g>
          </g>
        </svg>
      )}
      {variant === "ripple" && (
        <span className="ripples" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      {variant === "voltage" && (
        <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence
                type="turbulence"
                baseFrequency="0.09"
                numOctaves={2}
                seed={1}
                result="n"
              >
                <animate
                  attributeName="seed"
                  values="1;7;3;9;5;2;8"
                  dur="0.7s"
                  calcMode="discrete"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={7}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
          <circle cx="50" cy="50" r="45" fill="none" stroke="#150c33" strokeWidth={9} />
          <g filter={`url(#${id})`} fill="none" strokeLinecap="round">
            <circle cx="50" cy="50" r="45" stroke="#8b5cf6" strokeWidth={3.2} />
            <circle cx="50" cy="50" r="45" stroke="#e0f7ff" strokeWidth={1.5} />
          </g>
        </svg>
      )}
      {variant === "eyesring" && <EyeGlobe id={id} ring className="ring-svg" />}
      {variant === "stepsring" && (
        <span className="ring-clip" aria-hidden="true">
          <span className="steps-layer" />
        </span>
      )}
      {variant === "flagring" && (
        <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
          {FLAG_STRIPES.map((s, i) => (
            <path key={i} d={s.d} fill={s.fill} />
          ))}
          <path d={FLAG_CANTON} fill="#3c3b6e" />
          {FLAG_STARS.map((points, i) => (
            <polygon key={i} points={points} fill="#ffffff" />
          ))}
        </svg>
      )}
      <div className="avatar-ring__inner">{children}</div>
    </div>
  )
}
