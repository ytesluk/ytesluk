"use client";

import { useState } from "react";
import { ReceiptLine } from "@/components/ui";
import { int, money } from "@/lib/format";
import { PLANS } from "./plans";

const VOLUMES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** "0,12" / "0.12" / "R$ 0,12" → 0.12 */
function parsePrice(v: string): number {
  const n = Number(v.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Back-of-the-envelope estimate with the visitor's own numbers. Nothing here comes from a price
 * table: the price per message is typed by the visitor, and the result says so.
 */
export function Calculator() {
  const [vol, setVol] = useState(4);
  const [repeat, setRepeat] = useState(20);
  const [price, setPrice] = useState("0,10");
  const events = VOLUMES[vol]!;
  const unit = parsePrice(price);
  const avoided = Math.round((events * repeat) / 100);
  const saved = avoided * unit;
  const plan = PLANS.find((p) => p.fee !== null && events <= p.events) ?? null;
  const net = plan && plan.fee !== null ? saved - plan.fee : null;

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-8">
        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">Quantos avisos o seu sistema dispara por mês?</span>
            <span className="figure text-lg font-semibold text-ink">{int(events)}</span>
          </span>
          <input type="range" min={0} max={VOLUMES.length - 1} step={1} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="mt-3 w-full accent-[var(--accent)]" aria-valuetext={`${int(events)} avisos por mês`} />
          <span className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
            <span>1 mil</span>
            <span>1 milhão</span>
          </span>
        </label>

        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">De cada 100, quantos são repetidos ou atualizam o mesmo assunto?</span>
            <span className="figure text-lg font-semibold text-ink">{repeat}</span>
          </span>
          <input type="range" min={0} max={60} step={1} value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} className="mt-3 w-full accent-[var(--accent)]" aria-valuetext={`${repeat} de cada 100`} />
          <span className="mt-1 block text-xs leading-relaxed text-muted">Não sabe? Pense em quantas vezes um pedido muda de status no mesmo dia. No plano Free o WCO mede isso para você.</span>
        </label>

        <label className="block max-w-xs">
          <span className="text-[15px] font-semibold text-ink">Quanto você paga por mensagem?</span>
          <span className="mt-2 flex items-center gap-2 rounded-xl border border-rule bg-receipt px-3">
            <span className="figure text-sm text-muted">R$</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="figure h-11 w-full bg-transparent text-base text-ink outline-none" aria-label="Preço por mensagem em reais" />
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">O valor inicial é só um exemplo. Use o que aparece na sua fatura da Meta ou do seu fornecedor.</span>
        </label>
      </div>

      <div className="receipt-slot mx-auto w-full max-w-[400px]">
        <section className="receipt px-5 pt-5" aria-label="Estimativa com os seus números" aria-live="polite">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Estimativa · com os seus números</p>
          <h3 className="perf-b pb-3 pt-1 font-display text-xl font-semibold tracking-tight text-ink">Por mês</h3>
          <div className="perf-b py-2.5">
            <ReceiptLine label="Avisos disparados" value={int(events)} />
            <ReceiptLine label="Não precisariam virar mensagem" value={int(avoided)} />
            <ReceiptLine label="Preço por mensagem (seu)" value={money(unit, "BRL", 2)} />
          </div>
          <div className="perf-b py-2.5">
            <ReceiptLine strong highlight label="Você deixaria de pagar" value={money(saved)} />
            {plan && plan.fee !== null ? <ReceiptLine label={`Assinatura do WCO (${plan.name})`} value={plan.fee === 0 ? "grátis" : `− ${money(plan.fee)}`} /> : <ReceiptLine label="Assinatura do WCO (Enterprise)" value="sob consulta" />}
          </div>
          {net !== null ? (
            <div className="pt-2.5">
              <ReceiptLine strong label="Saldo estimado" value={money(net)} />
              {net < 0 ? <p className="mt-1 text-[11px] leading-snug text-muted">Com esses números a assinatura custaria mais do que o que você deixaria de pagar. Comece pelo Free e veja os números reais antes de decidir.</p> : null}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] leading-snug text-muted">Conta simples, feita com o que você digitou. Não é promessa: o resultado real depende do seu tráfego e da tabela de preços da Meta.</p>
        </section>
      </div>
    </div>
  );
}
