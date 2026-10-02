"use client";

import Link from "next/link";
import { BarCard, LineCard } from "@/components/charts";
import { RangePicker, useRange } from "@/components/range";
import { Badge, Card, DemoBadge, ErrorBox, Kpi, Loading, Notice, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { day, int, money, pct } from "@/lib/format";
import type { Analytics } from "@/lib/types";

const MECHANISM: Record<string, string> = {
  DEDUPLICATION: "Deduplicação",
  SUPERSESSION: "Supersession (estado mais recente)",
  CONSOLIDATION: "Consolidação",
  FREE_WINDOW: "Janela gratuita (FEP/CSW)",
  FREE_QUOTA: "Cota gratuita",
  CATEGORY: "Mensagem livre na janela",
  VOLUME_TIER: "Tier de volume",
  DIRECT_API: "Cloud API direta",
  BSP_MARKUP: "Taxa de BSP",
  INFRASTRUCTURE: "Infraestrutura",
  NONE: "Sem mecanismo (ajustes)",
};

export default function OverviewPage() {
  const [range, setRange, query] = useRange("30");
  const { data, error, loading } = useApi<Analytics>(`analytics?${query}`);
  const s = data?.summary;
  const c = s?.currency ?? "BRL";
  const m = (v: number) => money(v, c);

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Custo de WhatsApp com e sem o WCO. Meta, BSP e infraestrutura aparecem separados; valores estimados e realizados nunca se misturam."
        actions={
          <>
            {s?.isDemoRates ? <DemoBadge /> : null}
            <RangePicker value={range} onChange={setRange} />
          </>
        }
      />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {s && data ? (
        <div className="space-y-6">
          {s.isDemoRates ? (
            <Notice tone="warning">
              Os custos usam o <strong>rate card DEMO</strong> (valores fictícios). Importe o rate card oficial da Meta em <Link className="underline" href="/admin/pricing">Admin › Preços</Link> para valores reais.
            </Notice>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Custo sem WCO (estimado)" value={money(s.costs.totalWithoutWco, c)} hint={`Meta ${money(s.costs.metaWithoutWco, c)} · BSP ${money(s.costs.bspWithoutWco, c)}`} />
            <Kpi label="Custo com WCO" value={money(s.costs.totalWithWco, c)} hint={`Meta ${money(s.costs.metaWithWco, c)} · BSP ${money(s.costs.bsp, c)} · infra ${money(s.costs.infrastructure, c, 4)}`} />
            <Kpi label="Economia estimada" tone="good" value={money(s.savings.estimated.total, c)} hint={`${pct(s.costs.savingsPercent)} do custo total · Meta ${money(s.savings.estimated.meta, c)}`} badge={<Badge tone="info">ESTIMADO</Badge>} />
            <Kpi label="Economia realizada (Meta)" value={money(s.savings.realized.meta, c)} hint="Confirmada pelo objeto pricing dos webhooks da Meta" badge={<Badge tone="good">REALIZADO</Badge>} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Kpi label="Eventos processados" value={int(s.messages.processed)} />
            <Kpi label="Mensagens enviadas" value={int(s.messages.sent)} hint={`${int(s.messages.delivered)} entregues · ${int(s.messages.failed)} falhas`} />
            <Kpi label="Mensagens evitadas" value={int(s.messages.avoided)} hint={`${pct((s.messages.avoided / Math.max(1, s.messages.processed)) * 100)} dos eventos`} />
            <Kpi label="Duplicadas bloqueadas" value={int(s.messages.deduplicated)} />
            <Kpi label="Substituídas (supersession)" value={int(s.messages.superseded)} />
            <Kpi label="Consolidadas" value={int(s.messages.consolidated)} hint={`em ${int(s.messages.consolidatedMessages)} mensagens-resumo`} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Grátis por Free Entry Point" value={int(s.free.entryPoint)} />
            <Kpi label="Grátis na janela de atendimento" value={int(s.free.customerServiceWindow)} />
            <Kpi label="Cota gratuita usada" value={int(s.free.quota)} />
            <Kpi label="Custo médio por entregue" value={money(Number(s.costs.metaWithWco) / Math.max(1, s.messages.delivered), c, 4)} hint={`${int(s.free.paid)} mensagens pagas`} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <LineCard
              title="Custo Meta por dia: sem WCO vs com WCO"
              subtitle="Sem WCO = contrafactual (cada evento vira uma mensagem). Estimado."
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
            <BarCard
              title="Mensagens por dia: enviadas e evitadas"
              subtitle="Evitadas = deduplicadas + substituídas + consolidadas"
              rows={data.daily.map((d) => ({ day: d.day, sent: d.sent, avoided: d.avoided }))}
              xKey="day"
              xLabel="Dia"
              xFormat={day}
              stacked
              series={[
                { key: "sent", label: "Enviadas" },
                { key: "avoided", label: "Evitadas" },
              ]}
              format={(v) => int(v)}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <BarCard
              title="Economia estimada por mecanismo"
              subtitle="Custo Meta evitado, atribuído ao mecanismo que o gerou"
              layout="horizontal"
              rows={Object.entries(s.savings.byMechanism)
                .map(([k, v]) => ({ mechanism: MECHANISM[k] ?? k, savings: Number(v) }))
                .sort((a, b) => b.savings - a.savings)}
              xKey="mechanism"
              xLabel="Mecanismo"
              series={[{ key: "savings", label: "Economia" }]}
              format={m}
            />
            <Card title="Oportunidades e recomendações" subtitle={data.insights.disclaimer}>
              {data.insights.anomaly.anomalous ? (
                <div className="mb-4">
                  <Notice tone="warning">{data.insights.anomaly.message}</Notice>
                </div>
              ) : null}
              <ul className="space-y-3">
                {data.insights.recommendations.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-ink">{r.title}</p>
                      <Badge tone="info">{r.label === "ESTIMATED" ? "ESTIMADO" : r.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-2">{r.description}</p>
                    <p className="mt-1.5 text-xs text-muted">
                      Potencial: {money(r.potentialSaving, r.currency)} · confiança {pct(r.confidence * 100, 0)}
                    </p>
                  </li>
                ))}
                {data.insights.opportunities.map((o) => (
                  <li key={o.type} className="flex items-start justify-between gap-3 border-b border-line pb-2 text-sm last:border-0">
                    <div>
                      <p className="text-ink">{o.title}</p>
                      <p className="text-xs text-muted">{o.note}</p>
                    </div>
                    <span className="tabular whitespace-nowrap text-ink">{money(o.potentialSaving, o.currency)}</span>
                  </li>
                ))}
                {!data.insights.recommendations.length && !data.insights.opportunities.length ? <li className="text-sm text-muted">Nenhuma oportunidade identificada no período.</li> : null}
              </ul>
            </Card>
          </div>
          <p className="text-xs text-muted">{s.savings.note}</p>
        </div>
      ) : null}
    </>
  );
}
