/**
 * Hero landscape: a highlighter sun rising behind hills of torn paper. The ridges are generated from
 * a fixed seed (same drawing on every render) and each layer keeps the lighter torn edge of real
 * paper. Every layer is its own element so it can move by its own distance (see `Parallax`).
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
const BLEED = 60;

function ridge(seed: number, base: number, amp: number, rough: number): { fill: string; edge: string } {
  const r = rng(seed);
  const [p1, p2, p3] = [r() * 6.28, r() * 6.28, r() * 6.28];
  const pts: string[] = [];
  for (let x = -BLEED; x <= W + BLEED; x += 7) {
    const y = base + amp * (Math.sin(x / 250 + p1) * 0.62 + Math.sin(x / 93 + p2) * 0.28 + Math.sin(x / 37 + p3) * 0.1) + (r() - 0.5) * rough;
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`);
  }
  return { edge: `M${pts.join(" L")}`, fill: `M${pts.join(" L")} L${W + BLEED},${H + 140} L${-BLEED},${H + 140} Z` };
}

/** `dx`: how far the layer follows the pointer; `dy`: how far it lags behind the scroll (px). */
const LAYERS = [
  { ...ridge(11, 150, 46, 5), color: "#1b4636", edgeColor: "rgba(241,244,238,.16)", dx: 16, dy: 74 },
  { ...ridge(29, 196, 34, 6), color: "#2e7359", edgeColor: "rgba(241,244,238,.28)", dx: 10, dy: 46 },
  { ...ridge(47, 244, 26, 6), color: "#d8d0b6", edgeColor: "rgba(255,255,255,.8)", dx: 5, dy: 20 },
  { ...ridge(83, 286, 16, 5), color: "#f2efe7", edgeColor: "rgba(255,255,255,.95)", dx: 0, dy: 0 },
];

const layer = (dx: number, dy: number): React.CSSProperties => ({
  transform: `translate3d(calc(var(--lp-mx, 0) * ${dx}px), calc(var(--lp-scroll, 0) * ${dy}px), 0)`,
  willChange: dx || dy ? "transform" : undefined,
});
const svgProps = { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMax slice", className: "absolute inset-0 h-full w-full overflow-visible" } as const;

export function HeroArt({ className }: { className?: string }) {
  return (
    <div id="hero-art" className={className} aria-hidden>
      <svg {...svgProps} style={layer(24, 120)}>
        <circle cx="1030" cy="176" r="118" fill="#dcf45b" />
        <circle cx="1030" cy="176" r="150" fill="none" stroke="#dcf45b" strokeOpacity=".22" strokeWidth="1.5" strokeDasharray="3 7" />
        <circle cx="1030" cy="176" r="186" fill="none" stroke="#dcf45b" strokeOpacity=".12" strokeWidth="1.5" strokeDasharray="3 9" />
      </svg>
      {LAYERS.map((l, i) => (
        <svg key={i} {...svgProps} style={layer(l.dx, l.dy)}>
          <path d={l.fill} fill={l.color} />
          <path d={l.edge} fill="none" stroke={l.edgeColor} strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      ))}
    </div>
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
