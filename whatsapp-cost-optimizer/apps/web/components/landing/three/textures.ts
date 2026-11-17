import * as THREE from "three";
import { FONT } from "./fonts";

/** Brand palette, as used by the 3D scenes (fixed: the product page is always "on paper"). */
export const C = {
  ink: "#14201b",
  lime: "#dcf45b",
  /** Thermal paper: a cool off-white, never pure white. */
  paper: "#f6f4ee",
  paperBack: "#eeece5",
  /** Thermal print: a soft black, slightly brown-grey like a real head burns it. */
  print: "rgba(24,23,26,0.9)",
};

type G = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, G] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as G];
}

function asTexture(c: HTMLCanvasElement, opts: { srgb?: boolean; anisotropy?: number; repeat?: [number, number] } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.anisotropy ?? 8;
  if (opts.repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return t;
}

/** Deterministic pseudo-random numbers: the same surfaces on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const spacing = (g: G, px: number) => {
  (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
};

/** Turns a tiling height field into a tangent-space normal map. */
function normalMap(height: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)] as number;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function blur(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[((y + j + h) % h) * w + ((x + i + w) % w)] as number;
        b[y * w + x] = s / 9;
      }
    }
    a = b;
  }
  return a;
}

/** Fine moulded-plastic grain (the texture ABS shells have straight out of the tool). */
export function plasticGrainNormal(): THREE.CanvasTexture {
  const n = 256;
  const r = rng(7);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = r();
  return asTexture(normalMap(blur(h, n, n, 1), n, n, 2.4), { srgb: false, repeat: [9, 9] });
}

/** Paper surface: fibres plus the faint cross ripples a roll leaves. */
export function paperNormal(): THREE.CanvasTexture {
  const w = 256;
  const hh = 512;
  const r = rng(19);
  const fine = new Float32Array(w * hh);
  for (let i = 0; i < fine.length; i++) fine[i] = r();
  const soft = blur(fine, w, hh, 2);
  const out = new Float32Array(w * hh);
  for (let y = 0; y < hh; y++) {
    const ripple = Math.sin((y / hh) * Math.PI * 2 * 7) * 0.22 + Math.sin((y / hh) * Math.PI * 2 * 3 + 1.3) * 0.3;
    for (let x = 0; x < w; x++) out[y * w + x] = (soft[y * w + x] as number) * 1.4 + (fine[y * w + x] as number) * 0.25 + ripple;
  }
  return asTexture(normalMap(out, w, hh, 1.1), { srgb: false, repeat: [1, 1] });
}

/** Faint fingerprints and wipe marks for glossy parts (roughness: brighter = duller). */
export function smudgeRoughness(): THREE.CanvasTexture {
  const n = 256;
  const [c, g] = canvas(n, n);
  g.fillStyle = "#121212"; // the clean surface is almost a mirror
  g.fillRect(0, 0, n, n);
  const r = rng(41);
  for (let i = 0; i < 26; i++) {
    const x = r() * n;
    const y = r() * n;
    const rad = 18 + r() * 46;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(255,255,255,${0.03 + r() * 0.05})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalAlpha = 0.022;
  g.strokeStyle = "#fff";
  for (let i = 0; i < 24; i++) {
    g.lineWidth = 1 + r() * 5;
    g.beginPath();
    const y = r() * n;
    g.moveTo(-10, y);
    g.bezierCurveTo(n * 0.3, y + (r() - 0.5) * 40, n * 0.7, y + (r() - 0.5) * 40, n + 10, y + (r() - 0.5) * 30);
    g.stroke();
  }
  return asTexture(c, { srgb: false, repeat: [1, 1] });
}

// ---- the printed statement ------------------------------------------------------------------

export interface ReceiptData {
  account: string;
  period: string;
  issued: string;
  lines: ReadonlyArray<readonly [string, string]>;
  total: string;
  confirmed: string;
  /** Out of 100 events, how many became a message. */
  sent: number;
}

/** Illustrative statements (the slip itself says so). Each total is the sum of its four lines. */
export const RECEIPTS: ReadonlyArray<ReceiptData> = [
  {
    account: "LOJA EXEMPLO",
    period: "01/10/2026 A 31/10/2026",
    issued: "01/11/2026 09:41",
    lines: [
      ["DUPLICADAS BARRADAS", "R$ 148,20"],
      ["SUBSTITUÍDAS PELA MAIS RECENTE", "R$ 96,40"],
      ["JUNTADAS EM UMA SÓ MENSAGEM", "R$ 71,05"],
      ["ENVIADAS EM JANELA GRÁTIS", "R$ 39,90"],
    ],
    total: "R$ 355,55",
    confirmed: "R$ 212,40",
    sent: 78,
  },
  {
    account: "MERCADO EXEMPLO",
    period: "01/10/2026 A 31/10/2026",
    issued: "01/11/2026 09:42",
    lines: [
      ["DUPLICADAS BARRADAS", "R$ 312,80"],
      ["SUBSTITUÍDAS PELA MAIS RECENTE", "R$ 188,10"],
      ["JUNTADAS EM UMA SÓ MENSAGEM", "R$ 97,45"],
      ["ENVIADAS EM JANELA GRÁTIS", "R$ 64,00"],
    ],
    total: "R$ 662,35",
    confirmed: "R$ 401,90",
    sent: 74,
  },
  {
    account: "CLÍNICA EXEMPLO",
    period: "01/10/2026 A 31/10/2026",
    issued: "01/11/2026 09:43",
    lines: [
      ["DUPLICADAS BARRADAS", "R$ 58,60"],
      ["SUBSTITUÍDAS PELA MAIS RECENTE", "R$ 41,20"],
      ["JUNTADAS EM UMA SÓ MENSAGEM", "R$ 22,35"],
      ["ENVIADAS EM JANELA GRÁTIS", "R$ 9,80"],
    ],
    total: "R$ 131,95",
    confirmed: "R$ 88,10",
    sent: 83,
  },
];

/** 80 mm paper at 203 dpi: 640 dots across, 576 printable = 48 columns of a 12-dot font. */
const DOTS = 640;
const MARGIN = 32;
const COLS = 48;
const LH = 34;

/** Fine saw-tooth left by the tear bar, on both ends of the strip. */
function sawEdges(g: G, w: number, h: number, depth: number) {
  g.save();
  g.globalCompositeOperation = "destination-out";
  const teeth = 54;
  const tw = w / teeth;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    g.moveTo(i * tw, h + 1);
    g.lineTo((i + 0.5) * tw, h - depth);
    g.lineTo((i + 1) * tw, h + 1);
    g.closePath();
    g.moveTo(i * tw, -1);
    g.lineTo((i + 0.5) * tw, depth);
    g.lineTo((i + 1) * tw, -1);
    g.closePath();
  }
  g.fill();
  g.restore();
}

/**
 * Draws a statement the way a thermal printer does: one monospaced face on a 48-column grid, black
 * only. The single colour on it is a highlighter stroke over the total, as if someone marked it
 * by hand. `short` draws the cut-down slip used by the falling statements.
 */
function drawReceipt(data: ReceiptData, W: number, H: number, short: boolean): HTMLCanvasElement {
  const s = W / DOTS;
  const [ink, g] = canvas(W, H);
  g.fillStyle = "#000";
  g.textBaseline = "alphabetic";

  const put = (str: string, col: number, y: number, o: { bold?: boolean; size?: number } = {}) => {
    const size = o.size ?? 1;
    g.font = `${o.bold ? 600 : 500} ${20 * size * s}px ${FONT.mono}`;
    g.textAlign = "left";
    g.fillText(str, (MARGIN + col * 12) * s, y * s);
  };
  const right = (str: string, y: number, o: { bold?: boolean; size?: number } = {}) => put(str, COLS - str.length * (o.size ?? 1), y, o);
  const center = (str: string, y: number, o: { bold?: boolean; size?: number } = {}) => put(str, (COLS - str.length * (o.size ?? 1)) / 2, y, o);
  const pair = (l: string, r: string, y: number, o: { bold?: boolean } = {}) => {
    put(l, 0, y, o);
    right(r, y, o);
  };
  const rule = (y: number) => put("-".repeat(COLS), 0, y);

  let y = short ? 54 : 84;
  center("WCO", y + 26, { bold: true, size: 2 });
  y += 64;
  center("WHATSAPP COST OPTIMIZER", y);
  y += LH;
  center("EXTRATO DE ECONOMIA", y, { bold: true });
  y += LH;
  center("*** EXEMPLO ILUSTRATIVO ***", y);
  y += LH;
  rule(y);
  y += LH;
  pair("CONTA", data.account, y);
  y += LH;
  if (!short) {
    pair("PERÍODO", data.period, y);
    y += LH;
    pair("EMISSÃO", data.issued, y);
    y += LH;
  }
  rule(y);
  y += LH;
  put("COBRANÇA DA META EVITADA", 0, y, { bold: true });
  y += LH;
  for (const [l, r] of data.lines) {
    pair(l, r, y);
    y += LH;
  }
  rule(y);
  y += LH + 10;
  put("VOCÊ DEIXOU DE PAGAR", 0, y, { bold: true });
  y += 62;
  const totalY = y;
  right(data.total, y, { bold: true, size: 2 });
  y += 44;
  rule(y);
  y += LH;
  if (!short) {
    pair("CONTA DO WCO (ESTIMADO)", data.total, y);
    y += LH;
    pair("CONFIRMADO PELA META (REALIZADO)", data.confirmed, y);
    y += LH;
    put("OS DOIS VALORES NUNCA SÃO SOMADOS.", 0, y);
    y += LH;
    rule(y);
    y += LH;
    put("DE CADA 100 AVISOS RECEBIDOS", 0, y, { bold: true });
    y += 16;
    // A bar printed the thermal way: solid blocks for what was sent, a hatch for what was not charged.
    const bw = (DOTS - MARGIN * 2) * s;
    const bx = MARGIN * s;
    const split = (bw * data.sent) / 100;
    g.fillRect(bx, y * s, split - 3 * s, 24 * s);
    for (let x = bx + split; x < bx + bw; x += 6 * s) g.fillRect(x, y * s, 2.4 * s, 24 * s);
    y += 24 + LH;
    pair(`${data.sent} VIRARAM MENSAGEM`, `${100 - data.sent} NÃO FORAM COBRADAS`, y);
    y += LH;
    rule(y);
    y += LH - 8;
  }
  // Barcode: bars from a fixed pattern.
  const r = rng(Math.round(data.sent * 97));
  let x = MARGIN + 40;
  while (x < DOTS - MARGIN - 40) {
    const w = 2 + Math.floor(r() * 3) * 2;
    g.fillRect(x * s, y * s, w * s, (short ? 48 : 66) * s);
    x += w + 2 + Math.floor(r() * 3) * 2;
  }
  y += (short ? 48 : 66) + LH - 4;
  center("0000 4812 0355 5520 2611", y);
  y += LH;
  if (!short) {
    center("VALORES DE EXEMPLO, SEM VALOR FISCAL", y);
    y += LH;
    center("OBRIGADO!", y, { bold: true });
  }

  // What a worn print head does: a few columns print lighter.
  g.globalCompositeOperation = "destination-out";
  const fade = rng(data.sent);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(0,0,0,${0.12 + fade() * 0.2})`;
    g.fillRect((MARGIN + fade() * (DOTS - MARGIN * 2)) * s, 0, (1 + fade() * 2.2) * s, H);
  }
  g.globalCompositeOperation = "source-over";

  // Paper, then the ink (soft edges, soft black), then the highlighter on top of it.
  const [out, p] = canvas(W, H);
  p.fillStyle = C.paper;
  p.fillRect(0, 0, W, H);
  const [tile, tg] = canvas(96, 96);
  const speck = rng(5);
  const img = tg.createImageData(96, 96);
  for (let i = 0; i < 96 * 96; i++) {
    const v = 232 + speck() * 23;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v - 3;
    img.data[i * 4 + 3] = 255;
  }
  tg.putImageData(img, 0, 0);
  const pattern = p.createPattern(tile, "repeat");
  if (pattern) {
    p.globalAlpha = 0.16;
    p.globalCompositeOperation = "multiply";
    p.fillStyle = pattern;
    p.fillRect(0, 0, W, H);
    p.globalAlpha = 1;
    p.globalCompositeOperation = "source-over";
  }
  p.globalAlpha = 0.9;
  p.filter = `blur(${(0.45 * s).toFixed(2)}px)`;
  p.drawImage(ink, 0, 0);
  p.filter = "none";
  p.globalAlpha = 1;

  // Highlighter: two uneven passes of a chisel tip, slightly off the horizontal, over the total.
  p.globalCompositeOperation = "multiply";
  const hl = rng(data.sent * 3);
  const x0 = (DOTS - MARGIN - data.total.length * 24 - 22) * s;
  const x1 = (DOTS - MARGIN + 12) * s;
  const stroke = (top: number, bottom: number, alpha: number, slope: number) => {
    p.fillStyle = `rgba(214,240,74,${alpha})`;
    p.beginPath();
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const xx = x0 + (x1 - x0) * t;
      const yy = (top + slope * t + (hl() - 0.5) * 2.2) * s;
      if (i === 0) p.moveTo(xx - 4 * s, yy + 3 * s);
      p.lineTo(xx, yy);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      p.lineTo(x0 + (x1 - x0) * t + (i === steps ? 5 * s : 0), (bottom + slope * t + (hl() - 0.5) * 2.2) * s);
    }
    p.closePath();
    p.fill();
  };
  stroke(totalY - 40, totalY + 9, 0.78, -3);
  stroke(totalY - 34, totalY + 13, 0.4, -1.5);
  p.globalCompositeOperation = "source-over";

  sawEdges(p, W, H, 5 * s);
  return out;
}

/** Height of the full statement relative to its width (paper length / paper width). */
export const RECEIPT_ASPECT = 1400 / DOTS;
/** Where the highlighted total sits, as a fraction of the statement's height from its top. */
export const RECEIPT_TOTAL_AT = 696 / 1400;
export const SLIP_ASPECT = 900 / DOTS;

export function receiptTextures(data: ReceiptData, width: number, anisotropy: number): { front: THREE.CanvasTexture; back: THREE.CanvasTexture } {
  const H = Math.round(width * RECEIPT_ASPECT);
  const front = drawReceipt(data, width, H, false);
  // Thermal paper is thin: the print shows through, faint and mirrored, on the back.
  const bw = Math.round(width / 2);
  const bh = Math.round(H / 2);
  const [back, g] = canvas(bw, bh);
  g.fillStyle = C.paperBack;
  g.fillRect(0, 0, bw, bh);
  g.globalAlpha = 0.085;
  g.translate(bw, 0);
  g.scale(-1, 1);
  g.drawImage(front, 0, 0, bw, bh);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  sawEdges(g, bw, bh, 2.5 * (bw / DOTS));
  return { front: asTexture(front, { anisotropy }), back: asTexture(back, { anisotropy: 4 }) };
}

/** Short slips for the closing scene: all three statements side by side in one atlas. */
export function slipAtlas(width: number): { texture: THREE.CanvasTexture; count: number } {
  const H = Math.round(width * SLIP_ASPECT);
  const [c, g] = canvas(width * RECEIPTS.length, H);
  RECEIPTS.forEach((d, i) => g.drawImage(drawReceipt(d, width, H, true), i * width, 0));
  return { texture: asTexture(c, { anisotropy: 4 }), count: RECEIPTS.length };
}

// ---- things printed on the machine ----------------------------------------------------------

/** Pad-printed legends of the control strip (transparent background). */
export function controlsTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = "rgba(226,232,226,.78)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `500 26px ${FONT.mono}`;
  spacing(g, 3);
  // x positions match the LEDs and the button placed in printer.ts (strip is 1.9 units wide).
  for (const [label, x] of [
    ["POWER", 0.105],
    ["ERROR", 0.21],
    ["PAPER", 0.315],
  ] as const)
    g.fillText(label, x * 1024, 186);
  g.fillText("FEED", 0.826 * 1024, 208);
  spacing(g, 0);
  return asTexture(c);
}

/** Brand mark on the side of the shell. */
export function logoTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 200);
  g.fillStyle = "rgba(232,236,230,.9)";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.font = `700 112px ${FONT.display}`;
  g.fillText("WCO", 6, 118);
  g.font = `500 25px ${FONT.mono}`;
  spacing(g, 5);
  g.fillStyle = "rgba(232,236,230,.6)";
  g.fillText("COST OPTIMIZER", 10, 170);
  spacing(g, 0);
  return asTexture(c);
}

/** Rating label on the back (fictional model; says so). */
export function ratingLabelTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#e9eae6";
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = "#16181a";
  g.textBaseline = "alphabetic";
  g.font = `700 44px ${FONT.display}`;
  g.fillText("WCO-80", 24, 62);
  g.font = `500 19px ${FONT.mono}`;
  g.fillText("IMPRESSORA TÉRMICA 80 MM", 24, 98);
  g.fillText("ENTRADA 24 V ⎓ 1,5 A", 24, 126);
  g.fillText("MODELO ILUSTRATIVO", 24, 154);
  const r = rng(11);
  let x = 24;
  while (x < 330) {
    const w = 2 + Math.floor(r() * 3) * 2;
    g.fillRect(x, 176, w, 52);
    x += w + 2 + Math.floor(r() * 3) * 2;
  }
  g.strokeStyle = "#16181a";
  g.lineWidth = 3;
  g.strokeRect(372, 150, 112, 78);
  g.font = `600 22px ${FONT.mono}`;
  g.fillText("EX-0001", 380, 196);
  return asTexture(c);
}

/** Soft halo around a lit LED. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,.55)");
  grad.addColorStop(0.55, "rgba(255,255,255,.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return asTexture(c);
}

/** What one of the floating messages says, and why it never had to be sent. */
export interface MessageSpec {
  /** The reason, stamped across it. */
  stamp: string;
  /** Small line above the text: what kind of notice it was. */
  label: string;
  /** The notice itself, in two short lines. */
  lines: readonly [string, string];
}

/** Face of a message bubble's box, tail zone included (the bubble's own outline crops it). */
export const MESSAGE_FACE = { w: 1024, h: 772, body: 0.82 };

/**
 * The face of a message that never had to be sent: dark glass, the notice written on it and
 * crossed out. The reason is stamped on top by a separate layer (see `stampTexture`).
 */
export function messageTexture(spec: MessageSpec, anisotropy: number): THREE.CanvasTexture {
  const { w, h } = MESSAGE_FACE;
  const [c, g] = canvas(w, h);
  const body = h * MESSAGE_FACE.body;
  const glass = g.createLinearGradient(0, 0, w * 0.35, h);
  glass.addColorStop(0, "#21473a");
  glass.addColorStop(0.55, "#17352a");
  glass.addColorStop(1, "#102720");
  g.fillStyle = glass;
  g.fillRect(0, 0, w, h);
  // A soft sheen across the top, as on a pane of glass.
  const sheen = g.createLinearGradient(0, 0, 0, body * 0.5);
  sheen.addColorStop(0, "rgba(255,255,255,.13)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, body * 0.5);

  const pad = 84;
  g.textBaseline = "alphabetic";
  g.font = `500 34px ${FONT.mono}`;
  spacing(g, 5);
  g.fillStyle = "rgba(196,210,200,.72)";
  g.textAlign = "left";
  g.fillText(spec.label, pad, 128);
  spacing(g, 0);
  // Sender dot, where a contact's picture would be.
  g.fillStyle = C.lime;
  g.beginPath();
  g.arc(w - pad - 14, 114, 15, 0, Math.PI * 2);
  g.fill();

  g.font = `600 78px ${FONT.display}`;
  g.fillStyle = "rgba(244,241,230,.5)";
  spec.lines.forEach((line, i) => {
    const y = 262 + i * 104;
    g.fillText(line, pad, y);
    // Crossed out: this one was not sent.
    const len = g.measureText(line).width;
    g.strokeStyle = "rgba(244,241,230,.82)";
    g.lineWidth = 7;
    g.lineCap = "round";
    g.setLineDash([26, 16]);
    g.beginPath();
    g.moveTo(pad - 10, y - 25);
    g.lineTo(pad + len + 10, y - 25);
    g.stroke();
    g.setLineDash([]);
  });
  return asTexture(c, { anisotropy });
}

/** The reason a message was not sent, as a rubber stamp: a slightly uneven frame and heavy letters. */
export function stampTexture(word: string, anisotropy: number): { texture: THREE.CanvasTexture; aspect: number } {
  const size = 96;
  const [probe, pg] = canvas(8, 8);
  pg.font = `600 ${size}px ${FONT.mono}`;
  const text = pg.measureText(word).width + (word.length - 1) * 9;
  probe.width = 0; // only needed for measuring
  const w = Math.ceil(text + 118);
  const h = 208;
  const [c, g] = canvas(w, h);
  g.strokeStyle = C.lime;
  g.fillStyle = "rgba(12,23,18,.72)";
  g.lineWidth = 11;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(38, 12);
  g.arcTo(w - 12, 12, w - 12, h - 12, 26);
  g.arcTo(w - 12, h - 12, 12, h - 12, 26);
  g.arcTo(12, h - 12, 12, 12, 26);
  g.arcTo(12, 12, w - 12, 12, 26);
  g.closePath();
  g.fill();
  g.stroke();
  g.font = `600 ${size}px ${FONT.mono}`;
  spacing(g, 9);
  g.fillStyle = C.lime;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(word, 59, h / 2 + 6);
  spacing(g, 0);
  // Worn rubber: the ink does not take everywhere.
  const r = rng(word.length * 131 + 7);
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 420; i++) {
    g.globalAlpha = 0.35 + r() * 0.5;
    g.beginPath();
    g.arc(r() * w, r() * h, 0.8 + r() * 2.4, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  return { texture: asTexture(c, { anisotropy }), aspect: w / h };
}
