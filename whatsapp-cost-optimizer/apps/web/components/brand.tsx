import { cx } from "./ui";

/** Product mark: a statement slip with a torn edge and one highlighted line (the money not spent). */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M8.5 3h15A2.5 2.5 0 0 1 26 5.5V29l-3.3-2.6-3.4 2.6-3.3-2.6-3.3 2.6-3.4-2.6L6 29V5.5A2.5 2.5 0 0 1 8.5 3z" fill="var(--accent)" />
      <rect x="10" y="8" width="12" height="2" rx="1" fill="var(--accent-ink)" opacity=".55" />
      <rect x="10" y="12.5" width="8" height="2" rx="1" fill="var(--accent-ink)" opacity=".55" />
      <rect x="9.5" y="17" width="13" height="4.5" rx="1.4" fill="var(--marker)" />
    </svg>
  );
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark className={compact ? "size-8" : "size-10"} />
      <span className="leading-none">
        <span className={cx("block font-display font-bold tracking-tight text-ink", compact ? "text-[19px]" : "text-2xl")}>WCO</span>
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-muted">WhatsApp Cost Optimizer</span>
      </span>
    </span>
  );
}

/** Product mark used on the public pages (login, signup). */
export function Brand() {
  return (
    <div className="mb-7">
      <Wordmark />
    </div>
  );
}

const SAMPLE: Array<[string, string]> = [
  ["Duplicadas barradas", "R$ 148,20"],
  ["Substituídas pela mais recente", "R$ 96,40"],
  ["Juntadas em uma só", "R$ 71,05"],
  ["Enviadas na janela grátis", "R$ 39,90"],
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
            Veja, linha por linha, o que você <span className="marker">deixou de pagar</span> no WhatsApp.
          </p>
          <div className="receipt-slot mt-9">
            <div className="receipt receipt-print px-5 pt-5 [color-scheme:light]" style={{ ["--receipt" as string]: "#fffefb", ["--ink-1" as string]: "#14201b", ["--ink-2" as string]: "#44514b", ["--ink-muted" as string]: "#5f6a64", ["--rule" as string]: "rgba(20,32,27,.28)" }}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Extrato · exemplo ilustrativo</p>
              <p className="perf-b pb-3 font-display text-lg font-semibold text-ink">O que o WCO evitou</p>
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
              <p className="mt-2 text-[11px] leading-snug text-muted">Valores de exemplo. No seu painel, cada linha vem das suas mensagens e separa o que é estimado do que a Meta já confirmou.</p>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
