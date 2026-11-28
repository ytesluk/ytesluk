
/**
 * The WCO logo: a printed statement (rounded top, torn bottom) with two lines of text and its total
 * highlighted, over a dark tile. Vector, so it is sharp at any size. Same geometry in app/icon.svg,
 * public/brand/* and the 3D textures (components/landing/three/textures.ts).
 */
export const MARK = {
  tile: "#14201b",
  paper: "#f2f4ef",
  ink: "#14201b",
  lime: "#dcf45b",
  /** 48-unit box. */
  receipt: "M14.4 9.8a1.8 1.8 0 0 1 1.8-1.8h15.6a1.8 1.8 0 0 1 1.8 1.8v27.5l-1.92 2.7-1.92-2.7-1.92 2.7-1.92-2.7-1.92 2.7-1.92-2.7-1.92 2.7-1.92-2.7-1.92 2.7-1.92-2.7z",
  bars: [
    { x: 18.2, y: 13.8, w: 10.6, h: 2.4, fill: "ink" },
    { x: 18.2, y: 18.8, w: 7, h: 2.3, fill: "ink" },
    { x: 18.2, y: 26.8, w: 12.8, h: 3.2, fill: "lime" },
  ],
} as const;

/** "WCO" as strokes (geometric, even weight), in a 0–133 × 0–40 box. */
export const LETTERS = {
  w: "M3.5 4 15 35.5 26 9 37 35.5 48.5 4",
  c: "M89.3 8.7A15.5 15.5 0 1 0 89.3 31.3",
  o: { cx: 113.5, cy: 20, r: 15.5 },
  stroke: 7,
  width: 133,
};

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="12" fill={MARK.tile} />
      <path d={MARK.receipt} fill={MARK.paper} />
      {MARK.bars.map((b) => (
        <rect key={b.y} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} fill={MARK[b.fill]} />
      ))}
    </svg>
  );
}

/** The word "WCO" drawn in the logo's letters; takes the text colour. */
export function LogoType({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${LETTERS.width} 40`} className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={LETTERS.stroke}>
      <path d={LETTERS.w} strokeLinejoin="miter" strokeMiterlimit={2} />
      <path d={LETTERS.c} />
      <circle cx={LETTERS.o.cx} cy={LETTERS.o.cy} r={LETTERS.o.r} />
    </svg>
  );
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-ink" role="img" aria-label="WCO">
      <Mark className={compact ? "size-9" : "size-11"} />
      <LogoType className={compact ? "h-[17px] w-auto" : "h-5 w-auto"} />
    </span>
  );
}

/** Product mark used on the public pages (login, signup). */
export function Brand() {
  return (
    <a href="/inicio" className="mb-7 inline-block" aria-label="WCO, página inicial">
      <Wordmark />
    </a>
  );
}

const SAMPLE: Array<[string, string]> = [
  ["Motor de economia 1", "R$ 148,20"],
  ["Motor de economia 2", "R$ 96,40"],
  ["Motor de economia 3", "R$ 71,05"],
  ["Motor de economia 4", "R$ 39,90"],
];

/** Public pages: the form on the left, an illustrative statement on the right (sample figures, labelled as such). */
export function AuthFrame({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Brand />
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          <p className="mb-6 mt-1.5 text-sm leading-relaxed text-ink-2">{lead}</p>
          {children}
        </div>
      </div>
      <aside className="relative hidden items-center justify-center overflow-hidden bg-[#14201b] px-10 lg:flex" aria-label="Exemplo ilustrativo do extrato do WCO">
        <div className="w-full max-w-[360px]">
          <p className="font-display text-[34px] font-semibold leading-[1.08] tracking-tight text-[#f1f4ee]">
            Veja, real por real, quanto da fatura do WhatsApp <span className="marker">ficou no seu caixa.</span>
          </p>
          <div className="receipt-slot mt-9">
            <div className="receipt receipt-print px-5 pt-5 [color-scheme:light]" style={{ ["--receipt" as string]: "#fffefb", ["--ink-1" as string]: "#14201b", ["--ink-2" as string]: "#44514b", ["--ink-muted" as string]: "#5f6a64", ["--rule" as string]: "rgba(20,32,27,.28)" }}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Extrato do mês</p>
              <p className="perf-b pb-3 font-display text-lg font-semibold text-ink">Sua economia no mês</p>
              <div className="perf-b py-2.5">
                {SAMPLE.map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2 py-1 text-[12.5px] text-ink-2">
                    <span>{k}</span>
                    <span className="mb-1 flex-1 border-b border-dotted border-rule" aria-hidden />
                    <span className="figure text-ink">{v}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline justify-between gap-2 pt-3 text-[13px] font-semibold text-ink">
                <span>Você deixou de pagar</span>
                <span className="figure text-base">
                  <span className="marker">R$ 355,55</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
