/**
 * Hero scene: a highlighter sun rising behind hills of torn paper. The ridges are generated from a
 * fixed seed (same drawing on every render) and each layer keeps the lighter torn edge of real paper.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const W = 1440;
const H = 330;

function ridge(seed: number, base: number, amp: number, rough: number): { fill: string; edge: string } {
  const r = rng(seed);
  const [p1, p2, p3] = [r() * 6.28, r() * 6.28, r() * 6.28];
  const pts: string[] = [];
  for (let x = -10; x <= W + 10; x += 7) {
    const y = base + amp * (Math.sin(x / 250 + p1) * 0.62 + Math.sin(x / 93 + p2) * 0.28 + Math.sin(x / 37 + p3) * 0.1) + (r() - 0.5) * rough;
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`);
  }
  return { edge: `M${pts.join(" L")}`, fill: `M${pts.join(" L")} L${W + 10},${H} L-10,${H} Z` };
}

const LAYERS = [
  { ...ridge(11, 150, 46, 5), color: "#1b4636", edgeColor: "rgba(241,244,238,.16)" },
  { ...ridge(29, 196, 34, 6), color: "#2e7359", edgeColor: "rgba(241,244,238,.28)" },
  { ...ridge(47, 244, 26, 6), color: "#d8d0b6", edgeColor: "rgba(255,255,255,.8)" },
  { ...ridge(83, 286, 16, 5), color: "#f2efe7", edgeColor: "rgba(255,255,255,.95)" },
];

function Slip({ x, y, rotate, scale = 1 }: { x: number; y: number; rotate: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`} opacity=".92">
      <path d="M0 0h30v38l-3-2.6-3 2.6-3-2.6-3 2.6-3-2.6-3 2.6-3-2.6-3 2.6-3-2.6-3 2.6z" fill="#fffdf6" />
      <rect x="4.5" y="6" width="13" height="2.2" rx="1.1" fill="#14201b" opacity=".55" />
      <rect x="4.5" y="11.5" width="9" height="2.2" rx="1.1" fill="#14201b" opacity=".35" />
      <rect x="4" y="19" width="22" height="6.5" rx="1.6" fill="#dcf45b" />
    </g>
  );
}

export function HeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className={className} aria-hidden>
      <circle cx="1030" cy="176" r="118" fill="#dcf45b" />
      <circle cx="1030" cy="176" r="150" fill="none" stroke="#dcf45b" strokeOpacity=".22" strokeWidth="1.5" strokeDasharray="3 7" />
      <circle cx="1030" cy="176" r="186" fill="none" stroke="#dcf45b" strokeOpacity=".12" strokeWidth="1.5" strokeDasharray="3 9" />
      <Slip x={300} y={52} rotate={-14} />
      <Slip x={1290} y={70} rotate={12} scale={0.8} />
      {LAYERS.map((l, i) => (
        <g key={i}>
          <path d={l.fill} fill={l.color} />
          <path d={l.edge} fill="none" stroke={l.edgeColor} strokeWidth="2.5" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  );
}

/** A torn paper edge used between sections (the lower section "tears into" the one above). */
export function TornEdge({ color, seed = 5, flip, className }: { color: string; seed?: number; flip?: boolean; className?: string }) {
  const r = rng(seed);
  const pts: string[] = [];
  for (let x = 0; x <= W; x += 9) pts.push(`${x},${(8 + r() * 9).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} 26`} preserveAspectRatio="none" className={className} style={flip ? { transform: "scaleY(-1)" } : undefined} aria-hidden>
      <path d={`M${pts.join(" L")} L${W},26 L0,26 Z`} fill={color} />
    </svg>
  );
}
