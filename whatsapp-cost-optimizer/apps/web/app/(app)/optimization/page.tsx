"use client";

import { BarCard, LineCard } from "@/components/charts";
import { RangePicker, useRange } from "@/components/range";
import { Card, DemoBadge, ErrorBox, Loading, PageHeader, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { day, int, money, pct } from "@/lib/format";
import type { Analytics } from "@/lib/types";

const CATEGORY: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utility", AUTHENTICATION: "Autenticação", AUTHENTICATION_INTERNATIONAL: "Autenticação internacional", SERVICE: "Service" };

export default function OptimizationPage() {
  const [range, setRange, query] = useRange("30");
  const { data, error, loading } = useApi<Analytics>(`analytics?${query}`);
  const c = data?.summary.currency ?? "BRL";
  const m = (v: number) => money(v, c);

  return (
    <>
      <PageHeader
        title="Otimização"
        description="Onde a economia acontece: por categoria, por tipo de evento, por janela gratuita e por tier. Estimado = decisão do WCO; realizado = confirmado pelos webhooks da Meta."
        actions={
          <>
            {data?.summary.isDemoRates ? <DemoBadge /> : null}
            <RangePicker value={range} onChange={setRange} />
          </>
        }
      />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <LineCard
              title="Economia Meta por dia: estimada vs realizada"
              subtitle="Realizada só quando a Meta confirma a entrega com objeto pricing"
              rows={data.daily.map((d) => ({ day: d.day, estimated: Number(d.savingsEstimated), realized: Number(d.savingsRealized) }))}
              xKey="day"
              xLabel="Dia"
              xFormat={day}
              series={[
                { key: "estimated", label: "Estimada" },
                { key: "realized", label: "Realizada" },
              ]}
              format={m}
            />
            <BarCard
              title="Custo Meta por categoria: sem WCO vs com WCO"
              subtitle="A categoria final de cada template é determinada pela Meta"
              rows={data.breakdown.byCategory.map((r) => ({ category: CATEGORY[r.category] ?? r.category, baseline: Number(r.baselineCost), optimized: Number(r.cost) }))}
              xKey="category"
              xLabel="Categoria"
              series={[
                { key: "baseline", label: "Sem WCO" },
                { key: "optimized", label: "Com WCO" },
              ]}
              format={m}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <BarCard
              title="Mensagens por tratamento de preço"
              subtitle="Grátis por janela (FEP, atendimento), cota gratuita e pagas"
              layout="horizontal"
              rows={[
                { k: "Free Entry Point", v: data.summary.free.entryPoint },
                { k: "Janela de atendimento", v: data.summary.free.customerServiceWindow },
                { k: "Cota gratuita", v: data.summary.free.quota },
                { k: "Outras gratuitas", v: data.summary.free.other },
                { k: "Pagas", v: data.summary.free.paid },
              ]}
              xKey="k"
              xLabel="Tratamento"
              series={[{ key: "v", label: "Mensagens" }]}
              format={(v) => int(v)}
            />
            <BarCard
              title="Economia de taxas do BSP por dia"
              subtitle={`Separada da economia Meta (BSP hipotético do tenant). Infraestrutura no período: ${money(data.daily.reduce((a, d) => a + Number(d.infraSavings), 0), c, 4)} — pode ser negativa, pois o WCO tem custo próprio.`}
              rows={data.daily.map((d) => ({ day: d.day, bsp: Number(d.bspSavings) }))}
              xKey="day"
              xLabel="Dia"
              xFormat={day}
              series={[{ key: "bsp", label: "Economia BSP" }]}
              format={(v) => money(v, c, 2)}
            />
          </div>

          <Card title="Por tipo de evento" subtitle="Eventos recebidos, mensagens enviadas e o que foi evitado" padded={false}>
            <Table
              rows={data.breakdown.byEventType}
              rowKey={(r) => r.eventType}
              columns={[
                { key: "e", header: "Tipo de evento", render: (r) => <code className="text-xs">{r.eventType}</code> },
                { key: "i", header: "Eventos", align: "right", render: (r) => int(r.intents) },
                { key: "s", header: "Enviadas", align: "right", render: (r) => int(r.sent) },
                { key: "d", header: "Deduplicadas", align: "right", render: (r) => int(r.deduplicated) },
                { key: "u", header: "Substituídas", align: "right", render: (r) => int(r.superseded) },
                { key: "c", header: "Consolidadas", align: "right", render: (r) => int(r.consolidated) },
                { key: "r", header: "Redução", align: "right", render: (r) => pct(r.intents ? ((r.intents - r.sent) / r.intents) * 100 : 0) },
                { key: "a", header: "Custo médio", align: "right", render: (r) => money(r.averageCost, c, 4) },
              ]}
            />
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Por categoria" padded={false}>
              <Table
                rows={data.breakdown.byCategory}
                rowKey={(r) => r.category}
                columns={[
                  { key: "c", header: "Categoria", render: (r) => CATEGORY[r.category] ?? r.category },
                  { key: "i", header: "Eventos", align: "right", render: (r) => int(r.intents) },
                  { key: "s", header: "Enviadas", align: "right", render: (r) => int(r.sent) },
                  { key: "b", header: "Sem WCO", align: "right", render: (r) => money(r.baselineCost, c) },
                  { key: "o", header: "Com WCO", align: "right", render: (r) => money(r.cost, c) },
                  { key: "e", header: "Economia", align: "right", render: (r) => money(r.savings, c) },
                ]}
              />
            </Card>
            <Card title="Distribuição por tier de volume" subtitle="Mensagens cobradas por mercado, categoria e faixa (acúmulo mensal por portfólio)" padded={false}>
              <Table
                dense
                rows={data.breakdown.tiers}
                rowKey={(r) => `${r.market}-${r.category}-${r.tier}`}
                columns={[
                  { key: "m", header: "Mercado", render: (r) => r.market },
                  { key: "c", header: "Categoria", render: (r) => CATEGORY[r.category] ?? r.category },
                  { key: "t", header: "Tier", render: (r) => r.tier },
                  { key: "n", header: "Mensagens", align: "right", render: (r) => int(r.messages) },
                ]}
              />
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
