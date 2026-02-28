"use client"

import { useTheme } from "./ThemeProvider"

/* ─── Internal: 4-pointed star ─────────────────────────────── */
function Star({
  cx, cy, r = 4, r2, opacity = 0.55, color = "#D9A441",
}: {
  cx: number; cy: number; r?: number; r2?: number; opacity?: number; color?: string
}) {
  const inner = r2 ?? r * 0.38
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const radius = i % 2 === 0 ? r : inner
    return `${(cx + radius * Math.sin(a)).toFixed(2)},${(cy - radius * Math.cos(a)).toFixed(2)}`
  }).join(" ")
  return <polygon points={pts} fill={color} opacity={opacity} />
}

/* ─── Internal: Hanging lantern ─────────────────────────────── */
function Lantern({
  cx, ry, color, s = 1,
}: {
  cx: number; ry: number; color: string; s?: number
}) {
  const SL  = 13 * s   // string length
  const CW  = 10 * s   // cap half-width
  const CH  = 11 * s   // cap height
  const BW  = 22 * s   // body full width
  const BH  = 50 * s   // body height
  const BCH = 13 * s   // bottom cap height
  const TL  = 10 * s   // tassel length
  const BR  = 3.5 * s  // ball radius

  const sEnd  = ry + SL          // string ends / cap tip y
  const bTop  = sEnd + CH        // body top y
  const bBot  = bTop + BH        // body bottom y
  const bcBot = bBot + BCH       // bottom cap tip y
  const tEnd  = bcBot + TL       // tassel end y
  const ballY = tEnd + BR        // ball center y

  const hw = BW / 2              // body half-width

  return (
    <g>
      {/* String */}
      <line x1={cx} y1={ry} x2={cx} y2={sEnd} stroke="#BF8E10" strokeWidth={0.9 * s} opacity="0.75" />

      {/* Top cap — upward-pointing triangle */}
      <polygon
        points={`${cx},${sEnd - CH * 0.55} ${cx - CW},${sEnd} ${cx + CW},${sEnd}`}
        fill="#BF8E10"
        opacity="0.85"
      />

      {/* Neck connecting cap to body */}
      <rect
        x={cx - CW * 1.15} y={sEnd}
        width={CW * 2.3} height={CH}
        rx={2 * s}
        fill="#BF8E10" opacity="0.75"
      />

      {/* Body */}
      <rect
        x={cx - hw} y={bTop}
        width={BW} height={BH}
        rx={4 * s}
        fill={color} opacity="0.68"
      />

      {/* Inner window glow */}
      <rect
        x={cx - hw + 4 * s} y={bTop + 5 * s}
        width={BW - 8 * s} height={BH - 10 * s}
        rx={2 * s}
        fill="white" opacity="0.16"
      />

      {/* Body border */}
      <rect
        x={cx - hw} y={bTop}
        width={BW} height={BH}
        rx={4 * s}
        fill="none"
        stroke="#BF8E10" strokeWidth={0.9 * s} opacity="0.50"
      />

      {/* Horizontal lattice lines */}
      <line
        x1={cx - hw} y1={bTop + BH * 0.33}
        x2={cx + hw} y2={bTop + BH * 0.33}
        stroke="white" strokeWidth={0.7 * s} opacity="0.35"
      />
      <line
        x1={cx - hw} y1={bTop + BH * 0.66}
        x2={cx + hw} y2={bTop + BH * 0.66}
        stroke="white" strokeWidth={0.7 * s} opacity="0.35"
      />

      {/* Bottom cap neck */}
      <rect
        x={cx - CW * 1.15} y={bBot}
        width={CW * 2.3} height={CH * 0.5}
        rx={2 * s}
        fill="#BF8E10" opacity="0.75"
      />

      {/* Bottom cap — downward-pointing triangle */}
      <polygon
        points={`${cx - CW},${bBot + CH * 0.5} ${cx + CW},${bBot + CH * 0.5} ${cx},${bcBot}`}
        fill="#BF8E10"
        opacity="0.85"
      />

      {/* Tassel string */}
      <line x1={cx} y1={bcBot} x2={cx} y2={tEnd} stroke="#BF8E10" strokeWidth={0.9 * s} opacity="0.65" />

      {/* Tassel ball */}
      <circle cx={cx} cy={ballY} r={BR} fill="#BF8E10" opacity="0.72" />
    </g>
  )
}

/* ─── Public: Eid decorative overlay ───────────────────────── */
export function EidDecorOverlay() {
  const { theme } = useTheme()
  if (theme !== "eid") return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 152,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 0,
        opacity: 0.18,
      }}
    >
      <svg
        width="100%"
        height="152"
        viewBox="0 0 520 152"
        preserveAspectRatio="xMidYMin meet"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ── Crescent moon (هلال) — top-right corner ─────── */}
        {/*  Outer circle: cx=472 cy=22 R=20  (CW arcs)        */}
        {/*  Inner circle: cx=480 cy=22 r=16  (CCW arcs → hole) */}
        {/*  Result: left-pointing crescent ☽                   */}
        <path
          d={[
            "M 472,2",
            "A 20,20 0 0,1 492,22",
            "A 20,20 0 0,1 472,42",
            "A 20,20 0 0,1 452,22",
            "A 20,20 0 0,1 472,2 Z",
            "M 480,6",
            "A 16,16 0 0,0 496,22",
            "A 16,16 0 0,0 480,38",
            "A 16,16 0 0,0 464,22",
            "A 16,16 0 0,0 480,6 Z",
          ].join(" ")}
          fill="#D9A441"
          opacity="0.85"
        />

        {/* ── Decorative stars ─────────────────────────────── */}
        <Star cx={500} cy={14} r={4}   r2={1.6} opacity={0.7}  color="#D9A441" />
        <Star cx={505} cy={42} r={2.5} r2={1}   opacity={0.5}  color="#D9A441" />
        <Star cx={445} cy={10} r={2.8} r2={1.1} opacity={0.55} color="#FF6A3D" />
        <Star cx={55}  cy={8}  r={3.5} r2={1.4} opacity={0.6}  color="#D9A441" />
        <Star cx={18}  cy={35} r={2.2} r2={0.9} opacity={0.45} color="#A77BFA" />
        <Star cx={105} cy={50} r={2}   r2={0.8} opacity={0.4}  color="#D9A441" />
        <Star cx={200} cy={48} r={1.8} r2={0.7} opacity={0.38} color="#A77BFA" />
        <Star cx={310} cy={44} r={2.2} r2={0.9} opacity={0.42} color="#D9A441" />
        <Star cx={412} cy={46} r={1.8} r2={0.7} opacity={0.38} color="#FF6A3D" />
        <Star cx={240} cy={105} r={1.5} r2={0.6} opacity={0.28} color="#D9A441" />
        <Star cx={390} cy={112} r={1.3} r2={0.5} opacity={0.25} color="#A77BFA" />

        {/* ── Hanging rope ─────────────────────────────────── */}
        <path
          d="M -5,8 Q 260,24 525,8"
          fill="none"
          stroke="#BF8E10"
          strokeWidth="1.6"
          opacity="0.65"
        />

        {/* ── Lanterns ─────────────────────────────────────── */}
        {/* coral */}
        <Lantern cx={72}  ry={12} color="#FF6A3D" s={1}    />
        {/* gold */}
        <Lantern cx={165} ry={17} color="#C98A10" s={0.85} />
        {/* mauve — centre, largest */}
        <Lantern cx={260} ry={22} color="#A77BFA" s={1.1}  />
        {/* amber */}
        <Lantern cx={355} ry={17} color="#F59E0B" s={0.9}  />
        {/* coral — smaller */}
        <Lantern cx={447} ry={12} color="#FF6A3D" s={0.82} />
      </svg>
    </div>
  )
}
