const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/**
 * Product mark: a statement printing out of a slot, with its total highlighted. Fixed brand colors
 * (it is a badge, so it reads the same on light and dark surfaces).
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="12" fill="#0e5a45" />
      <path d="M12.5 13h23v25.6l-2.3-2.3-2.3 2.3-2.3-2.3-2.3 2.3-2.3-2.3-2.3 2.3-2.3-2.3-2.3 2.3-2.3-2.3-2.3 2.3z" fill="#fffdf6" />
      <path d="M12.5 13h23v3.4h-23z" fill="#14201b" opacity=".14" />
      <rect x="8" y="10.4" width="32" height="3.6" rx="1.8" fill="#062a20" />
      <rect x="16" y="18.6" width="9.5" height="1.9" rx=".95" fill="#14201b" opacity=".8" />
      <rect x="28.5" y="18.6" width="3.5" height="1.9" rx=".95" fill="#14201b" opacity=".8" />
      <rect x="16" y="22.6" width="6.5" height="1.9" rx=".95" fill="#14201b" opacity=".45" />
      <rect x="27" y="22.6" width="5" height="1.9" rx=".95" fill="#14201b" opacity=".45" />
      <path d="M16 27.3h16" stroke="#14201b" strokeOpacity=".5" strokeWidth="1" strokeDasharray="1.6 1.4" />
      <rect x="15.2" y="29.6" width="17.6" height="5" rx="1.5" fill="#dcf45b" />
      <rect x="24.6" y="31.15" width="6.4" height="1.9" rx=".95" fill="#14201b" />
    </svg>
  );
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark className={compact ? "size-9" : "size-11"} />
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
    <a href="/inicio" className="mb-7 inline-block" aria-label="WCO, página inicial">
      <Wordmark />
    </a>
  );
}

const SAMPLE: Array<[string, string]> = [
  ["Avisos de pedido", "R$ 148,20"],
  ["Pagamento e cobrança", "R$ 96,40"],
  ["Entrega e rastreio", "R$ 71,05"],
  ["Pós-venda", "R$ 39,90"],
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
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Extrato · exemplo ilustrativo</p>
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
              <p className="mt-2 text-[11px] leading-snug text-muted">Valores de exemplo. No seu painel, cada linha vem da sua operação e separa o que é estimado do que a Meta já confirmou.</p>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
