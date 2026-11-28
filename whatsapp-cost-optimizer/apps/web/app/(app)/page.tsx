"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { BarCard, LineCard } from "@/components/charts";
import { FinOpsPanel } from "@/components/finops-panel";
import { OptimizationDetails } from "@/components/optimization-details";
import { RangePicker, useRange } from "@/components/range";
import { useCountUp } from "@/components/shell";
import { Badge, Card, ConfidenceBadge, ErrorBox, Loading, Notice, PageHeader, ReceiptLine } from "@/components/ui";
import { useApi } from "@/lib/api";
import { day, int, money, pct } from "@/lib/format";
import type { Analytics, Summary } from "@/lib/types";

/** Plain-language names of what avoided a cost (the codes stay in the API and in the audit). */
const MECHANISM: Record<string, string> = {
  DEDUPLICATION: "Repetidas barradas",
  SUPERSESSION: "Substituídas pela mais recente",
  CONSOLIDATION: "Juntadas em uma só mensagem",
  FREE_WINDOW: "Enviadas em janela grátis",
  FREE_QUOTA: "Cota grátis do mês",
  CATEGORY: "Enviadas como conversa",
  TEMPLATE_TO_FREEFORM_CSW: "Enviadas como conversa (grátis)",
  UTILITY_SPLIT_DEFERRED: "Oferta enviada só após a resposta",
  FEP_PRIORITY: "Antecipadas para a janela do anúncio",
  FREQUENCY_CAP_DEFERRED: "Adiadas pelo limite de marketing",
  INVALID_RECIPIENT_SUPPRESSED: "Números recusados não tentados de novo",
  VOLUME_TIER: "Desconto por volume",
  DIRECT_API: "Envio direto pela Meta",
  BSP_MARKUP: "Taxa de intermediário",
  BSP_MARKUP_AVOIDED: "Taxa de intermediário",
  INFRASTRUCTURE: "Custo do WCO",
  NONE: "Ajustes",
};

/**
 * The savings tips in plain words. The API's texts are written for engineers (event names, hashes,
 * buffers); the company sees what happened and what it can do. Keyed by the tip's id / type.
 */
type Tip = { key: string; title: string; text: string; value: string; currency: string };
function plainTips(insights: Analytics["insights"]): Tip[] {
  const tips: Tip[] = [];
  for (const r of insights.recommendations) {
    const kind = r.id.split(":")[0];
    const ev = (r.evidence ?? {}) as Record<string, number | string>;
    const n = (k: string) => int(Number(ev[k] ?? 0));
    const t =
      kind === "supersession"
        ? { title: `${n("superseded")} avisos foram trocados pelo mais novo antes de sair`, text: "Quando chegaram vários avisos do mesmo pedido em sequência, o WCO mandou só o mais atual. Não precisa fazer nada." }
        : kind === "consolidation"
          ? { title: "Dá para juntar mais avisos", text: "Muitos avisos do mesmo cliente chegam com poucos minutos de diferença. Juntos, eles podem sair numa mensagem só." }
          : kind === "dedup"
            ? { title: `${n("deduplicated")} avisos chegaram repetidos`, text: "O seu sistema mandou o mesmo aviso mais de uma vez. O WCO barrou as cópias; vale pedir ao responsável pelo sistema para corrigir isso." }
            : kind === "window"
              ? { title: "Algumas mensagens saíram pagas logo depois do período grátis", text: "Se der para enviá-las um pouco antes, elas saem de graça." }
              : { title: r.title, text: r.description };
    tips.push({ key: r.id, ...t, value: r.potentialSaving, currency: r.currency });
  }
  const OPP: Record<string, { title: string; text: string }> = {
    DUPLICATE: { title: "Avisos repetidos", text: "Mensagens que chegaram em dobro e o WCO não enviou." },
    CONSOLIDATION: { title: "Juntar avisos em sequência", text: "Avisos do mesmo cliente que chegam juntos podem sair numa mensagem só." },
    FREE_WINDOW: { title: "Responder rápido quem veio de anúncio", text: "Quando o cliente chega por um anúncio que abre o WhatsApp e você responde em até 24 horas, as mensagens seguintes ficam grátis por alguns dias." },
    VOLUME_TIER: { title: "Desconto por volume", text: "A Meta cobra menos de quem manda muitas mensagens no mês. O WCO nunca manda mensagens a mais só para ganhar desconto." },
    BSP_MARKUP: { title: "Taxa do intermediário", text: "Se você usa uma empresa intermediária para o WhatsApp, ligar direto na Meta pode tirar essa taxa. Veja antes se compensa." },
  };
  for (const o of insights.opportunities) {
    const t = OPP[o.type] ?? { title: o.title, text: o.note };
    tips.push({ key: o.type, ...t, value: o.potentialSaving, currency: o.currency });
  }
  return tips.filter((t) => Number(t.value) > 0); // nothing to gain → not a tip
}

const shortDate = (v: string) => new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * The statement ("extrato"): every line is money that was not spent, by what avoided it. It uses one
 * ledger only (the savings records), so the lines add up to the highlighted total; the estimate and
 * what Meta confirmed are shown side by side and never added together.
 */
function Statement({ s }: { s: Summary }) {
  const c = s.currency;
  const lines = Object.entries(s.savings.byMechanism)
    .map(([k, v]) => ({ k, v: Number(v) }))
    .filter((l) => l.v !== 0)
    .sort((a, b) => b.v - a.v);
  const bsp = Number(s.savings.estimated.bsp);
  const infra = Number(s.savings.estimated.infrastructure);
  return (
    <div className="receipt-slot mx-auto w-full max-w-[400px]">
      <section className="receipt receipt-print px-5 pt-5" aria-label="Extrato do que deixou de ser pago">
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Extrato · {shortDate(s.range.from)} a {shortDate(s.range.to)}
          </p>
        </div>
        <h2 className="perf-b pb-3 pt-1 font-display text-xl font-semibold tracking-tight text-ink">O que o WCO evitou</h2>

        <div className="perf-b py-2.5">
          <p className="pb-1 font-mono text-[10px] uppercase tracking-widest text-muted">Na conta da Meta</p>
          {lines.length ? lines.map((l) => <ReceiptLine key={l.k} label={MECHANISM[l.k] ?? l.k} value={money(l.v, c)} />) : <p className="py-1 text-[12.5px] text-muted">Nada evitado neste período ainda.</p>}
          <ReceiptLine strong label="Subtotal" value={money(s.savings.estimated.meta, c)} />
        </div>

        {bsp !== 0 || infra !== 0 ? (
          <div className="perf-b py-2.5">
            <p className="pb-1 font-mono text-[10px] uppercase tracking-widest text-muted">Fora da Meta</p>
            {bsp !== 0 ? <ReceiptLine label="Taxa de intermediário" value={money(bsp, c)} /> : null}
            {infra !== 0 ? <ReceiptLine label="Custo do WCO" value={money(infra, c, 4)} note={infra < 0 ? "Negativo: é o custo do próprio WCO para processar as mensagens." : undefined} /> : null}
          </div>
        ) : null}

        <div className="pt-3">
          <ReceiptLine strong highlight label={<span className="inline-flex flex-wrap items-center gap-1.5">Você deixou de pagar <ConfidenceBadge value="ESTIMATED" /></span>} value={money(s.savings.estimated.total, c)} />
          <ReceiptLine label={<span className="inline-flex flex-wrap items-center gap-1.5">Já confirmado pela Meta <ConfidenceBadge value="REALIZED" /></span>} value={money(s.savings.realized.meta, c)} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">Estimado é a conta do WCO; confirmado é o que a Meta informou depois da entrega. Os dois nunca são somados.</p>
      </section>
    </div>
  );
}

/** Where the received events went, as one proportional bar with the numbers written out. */
function EventFlow({ s }: { s: Summary }) {
  const m = s.messages;
  const other = Math.max(0, m.processed - m.sent - m.avoided);
  const total = Math.max(1, m.processed);
  const parts = [
    { key: "sent", label: "enviadas", n: m.sent, cls: "bg-ink" },
    { key: "avoided", label: "não precisaram ser enviadas", n: m.avoided, cls: "bg-marker ring-1 ring-inset ring-[var(--rule)]" },
    { key: "other", label: "bloqueadas, canceladas ou esperando", n: other, cls: "bg-surface-2 ring-1 ring-inset ring-[var(--rule)]" },
  ].filter((p) => p.n > 0);
  return (
    <figure aria-label="O que aconteceu com as mensagens">
      <figcaption className="text-sm text-ink-2">
        De cada <strong className="text-ink">100</strong> mensagens que a empresa pediu para enviar, <strong className="text-ink">{Math.round((m.sent / total) * 100)}</strong> precisaram sair de verdade.
      </figcaption>
      <div className="mt-3 flex h-3.5 gap-[2px]" role="img" aria-label={parts.map((p) => `${int(p.n)} ${p.label}`).join(", ")}>
        {parts.map((p, i) => (
          <span key={p.key} title={`${int(p.n)} ${p.label}`} className={`${p.cls} ${i === 0 ? "rounded-l-[4px]" : ""} ${i === parts.length - 1 ? "rounded-r-[4px]" : ""}`} style={{ width: `${(p.n / total) * 100}%`, minWidth: 6 }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-ink-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className={`inline-block size-2.5 rounded-[3px] ${p.cls}`} aria-hidden />
            <span className="figure text-ink">{int(p.n)}</span> {p.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-[13px] text-ink-2">
        {label}
        {hint ? <span className="block text-[11px] text-muted">{hint}</span> : null}
      </dt>
      <dd className="figure text-[15px] font-medium text-ink">{value}</dd>
    </div>
  );
}

function BigNumber({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="figure mt-1 text-[26px] font-semibold text-ink">{value}</dd>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

function StatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <p className="pb-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">{title}</p>
      <dl>{children}</dl>
    </div>
  );
}

export default function OverviewPage() {
  const [range, setRange, query] = useRange("30");
  const { data, error, loading } = useApi<Analytics>(`analytics?${query}`);
  const me = useApi<{ actor: { platformAdmin?: boolean } }>("auth/me");
  const s = data?.summary;
  const c = s?.currency ?? "BRL";
  const m = (v: number) => money(v, c);
  const tips = data ? plainTips(data.insights) : [];
  const headline = useCountUp(s ? Number(s.savings.estimated.total) : null);

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Quanto você economizou no WhatsApp com o WCO."
        actions={
          <>
            <RangePicker value={range} onChange={setRange} />
          </>
        }
      />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {s && data ? (
        <div className="space-y-8">
          {s.isDemoRates ? (
            <Notice tone="warning">
              Os valores em reais são de <strong>exemplo (DEMO)</strong>, não os preços reais da Meta.{" "}
              {me.data?.actor.platformAdmin ? (
                <>
                  Importe a tabela oficial da Meta em <Link className="underline" href="/admin/pricing">Preços</Link> para valores reais.
                </>
              ) : (
                "Os valores reais aparecem quando a tabela oficial de preços da Meta for carregada."
              )}
            </Notice>
          ) : null}

          <section className="grid grid-cols-1 items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="rise space-y-7">
              <div>
                <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted">Últimos {range} dias</p>
                <p className="mt-2 font-display text-[clamp(30px,4.2vw,46px)] font-semibold leading-[1.1] tracking-tight text-ink">
                  Você deixou de pagar{" "}
                  <span className="figure whitespace-nowrap">
                    <span className="marker">{money(headline ?? 0, c)}</span>
                  </span>
                </p>
                <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
                  <li className="flex flex-wrap items-center gap-2">
                    <ConfidenceBadge value="ESTIMATED" />
                    <span>pela conta do WCO</span>
                  </li>
                  <li className="flex flex-wrap items-center gap-2">
                    <ConfidenceBadge value="REALIZED" />
                    <span>
                      <span className="figure font-medium text-ink">{money(s.savings.realized.meta, c)}</span> já confirmados pela Meta
                    </span>
                  </li>
                </ul>
              </div>

              <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <div className="rounded-2xl border border-dashed border-rule p-4">
                  <p className="text-xs font-medium text-ink-2">Custo sem WCO (estimado)</p>
                  <p className="figure struck mt-1.5 text-[26px] font-medium">{money(s.costs.totalWithoutWco, c)}</p>
                  <p className="mt-1 text-[11px] text-muted">o que você pagaria enviando tudo</p>
                </div>
                <ArrowRight className="hidden size-5 self-center text-muted sm:block" aria-hidden />
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-ink-2">Custo com WCO</p>
                    {s.costs.savingsPercent ? <Badge tone="neutral">−{pct(s.costs.savingsPercent)}</Badge> : null}
                  </div>
                  <p className="figure mt-1.5 text-[26px] font-semibold text-ink">{money(s.costs.totalWithWco, c)}</p>
                  <p className="mt-1 text-[11px] text-muted">o que você pagou de verdade</p>
                </div>
              </div>

              <EventFlow s={s} />
            </div>
            <Statement s={s} />
          </section>

          <Card padded={false}>
            <dl className="grid grid-cols-1 divide-y divide-dashed divide-[var(--rule)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <BigNumber label="Mensagens enviadas" value={int(s.messages.sent)} hint={`${int(s.messages.delivered)} entregues`} />
              <BigNumber label="Não precisaram ser enviadas" value={int(s.messages.avoided)} hint="repetidas, trocadas pela mais nova ou juntadas" />
              <BigNumber label="Enviadas de graça" value={int(s.free.entryPoint + s.free.customerServiceWindow + s.free.quota + s.free.other)} hint={`${int(s.free.paid)} pagas`} />
            </dl>
          </Card>

          <LineCard
            title="Quanto você gastou por dia"
            subtitle="Sem o WCO é uma estimativa: o que seria pago enviando tudo."
            rows={data.daily.map((d) => ({ day: d.day, baseline: Number(d.baselineCost), optimized: Number(d.cost) }))}
            xKey="day"
            xLabel="Dia"
            xFormat={day}
            series={[
              { key: "baseline", label: "Sem WCO" },
              { key: "optimized", label: "Com WCO" },
            ]}
            format={m}
          />

          {data.insights.anomaly.anomalous || tips.length ? (
            <Card title="Como economizar mais" subtitle="Valores estimados, não garantidos.">
              {data.insights.anomaly.anomalous ? (
                <div className="mb-4">
                  <Notice tone="warning">{data.insights.anomaly.message}</Notice>
                </div>
              ) : null}
              <ul className="divide-y divide-dashed divide-[var(--rule)]">
                {tips.map((t) => (
                  <li key={t.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-ink">{t.title}</p>
                      <p className="mt-0.5 text-xs text-ink-2">{t.text}</p>
                    </div>
                    <span className="figure whitespace-nowrap text-sm text-ink">até {money(t.value, t.currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <details className="group rounded-2xl border border-line bg-surface">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-ink marker:hidden">
              <span className="inline-flex items-center gap-2">
                <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
                Ver todos os números
              </span>
              <span className="block pl-6 text-xs font-normal text-muted">Para quem quer conferir em detalhe. Não precisa mexer em nada aqui.</span>
            </summary>
            <div className="space-y-8 border-t border-dashed border-rule px-5 py-6">
              <Card padded={false}>
                <div className="grid grid-cols-1 divide-y divide-dashed divide-[var(--rule)] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
                  <StatGroup title="Movimento">
                    <Stat label="Pedidos de envio recebidos" value={int(s.messages.processed)} />
                    <Stat label="Mensagens enviadas" value={int(s.messages.sent)} />
                    <Stat label="Entregues" value={int(s.messages.delivered)} />
                    <Stat label="Não entregues" value={int(s.messages.failed)} />
                  </StatGroup>
                  <StatGroup title="Não precisaram sair">
                    <Stat label="Total" value={int(s.messages.avoided)} hint={`${pct((s.messages.avoided / Math.max(1, s.messages.processed)) * 100)} dos pedidos`} />
                    <Stat label="Repetidas" value={int(s.messages.deduplicated)} />
                    <Stat label="Trocadas pela mais nova" value={int(s.messages.superseded)} />
                    <Stat label="Juntadas" value={int(s.messages.consolidated)} hint={`em ${int(s.messages.consolidatedMessages)} mensagens`} />
                  </StatGroup>
                  <StatGroup title="De graça">
                    <Stat label="Cliente veio de um anúncio" value={int(s.free.entryPoint)} />
                    <Stat label="Cliente falou nas últimas 24 h" value={int(s.free.customerServiceWindow)} />
                    <Stat label="Cota grátis do mês" value={int(s.free.quota)} />
                  </StatGroup>
                  <StatGroup title="Pagas">
                    <Stat label="Mensagens pagas" value={int(s.free.paid)} />
                    <Stat label="Custo médio por entregue" value={money(Number(s.costs.metaWithWco) / Math.max(1, s.messages.delivered), c, 4)} />
                    <Stat label="Na Meta / intermediário" value={`${money(s.costs.metaWithWco, c)} / ${money(s.costs.bsp, c)}`} />
                  </StatGroup>
                </div>
              </Card>

              <BarCard
                title="Mensagens por dia: enviadas e as que não precisaram sair"
                subtitle="Não precisaram sair = repetidas + trocadas pela mais nova + juntadas"
                rows={data.daily.map((d) => ({ day: d.day, sent: d.sent, avoided: d.avoided }))}
                xKey="day"
                xLabel="Dia"
                xFormat={day}
                stacked
                series={[
                  { key: "sent", label: "Enviadas" },
                  { key: "avoided", label: "Não precisaram sair" },
                ]}
                format={(v) => int(v)}
              />

              <section id="economia" className="scroll-mt-20 space-y-4">
                <div>
                  <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">Onde a economia acontece</h2>
                  <p className="text-sm text-ink-2">Por tipo de mensagem e por motivo. Estimado = conta do WCO; confirmado = informado pela Meta.</p>
                </div>
                <OptimizationDetails data={data} />
                <FinOpsPanel query={query} />
              </section>
              <p className="text-xs text-muted">{s.savings.note}</p>
            </div>
          </details>
        </div>
      ) : null}
    </>
  );
}
