"use client"

import * as React from "react"

import "./cosmetics.css"
import { ZpLogo } from "@/components/nav/zp-logo"

export const BACKGROUND_SLUGS = [
  "aurora",
  "nebula",
  "holo",
  "starfield",
  "ember",
  "mesh",
  "clouds",
  "rope",
  "chrysanthemum",
  "logorain",
  "foliage",
  "outrun",
  "lavalamp",
  "tidepool",
  "storm",
  "radar",
  "eyes",
  "carpet",
  "steps",
  "home",
] as const

// Logo Storm (LEGENDARY) — tiny app logos raining down, each rotating as it
// falls. Negative delays start every drop mid-fall so none is seen to spawn; the
// loop teleports off-screen (above <-> below the clip) so restarts are invisible.
const LOGO_RAIN = [
  { left: "6%", size: 20, dur: "6.5s", delay: "-1.2s" },
  { left: "16%", size: 14, dur: "8.0s", delay: "-4.0s" },
  { left: "27%", size: 24, dur: "5.5s", delay: "-2.6s" },
  { left: "38%", size: 16, dur: "7.2s", delay: "-0.5s" },
  { left: "47%", size: 22, dur: "6.0s", delay: "-3.4s" },
  { left: "57%", size: 15, dur: "8.4s", delay: "-1.8s" },
  { left: "66%", size: 26, dur: "5.8s", delay: "-4.6s" },
  { left: "75%", size: 18, dur: "7.6s", delay: "-0.9s" },
  { left: "84%", size: 14, dur: "6.8s", delay: "-3.0s" },
  { left: "92%", size: 21, dur: "6.2s", delay: "-2.1s" },
  { left: "11%", size: 16, dur: "9.0s", delay: "-5.5s" },
  { left: "62%", size: 19, dur: "7.9s", delay: "-6.2s" },
]

export type BackgroundSlug = (typeof BACKGROUND_SLUGS)[number]

function isBackgroundSlug(value: string): value is BackgroundSlug {
  return (BACKGROUND_SLUGS as readonly string[]).includes(value)
}

const EMBER_SPARKS = [
  { left: "20%", duration: "3.4s", delay: "0s" },
  { left: "42%", duration: "4.2s", delay: "0.8s" },
  { left: "63%", duration: "3.0s", delay: "1.6s" },
  { left: "80%", duration: "4.6s", delay: "0.4s" },
]

// ── 26F ──────────────────────────────────────────────────────────────────────

// Fall Foliage — each leaf's column is as tall as the card, so translateY(100%) in
// cosmetics.css is "one card height" at every card size; the leaf itself sways.
const LEAVES = [
  {
    left: "6%",
    size: 22,
    fall: "9s",
    sway: "2.6s",
    delay: "-1s",
    color: "#ffb627",
  },
  {
    left: "17%",
    size: 30,
    fall: "11s",
    sway: "3.4s",
    delay: "-6s",
    color: "#c0392b",
  },
  {
    left: "29%",
    size: 18,
    fall: "8s",
    sway: "2.2s",
    delay: "-3.5s",
    color: "#e2711d",
  },
  {
    left: "40%",
    size: 26,
    fall: "12s",
    sway: "3.1s",
    delay: "-8.2s",
    color: "#8e2a17",
  },
  {
    left: "52%",
    size: 20,
    fall: "9.5s",
    sway: "2.8s",
    delay: "-0.4s",
    color: "#f4d35e",
  },
  {
    left: "63%",
    size: 32,
    fall: "10.5s",
    sway: "3.6s",
    delay: "-4.8s",
    color: "#e2711d",
  },
  {
    left: "73%",
    size: 18,
    fall: "8.6s",
    sway: "2.4s",
    delay: "-7.1s",
    color: "#c0392b",
  },
  {
    left: "83%",
    size: 24,
    fall: "11.5s",
    sway: "3s",
    delay: "-2.3s",
    color: "#ffb627",
  },
  {
    left: "92%",
    size: 22,
    fall: "9.8s",
    sway: "2.7s",
    delay: "-5.6s",
    color: "#8e2a17",
  },
  {
    left: "46%",
    size: 17,
    fall: "13s",
    sway: "2.3s",
    delay: "-10s",
    color: "#f4d35e",
  },
]

// Lava Lamp — blob x/y/radius in the 300×150 viewBox, and how far each travels.
// Bottom blobs rise out of the pool (negative dy), top blobs drip down from the cap.
const LAVA_BLOBS = [
  { cx: 40, cy: 140, r: 16, dy: -105, dur: "13s", delay: "-2s" },
  { cx: 95, cy: 145, r: 22, dy: -95, dur: "17s", delay: "-9s" },
  { cx: 150, cy: 140, r: 14, dy: -115, dur: "11s", delay: "-5s" },
  { cx: 205, cy: 145, r: 20, dy: -100, dur: "15s", delay: "-12s" },
  { cx: 262, cy: 140, r: 15, dy: -110, dur: "12s", delay: "-7s" },
  { cx: 70, cy: 5, r: 12, dy: 90, dur: "16s", delay: "-4s" },
  { cx: 180, cy: 5, r: 13, dy: 95, dur: "14s", delay: "-10s" },
  { cx: 240, cy: 5, r: 10, dy: 80, dur: "18s", delay: "-1s" },
]

// Radar — blips placed by polar coords (degrees clockwise from 12 o'clock, radius as
// % of the square scope), and each one's flash is delayed by exactly the time the
// sweep takes to reach its angle, so the beam "finds" it. RADAR_PERIOD must match
// the .radar-sweep animation in cosmetics.css. Angles hug the horizontal so blips
// stay inside a wide, short card.
const RADAR_PERIOD = 4
const RADAR_BLIPS = [
  { deg: 70, r: 28 },
  { deg: 115, r: 20 },
  { deg: 160, r: 8 },
  { deg: 250, r: 30 },
  { deg: 290, r: 16 },
].map(({ deg, r }) => {
  const a = (deg * Math.PI) / 180
  return {
    left: `${(50 + r * Math.sin(a)).toFixed(2)}%`,
    top: `${(50 - r * Math.cos(a)).toFixed(2)}%`,
    delay: `${((deg / 360) * RADAR_PERIOD).toFixed(2)}s`,
  }
})

// Eye Globe — the eyes texture zooms in and out under a fisheye warp. The warp is an
// feDisplacementMap driven by a precomputed map (public/assets/26F/globe-*.png:
// R/G = x/y offset, f(r) = 0.6r + 0.4r³ — magnified centre, compressed rim). `scale`
// is the map's full range in viewBox units and must match how the PNG was generated.
// The texture is oversized (`img`) because the rim samples from outside the viewBox.
// Shared with the matching ring, which passes `ring`.
export function EyeGlobe({
  id,
  ring = false,
  className,
}: {
  id: string
  ring?: boolean
  className?: string
}) {
  const { w, h, scale, map, img } = ring
    ? { w: 100, h: 100, scale: 15.4, map: "globe-ring.png", img: 240 }
    : { w: 300, h: 150, scale: 119.18, map: "globe-card.png", img: 440 }
  const pad = (img - w) / 2
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <filter
          id={id}
          filterUnits="userSpaceOnUse"
          x={-pad}
          y={-(img - h) / 2}
          width={img}
          height={img}
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={`/assets/26F/${map}`}
            x={0}
            y={0}
            width={w}
            height={h}
            preserveAspectRatio="none"
            result="map"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={scale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          {/* displacement samples nearest-neighbour; a hair of blur hides the jaggies */}
          <feGaussianBlur stdDeviation={ring ? 0.3 : 0.6} />
        </filter>
        <radialGradient id={`${id}-shade`} cx="50%" cy="50%" r="60%">
          <stop offset="0.45" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="34%" cy="28%" r="40%">
          <stop offset="0" stopColor="#fff" stopOpacity={0.45} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          {ring ? <circle cx={w / 2} cy={h / 2} r={w / 2} /> : <rect width={w} height={h} />}
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <g filter={`url(#${id})`}>
          <g transform={`translate(${w / 2} ${h / 2})`}>
            <g>
              <animateTransform
                attributeName="transform"
                type="scale"
                values="1;1.6;1"
                keyTimes="0;0.5;1"
                calcMode="spline"
                keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
                dur="8s"
                repeatCount="indefinite"
              />
              <image
                href="/assets/26F/eyes.jpg"
                x={-img / 2}
                y={-img / 2}
                width={img}
                height={img}
              />
            </g>
          </g>
        </g>
        <rect width={w} height={h} fill={`url(#${id}-shade)`} />
        <rect width={w} height={h} fill={`url(#${id}-shine)`} />
      </g>
    </svg>
  )
}

export function CardBackground({ variant }: { variant: string | null }) {
  // unique per instance so multiple previews (e.g. the Shop grid) never share
  // the same SVG filter id
  const filterId = React.useId().replace(/:/g, "")

  if (!variant || !isBackgroundSlug(variant)) return null

  switch (variant) {
    case "aurora":
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-aurora" />

    case "nebula":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-nebula">
          <svg viewBox="0 0 300 150" preserveAspectRatio="xMidYMid slice">
            <filter id={filterId}>
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.02"
                numOctaves={3}
                seed={7}
                result="n"
              >
                <animate
                  attributeName="baseFrequency"
                  dur="24s"
                  values="0.012 0.02;0.02 0.03;0.012 0.02"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feColorMatrix
                in="n"
                type="matrix"
                values="0 0 0 0 0.55  0 0 0 0 0.05  0 0 0 0 0.22  0 0 0 1.4 -0.35"
              />
            </filter>
            <rect width="300" height="150" fill="oklch(0.2 0.1 350)" />
            <rect width="300" height="150" filter={`url(#${filterId})`} />
          </svg>
        </div>
      )

    case "holo":
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-holo" />

    case "starfield":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-star">
          <div className="stars" />
          <div className="stars2" />
        </div>
      )

    case "ember":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-ember">
          <div className="glow" />
          {EMBER_SPARKS.map((spark, i) => (
            <span
              key={i}
              className="spark"
              style={{
                left: spark.left,
                animationDuration: spark.duration,
                animationDelay: spark.delay,
              }}
            />
          ))}
        </div>
      )

    case "mesh":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-mesh">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
        </div>
      )

    case "clouds":
      // Seamless cloud texture scrolling right->left. The scrolling layer is a
      // ::before in cosmetics.css (a doubled tile translated -50% for a seamless
      // loop); this element just carries the class + sky tint behind it.
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-clouds" />

    case "rope":
      // Seamless rope texture scrolling top->bottom — same doubled-tile ::before
      // technique as clouds but on the Y axis.
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-rope" />

    case "chrysanthemum":
      // Seamless floral texture scrolling diagonally — a 2×2-tile ::before
      // translated one tile on both axes (cosmetics.css).
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-chrysanthemum" />

    case "logorain":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-logorain">
          {LOGO_RAIN.map((d, i) => (
            <ZpLogo
              key={i}
              className="logo-drop"
              style={{
                left: d.left,
                height: d.size,
                animationDuration: d.dur,
                animationDelay: d.delay,
              }}
            />
          ))}
        </div>
      )

    case "foliage":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-foliage">
          {LEAVES.map((l, i) => (
            <span
              key={i}
              className="leaf-fall"
              style={{
                left: l.left,
                animationDuration: l.fall,
                animationDelay: l.delay,
              }}
            >
              <i
                style={{
                  width: l.size,
                  height: l.size,
                  background: l.color,
                  animationDuration: l.sway,
                  animationDelay: l.delay,
                }}
              />
            </span>
          ))}
        </div>
      )

    case "outrun":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-outrun">
          <div className="sun" />
          <div className="floor">
            <div className="grid" />
          </div>
        </div>
      )

    case "lavalamp":
      // Classic SVG goo: blur the blobs, then crush the alpha ramp so overlapping
      // blurs fuse into one surface and part again as they drift apart.
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-lavalamp">
          <svg viewBox="0 0 300 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <linearGradient
                id={`${filterId}-g`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2="0"
                y2="150"
              >
                <stop offset="0" stopColor="#ff4f8b" />
                <stop offset="0.55" stopColor="#ff7a3d" />
                <stop offset="1" stopColor="#ffc24b" />
              </linearGradient>
              <filter id={filterId} x="-10%" y="-20%" width="120%" height="140%">
                <feGaussianBlur stdDeviation="7" />
                <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" />
              </filter>
            </defs>
            <g filter={`url(#${filterId})`} fill={`url(#${filterId}-g)`}>
              <rect x="-20" y="138" width="340" height="40" />
              <rect x="-20" y="-28" width="340" height="34" />
              {LAVA_BLOBS.map((b, i) => (
                <circle
                  key={i}
                  className="lava-blob"
                  cx={b.cx}
                  cy={b.cy}
                  r={b.r}
                  style={{
                    ["--dy" as string]: `${b.dy}px`,
                    animationDuration: b.dur,
                    animationDelay: b.delay,
                  }}
                />
              ))}
            </g>
          </svg>
        </div>
      )

    case "tidepool":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-tidepool">
          <div className="caustic c1" />
          <div className="caustic c2" />
        </div>
      )

    case "storm":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-storm">
          <div className="cloud k1" />
          <div className="cloud k2" />
          <div className="rain" />
          <div className="rain r2" />
          <div className="flash" />
          <svg className="bolt" viewBox="0 0 40 100" aria-hidden="true">
            <path d="M25 0 L9 44 L20 44 L7 100 L33 36 L21 36 L31 0 Z" />
          </svg>
        </div>
      )

    case "radar":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-radar">
          <div className="radar-field">
            <span className="radar-sweep" style={{ animationDuration: `${RADAR_PERIOD}s` }} />
            {RADAR_BLIPS.map((b, i) => (
              <span
                key={i}
                className="radar-blip"
                style={{
                  left: b.left,
                  top: b.top,
                  animationDuration: `${RADAR_PERIOD}s`,
                  animationDelay: b.delay,
                }}
              />
            ))}
          </div>
        </div>
      )

    case "eyes":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-eyes">
          <EyeGlobe id={filterId} />
        </div>
      )

    case "carpet":
      // Static by request — no animation on the texture.
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-carpet" />

    case "steps":
      return (
        <div className="cosmetic-motion absolute inset-0 -z-0 bg-steps">
          <div className="steps-layer" />
        </div>
      )

    case "home":
      // LEGENDARY, static by request — the photo itself.
      return <div className="cosmetic-motion absolute inset-0 -z-0 bg-home" />
  }
}
