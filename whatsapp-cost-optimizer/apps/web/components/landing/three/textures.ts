import * as THREE from "three";

/** Brand palette, as used by the 3D scenes (fixed: the product page is always "on paper"). */
export const C = {
  ink: "#14201b",
  deep: "#062a20",
  green: "#0e5a45",
  greenHi: "#1a7a5e",
  paper: "#fffdf6",
  lime: "#dcf45b",
  ink2: "#44514b",
  muted: "#5f6a64",
  rule: "rgba(20,32,27,.34)",
};

const FONT = {
  display: '"Bricolage Grotesque Variable", system-ui, sans-serif',
  sans: '"Instrument Sans Variable", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

type G = CanvasRenderingContext2D;

/** Web fonts must be ready before text is drawn into a texture (otherwise the fallback face is baked in). */
export async function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`600 32px ${FONT.display}`),
    document.fonts.load(`500 16px ${FONT.sans}`),
    document.fonts.load(`600 16px ${FONT.sans}`),
    document.fonts.load(`500 16px ${FONT.mono}`),
    document.fonts.load(`600 16px ${FONT.mono}`),
  ]).catch(() => undefined);
}

function texture(w: number, h: number, draw: (g: G, w: number, h: number) => void, maxAnisotropy = 8): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  return t;
}

const spacing = (g: G, px: number) => {
  (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
};

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Cuts the torn (zigzag) edge out of the bottom of a paper texture. */
function tornBottom(g: G, w: number, h: number, teeth: number, depth: number) {
  g.save();
  g.globalCompositeOperation = "destination-out";
  const tw = w / teeth;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    g.moveTo(i * tw, h + 1);
    g.lineTo((i + 0.5) * tw, h - depth);
    g.lineTo((i + 1) * tw, h + 1);
    g.closePath();
  }
  g.fill();
  g.restore();
}

const TEETH = 17;

/**
 * The statement printed on the paper. Design space is 420 px wide (the same slip the dashboard
 * shows); every figure is illustrative and the slip says so in its first line.
 */
export function receiptTexture(aspect: number, maxAnisotropy: number): THREE.CanvasTexture {
  const W = 840;
  const H = Math.round(W * aspect);
  return texture(
    W,
    H,
    (g) => {
      const s = W / 420;
      const px = (n: number) => n * s;
      const L = px(28);
      const R = W - px(28);
      g.fillStyle = C.paper;
      g.fillRect(0, 0, W, H);

      const caps = (text: string, y: number, color = C.muted) => {
        g.font = `500 ${px(10)}px ${FONT.mono}`;
        spacing(g, px(1.7));
        g.fillStyle = color;
        g.textAlign = "left";
        g.fillText(text, L, y);
        spacing(g, 0);
      };
      const rule = (y: number) => {
        g.save();
        g.strokeStyle = C.rule;
        g.lineWidth = px(1);
        g.setLineDash([px(4), px(3.5)]);
        g.beginPath();
        g.moveTo(L, y);
        g.lineTo(R, y);
        g.stroke();
        g.restore();
      };
      const line = (label: string, value: string, y: number, strong = false) => {
        g.textAlign = "left";
        g.font = `${strong ? 600 : 500} ${px(strong ? 14.5 : 13.5)}px ${FONT.sans}`;
        g.fillStyle = strong ? C.ink : C.ink2;
        g.fillText(label, L, y);
        const lw = g.measureText(label).width;
        g.font = `${strong ? 600 : 500} ${px(13.5)}px ${FONT.mono}`;
        g.fillStyle = C.ink;
        g.textAlign = "right";
        g.fillText(value, R, y);
        const vw = g.measureText(value).width;
        g.save();
        g.strokeStyle = C.rule;
        g.lineWidth = px(1);
        g.setLineDash([px(1.2), px(3.4)]);
        g.beginPath();
        g.moveTo(L + lw + px(8), y - px(1));
        g.lineTo(R - vw - px(8), y - px(1));
        g.stroke();
        g.restore();
      };

      // The first line starts below the bend where the paper leaves the machine, so it stays readable.
      let y = px(74);
      caps("EXTRATO · EXEMPLO ILUSTRATIVO", y);
      y += px(34);
      g.font = `600 ${px(24)}px ${FONT.display}`;
      g.fillStyle = C.ink;
      g.textAlign = "left";
      g.fillText("O que o WCO evitou", L, y);
      y += px(22);
      rule(y);

      y += px(28);
      caps("COBRANÇA DA META", y);
      y += px(28);
      for (const [k, v] of [
        ["Duplicadas barradas", "R$ 148,20"],
        ["Substituídas pela mais recente", "R$ 96,40"],
        ["Juntadas em uma só mensagem", "R$ 71,05"],
        ["Enviadas em janela grátis", "R$ 39,90"],
      ] as const) {
        line(k, v, y);
        y += px(29);
      }
      y -= px(8);
      rule(y);

      // The one highlighted line: money that was not spent.
      y += px(40);
      g.font = `600 ${px(15)}px ${FONT.sans}`;
      g.fillStyle = C.ink;
      g.textAlign = "left";
      g.fillText("Você deixou de pagar", L, y);
      g.font = `600 ${px(19)}px ${FONT.mono}`;
      const total = "R$ 355,55";
      const tw = g.measureText(total).width;
      g.fillStyle = C.lime;
      roundRect(g, R - tw - px(12), y - px(22), tw + px(18), px(31), px(6));
      g.fill();
      g.fillStyle = C.ink;
      g.textAlign = "right";
      g.fillText(total, R - px(3), y);
      y += px(30);
      rule(y);

      // Estimate (dashed) vs confirmed by Meta (solid): the same rule the dashboard follows.
      y += px(30);
      const pill = (text: string, x: number, yy: number, solid: boolean) => {
        g.font = `500 ${px(9.5)}px ${FONT.mono}`;
        spacing(g, px(0.8));
        const w = g.measureText(text).width + px(16);
        roundRect(g, x, yy - px(13), w, px(19), px(9.5));
        if (solid) {
          g.fillStyle = C.green;
          g.fill();
        } else {
          g.save();
          g.strokeStyle = C.rule;
          g.lineWidth = px(1.2);
          g.setLineDash([px(3), px(2.5)]);
          g.stroke();
          g.restore();
        }
        g.fillStyle = solid ? "#ffffff" : C.ink2;
        g.textAlign = "left";
        g.fillText(text, x + px(8), yy);
        spacing(g, 0);
        return w;
      };
      const row = (label: string, tag: string, solid: boolean, value: string, yy: number) => {
        g.font = `500 ${px(13.5)}px ${FONT.sans}`;
        g.fillStyle = C.ink2;
        g.textAlign = "left";
        g.fillText(label, L, yy);
        const lw = g.measureText(label).width;
        pill(tag, L + lw + px(8), yy - px(1), solid);
        g.font = `500 ${px(13.5)}px ${FONT.mono}`;
        g.fillStyle = C.ink;
        g.textAlign = "right";
        g.fillText(value, R, yy);
      };
      row("Conta do WCO", "ESTIMADO", false, "R$ 355,55", y);
      y += px(30);
      row("Confirmado pela Meta", "REALIZADO", true, "R$ 212,40", y);
      y += px(24);
      rule(y);

      // Where the events went.
      y += px(30);
      caps("DE CADA 100 AVISOS", y);
      y += px(18);
      const barW = R - L;
      g.fillStyle = C.ink;
      roundRect(g, L, y, barW * 0.78 - px(2), px(11), px(3));
      g.fill();
      g.fillStyle = C.lime;
      roundRect(g, L + barW * 0.78, y, barW * 0.22, px(11), px(3));
      g.fill();
      y += px(32);
      g.font = `500 ${px(12.5)}px ${FONT.sans}`;
      g.fillStyle = C.ink2;
      g.textAlign = "left";
      g.fillText("78 viraram mensagem", L, y);
      g.textAlign = "right";
      g.fillText("22 você não pagou", R, y);
      y += px(22);
      rule(y);

      // Footer: a barcode-like strip and the brand.
      y += px(26);
      g.fillStyle = C.ink;
      let x = L;
      let i = 0;
      while (x < R - px(4)) {
        const w = px([1.2, 2.6, 1.2, 4, 1.2, 1.2, 2.6][i % 7] ?? 1.2);
        g.fillRect(x, y, w, px(34));
        x += w + px([2.2, 1.4, 3, 1.4][i % 4] ?? 2);
        i++;
      }
      y += px(56);
      g.textAlign = "center";
      g.font = `600 ${px(15)}px ${FONT.display}`;
      g.fillStyle = C.ink;
      g.fillText("WCO", W / 2, y);
      y += px(16);
      g.font = `500 ${px(9)}px ${FONT.mono}`;
      spacing(g, px(1.5));
      g.fillStyle = C.muted;
      g.fillText("WHATSAPP COST OPTIMIZER", W / 2, y);
      spacing(g, 0);

      tornBottom(g, W, H, TEETH, px(13));
    },
    maxAnisotropy,
  );
}

/** Blank back of the paper, with the same torn edge. */
export function paperBackTexture(aspect: number): THREE.CanvasTexture {
  const W = 256;
  const H = Math.round(W * aspect);
  return texture(W, H, (g) => {
    g.fillStyle = "#f3efe2";
    g.fillRect(0, 0, W, H);
    tornBottom(g, W, H, TEETH, (W / 420) * 13);
  });
}

/** Wordmark printed on the front of the machine. */
export function decalTexture(): THREE.CanvasTexture {
  return texture(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#f4f1e6";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = `700 92px ${FONT.display}`;
    g.fillText("WCO", 8, h / 2 + 4);
  });
}

function bubblePath(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.lineTo(x + r * 1.9, y + h);
  g.lineTo(x + r * 0.2, y + h + r * 0.95);
  g.lineTo(x, y + h - r * 0.9);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * A message that never had to be sent: only a dashed outline (the same "dashed = not real money"
 * convention as the estimate tags), with the reason underneath.
 */
export function ghostBubbleTexture(caption: string): THREE.CanvasTexture {
  return texture(640, 500, (g, w) => {
    const bx = 40;
    const by = 36;
    const bw = w - 80;
    const bh = 270;
    bubblePath(g, bx, by, bw, bh, 66);
    g.fillStyle = "rgba(220,244,91,.08)";
    g.fill();
    g.strokeStyle = C.lime;
    g.lineWidth = 7;
    g.lineJoin = "round";
    g.setLineDash([24, 17]);
    g.stroke();
    g.setLineDash([20, 15]);
    g.lineCap = "round";
    g.lineWidth = 12;
    g.strokeStyle = "rgba(220,244,91,.5)";
    for (const [x1, yy] of [
      [bx + bw - 90, by + 100],
      [bx + bw - 210, by + 164],
    ] as const) {
      g.beginPath();
      g.moveTo(bx + 76, yy);
      g.lineTo(x1, yy);
      g.stroke();
    }
    g.setLineDash([]);
    g.font = `500 38px ${FONT.mono}`;
    spacing(g, 7);
    g.fillStyle = C.lime;
    g.textAlign = "center";
    g.fillText(caption, w / 2 + 3, by + bh + 132);
    spacing(g, 0);
  });
}

/** Small slip used by the closing scene (falling receipts). */
export function slipTexture(): THREE.CanvasTexture {
  return texture(160, 208, (g, w, h) => {
    g.fillStyle = C.paper;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(20,32,27,.55)";
    roundRect(g, 22, 30, 74, 11, 5);
    g.fill();
    g.fillStyle = "rgba(20,32,27,.32)";
    roundRect(g, 22, 58, 52, 11, 5);
    g.fill();
    roundRect(g, 22, 86, 88, 11, 5);
    g.fill();
    g.fillStyle = C.lime;
    roundRect(g, 20, 122, 120, 34, 8);
    g.fill();
    tornBottom(g, w, h, 8, 13);
  });
}
