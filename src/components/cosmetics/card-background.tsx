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
  }
}
