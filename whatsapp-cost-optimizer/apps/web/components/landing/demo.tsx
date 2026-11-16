"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, RotateCcw, Zap } from "lucide-react";
import { cx } from "@/components/ui";
import { useCalmMotion } from "./motion";

type Verdict = "hold" | "replaced" | "duplicate" | "joined" | "now";

interface Step {
  event: string;
  detail: string;
  verdict: Verdict;
}

interface Scenario {
  key: string;
  tab: string;
  intro: string;
  steps: Step[];
  /** What the customer's phone receives in the end. */
  delivered: string[];
  lesson: string;
}

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  hold: { label: "espera um instante: pode mudar", cls: "border-dashed border-rule text-ink-2" },
  replaced: { label: "substitui o aviso anterior", cls: "border-dashed border-rule text-ink-2" },
  duplicate: { label: "repetida: barrada", cls: "border-transparent bg-marker text-marker-ink" },
  joined: { label: "entra no mesmo aviso", cls: "border-dashed border-rule text-ink-2" },
  now: { label: "urgente: sai na hora", cls: "border-transparent bg-accent text-accent-ink" },
};

const SCENARIOS: Scenario[] = [
  {
    key: "status",
    tab: "Pedido que muda rápido",
    intro: "Em poucos minutos o pedido muda de status quatro vezes, e o sistema ainda dispara o último aviso duas vezes.",
    steps: [
      { event: "Pedido #4812", detail: "pagamento aprovado", verdict: "hold" },
      { event: "Pedido #4812", detail: "em separação", verdict: "replaced" },
      { event: "Pedido #4812", detail: "enviado", verdict: "replaced" },
      { event: "Pedido #4812", detail: "saiu para entrega", verdict: "replaced" },
      { event: "Pedido #4812", detail: "saiu para entrega", verdict: "duplicate" },
    ],
    delivered: ["Seu pedido #4812 saiu para entrega. Acompanhe pelo link do rastreio."],
    lesson: "O cliente recebe só o que vale agora: a última situação do pedido.",
  },
  {
    key: "join",
    tab: "Vários avisos de uma vez",
    intro: "Pagamento, nota fiscal e separação acontecem quase juntos. São três avisos sobre o mesmo pedido.",
    steps: [
      { event: "Pedido #5120", detail: "pagamento aprovado", verdict: "hold" },
      { event: "Pedido #5120", detail: "nota fiscal emitida", verdict: "joined" },
      { event: "Pedido #5120", detail: "pedido em separação", verdict: "joined" },
    ],
    delivered: ["Pedido #5120: pagamento aprovado, nota fiscal emitida e pedido em separação."],
    lesson: "Três avisos viram uma mensagem só, com tudo dentro.",
  },
  {
    key: "otp",
    tab: "Código de verificação",
    intro: "Nem tudo pode esperar. Código de login e alerta crítico passam direto, sem nenhuma retenção.",
    steps: [{ event: "Login", detail: "código 481 516", verdict: "now" }],
    delivered: ["Seu código de verificação é 481 516. Ele vale por 5 minutos."],
    lesson: "O que é urgente nunca fica esperando para economizar.",
  },
];

const STEP_MS = 950;

export function Demo() {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(false);
  const calm = useCalmMotion();
  const ref = useRef<HTMLDivElement>(null);
  const sc = SCENARIOS[active]!;
  const done = shown > sc.steps.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setInView(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const total = SCENARIOS[active]!.steps.length + 1;
    if (calm) {
      setShown(total);
      return;
    }
    setShown(0);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= total) clearInterval(t);
    }, STEP_MS);
    return () => clearInterval(t);
  }, [active, run, inView, calm]);

  const avoided = sc.steps.length - sc.delivered.length;

  return (
    <div ref={ref}>
      <div role="tablist" aria-label="Situações de exemplo" className="flex flex-wrap gap-2">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cx("rounded-full border px-4 py-2 text-sm font-semibold transition", i === active ? "border-transparent bg-ink text-page" : "border-rule text-ink-2 hover:text-ink")}
          >
            {s.tab}
          </button>
        ))}
      </div>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-2">{sc.intro}</p>

      <div className="mt-7 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
          <p className="perf-b pb-3 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">O que o seu sistema manda → o que o WCO decide</p>
          <ol className="min-h-[268px]">
            {sc.steps.map((st, i) =>
              i < shown ? (
                <li key={`${sc.key}-${run}-${i}`} className="pop flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-dashed border-line py-3 last:border-0">
                  <span className="flex items-baseline gap-2 text-[15px]">
                    <span className="figure text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-semibold text-ink">{st.event}</span>
                    <span className="text-ink-2">{st.detail}</span>
                  </span>
                  <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", VERDICT[st.verdict].cls)}>
                    {st.verdict === "now" ? <Zap className="size-3" aria-hidden /> : <CornerDownRight className="size-3" aria-hidden />}
                    {VERDICT[st.verdict].label}
                  </span>
                </li>
              ) : null,
            )}
          </ol>
          <div className="perf-t flex flex-wrap items-center justify-between gap-3 pt-4">
            <p className="text-sm text-ink-2" aria-live="polite">
              {done ? (
                <>
                  <span className="figure font-semibold text-ink">{sc.steps.length}</span> {sc.steps.length === 1 ? "evento" : "eventos"} → <span className="figure font-semibold text-ink">{sc.delivered.length}</span> mensagem
                  {avoided > 0 ? (
                    <>
                      {" · "}
                      <span className="marker font-semibold"><span className="figure">{avoided}</span> que você não pagou</span>
                    </>
                  ) : (
                    " · nada retido"
                  )}
                </>
              ) : (
                "Recebendo eventos…"
              )}
            </p>
            <button onClick={() => setRun((r) => r + 1)} className="inline-flex items-center gap-1.5 rounded-full border border-rule px-3 py-1.5 text-xs font-semibold text-ink-2 hover:text-ink">
              <RotateCcw className="size-3.5" aria-hidden /> Repetir
            </button>
          </div>
        </div>

        {/* The customer's phone: what actually arrives. */}
        <div className="phone-stage mx-auto w-full max-w-[300px] pt-2">
          <div className="phone3d rounded-[34px] border-[7px] border-[#14201b] bg-[#e9e5d9] p-3">
            <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-[#14201b]/25" aria-hidden />
            <div className="flex items-center gap-2 rounded-2xl bg-[#fffefb] px-3 py-2">
              <span className="grid size-7 place-items-center rounded-full bg-accent font-display text-xs font-bold text-accent-ink">L</span>
              <span className="leading-tight">
                <span className="block text-[13px] font-semibold text-ink">Loja Exemplo</span>
                <span className="block text-[10px] text-muted">conta comercial</span>
              </span>
            </div>
            <div className="flex min-h-[210px] flex-col justify-end gap-2 px-1 pb-1 pt-4 [transform-style:preserve-3d]">
              {done ? (
                sc.delivered.map((m, i) => (
                  <div key={`${sc.key}-${run}-${i}`} className="lift max-w-[92%]">
                    <div className="pop rounded-2xl rounded-bl-md bg-[#fffefb] px-3 py-2 text-[13px] leading-snug text-ink shadow-[0_14px_22px_-12px_rgba(20,32,27,.55)]">
                      {m}
                      <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted">
                        agora <Check className="size-3" aria-hidden />
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="pb-2 text-center text-[11px] text-muted">nenhuma mensagem ainda</p>
              )}
            </div>
          </div>
          <p className="mt-9 text-center text-sm font-medium text-ink">{sc.lesson}</p>
        </div>
      </div>
    </div>
  );
}
