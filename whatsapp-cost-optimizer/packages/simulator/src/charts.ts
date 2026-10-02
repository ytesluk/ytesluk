/**
 * Dependency-free SVG charts for the academic report (spec §78).
 * Design: validated categorical slots (blue, orange, aqua), 2px lines, ≥8px markers, recessive grid,
 * one y-axis, legend for ≥2 series plus direct end-labels, native <title> tooltips per point, and the
 * data is always also exported as CSV (table view).
 */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK_2 = "#52514e";
const GRID = "#e4e3df";

export interface LineSeries {
  name: string;
  /** Short direct label at the line end (defaults to the name); the legend always shows the full name. */
  short?: string;
  points: Array<{ x: number; y: number }>;
}

export interface LineChartSpec {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  series: LineSeries[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  width?: number;
  height?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Rough text width for 11–12px system sans (layout only; avoids clipping without a font engine). */
const textWidth = (t: string, size = 11) => t.length * size * 0.58;

const defaultFmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

export function lineChart(spec: LineChartSpec): string {
  const W = spec.width ?? 720;
  const H = spec.height ?? 400;
  const legend = spec.series.length >= 2;
  const yfPre = spec.yFormat ?? ((v: number) => String(v));
  const yMaxPre = niceMax(Math.max(...spec.series.flatMap((s) => s.points.map((p) => p.y))));
  const tickW = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((f) => textWidth(yfPre(yMaxPre * f))));
  const endW = Math.max(...spec.series.map((s) => textWidth(s.short ?? s.name, 12)));
  const m = { top: legend ? 84 : 64, right: Math.max(24, endW + 18), bottom: 56, left: Math.max(56, tickW + 36) };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const xs = spec.series.flatMap((s) => s.points.map((p) => p.x));
  const ys = spec.series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = niceMax(Math.max(...ys));
  const fx = (x: number) => m.left + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
  const fy = (y: number) => m.top + ih - ((y - yMin) / (yMax - yMin)) * ih;
  const xf = spec.xFormat ?? defaultFmt;
  const yf = spec.yFormat ?? defaultFmt;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}" font-family="Inter, system-ui, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  parts.push(`<text x="${m.left}" y="26" font-size="16" font-weight="600" fill="${INK}">${esc(spec.title)}</text>`);
  if (spec.subtitle) parts.push(`<text x="${m.left}" y="46" font-size="12" fill="${INK_2}">${esc(spec.subtitle)}</text>`);
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const y = fy(v);
    parts.push(`<line x1="${m.left}" x2="${m.left + iw}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${m.left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="${INK_2}">${esc(yf(v))}</text>`);
  }
  const xTicks = [...new Set(xs)].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(xTicks.length / 8));
  xTicks.forEach((x, i) => {
    if (i % step !== 0 && i !== xTicks.length - 1) return;
    parts.push(`<text x="${fx(x)}" y="${m.top + ih + 18}" font-size="11" text-anchor="middle" fill="${INK_2}">${esc(xf(x))}</text>`);
  });
  parts.push(`<line x1="${m.left}" x2="${m.left + iw}" y1="${m.top + ih}" y2="${m.top + ih}" stroke="${INK_2}" stroke-width="1"/>`);
  parts.push(`<text x="${m.left + iw / 2}" y="${H - 14}" font-size="12" text-anchor="middle" fill="${INK_2}">${esc(spec.xLabel)}</text>`);
  parts.push(`<text transform="translate(14 ${m.top + ih / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${INK_2}">${esc(spec.yLabel)}</text>`);
  const ends: Array<{ y: number; x: number; label: string }> = [];
  spec.series.forEach((s, i) => {
    const color = SERIES[i % SERIES.length]!;
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    const d = pts.map((p, j) => `${j === 0 ? "M" : "L"}${fx(p.x).toFixed(1)},${fy(p.y).toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of pts) {
      parts.push(
        `<circle cx="${fx(p.x).toFixed(1)}" cy="${fy(p.y).toFixed(1)}" r="4" fill="${color}" stroke="${SURFACE}" stroke-width="2"><title>${esc(`${s.name} — ${xf(p.x)}: ${yf(p.y)}`)}</title></circle>`,
      );
    }
    const last = pts[pts.length - 1];
    if (last) ends.push({ x: fx(last.x) + 10, y: fy(last.y) + 4, label: s.short ?? s.name });
  });
  // Direct end labels with collision avoidance (≥14px apart), text in ink tokens.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;
  for (const e of ends) parts.push(`<text x="${e.x}" y="${e.y}" font-size="12" fill="${INK}">${esc(e.label)}</text>`);
  if (legend) {
    let x = m.left;
    spec.series.forEach((s, i) => {
      parts.push(`<rect x="${x}" y="61" width="14" height="3" rx="1.5" fill="${SERIES[i % SERIES.length]}"/>`);
      parts.push(`<text x="${x + 20}" y="66" font-size="11" fill="${INK_2}">${esc(s.name)}</text>`);
      x += 20 + textWidth(s.name) + 18;
    });
  }
  parts.push("</svg>");
  return parts.join("\n");
}

export interface BarChartSpec {
  title: string;
  subtitle?: string;
  yLabel: string;
  bars: Array<{ label: string; value: number; note?: string }>;
  yFormat?: (v: number) => string;
  width?: number;
  height?: number;
}

/** Single-series bar chart (magnitude → one hue). */
export function barChart(spec: BarChartSpec): string {
  const W = spec.width ?? 720;
  const H = spec.height ?? 400;
  const max = niceMax(Math.max(...spec.bars.map((b) => b.value)));
  const yf = spec.yFormat ?? defaultFmt;
  const tickW = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((f) => textWidth(yf(max * f))));
  const m = { top: 64, right: 24, bottom: 72, left: Math.max(56, tickW + 36) };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const slot = iw / spec.bars.length;
  const fit = (t: string, size: number) => {
    const maxChars = Math.floor((slot - 6) / (size * 0.58));
    return t.length <= maxChars ? t : `${t.slice(0, Math.max(1, maxChars - 1))}…`;
  };
  const bw = (iw / spec.bars.length) * 0.6;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}" font-family="Inter, system-ui, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  parts.push(`<text x="${m.left}" y="26" font-size="16" font-weight="600" fill="${INK}">${esc(spec.title)}</text>`);
  if (spec.subtitle) parts.push(`<text x="${m.left}" y="46" font-size="12" fill="${INK_2}">${esc(spec.subtitle)}</text>`);
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const y = m.top + ih - (v / max) * ih;
    parts.push(`<line x1="${m.left}" x2="${m.left + iw}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${m.left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="${INK_2}">${esc(yf(v))}</text>`);
  }
  spec.bars.forEach((b, i) => {
    const cx = m.left + (iw / spec.bars.length) * (i + 0.5);
    const h = (b.value / max) * ih;
    const y = m.top + ih - h;
    const r = Math.min(4, h / 2);
    // Rounded data-end, square baseline.
    parts.push(
      `<path d="M${cx - bw / 2},${m.top + ih} V${y + r} Q${cx - bw / 2},${y} ${cx - bw / 2 + r},${y} H${cx + bw / 2 - r} Q${cx + bw / 2},${y} ${cx + bw / 2},${y + r} V${m.top + ih} Z" fill="${SERIES[0]}"><title>${esc(`${b.label}: ${yf(b.value)}`)}</title></path>`,
    );
    parts.push(`<text x="${cx}" y="${y - 6}" font-size="11" text-anchor="middle" fill="${INK}">${esc(yf(b.value))}</text>`);
    parts.push(`<text x="${cx}" y="${m.top + ih + 18}" font-size="11" text-anchor="middle" fill="${INK_2}">${esc(fit(b.label, 11))}</text>`);
    if (b.note) parts.push(`<text x="${cx}" y="${m.top + ih + 34}" font-size="10" text-anchor="middle" fill="${INK_2}">${esc(fit(b.note, 10))}</text>`);
  });
  parts.push(`<line x1="${m.left}" x2="${m.left + iw}" y1="${m.top + ih}" y2="${m.top + ih}" stroke="${INK_2}" stroke-width="1"/>`);
  parts.push(`<text transform="translate(14 ${m.top + ih / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${INK_2}">${esc(spec.yLabel)}</text>`);
  parts.push("</svg>");
  return parts.join("\n");
}
