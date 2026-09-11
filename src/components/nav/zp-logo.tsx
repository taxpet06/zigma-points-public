// Brand monogram — the inner mark from the app icon (iteration-1), tile removed.
// Red gradient letterforms on a transparent background, for use in the header.
// viewBox is cropped tight to the letters' ink bounds so it sizes cleanly by height.
// ponytail: the glyphs are still a C and a P — the Zigma rebrand deliberately kept
// the existing artwork, so only the component/ids were renamed. Redraw the paths
// if the mark itself is ever restyled to ZP.

export function ZpLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="64 136 388 260"
      className={className}
      style={style}
      role="img"
      aria-label="Zigma Points"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="zp-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F43F5E" />
          <stop offset="1" stopColor="#E11D48" />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke="url(#zp-logo-grad)"
        strokeWidth={58}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* C: open circular arc, gap on the right */}
        <path d="M 234 213 A 80 80 0 1 0 234 339" />
        {/* P stem */}
        <path d="M 312 336 L 312 176" />
        {/* P bowl */}
        <path d="M 312 176 L 360 176 A 52 52 0 0 1 360 280 L 312 280" />
      </g>
    </svg>
  )
}
