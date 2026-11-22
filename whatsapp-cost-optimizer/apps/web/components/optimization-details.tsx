"use client";

import { BarCard, LineCard } from "@/components/charts";
import { Card, Table } from "@/components/ui";
import { day, int, money, pct } from "@/lib/format";
import type { Analytics } from "@/lib/types";

const CATEGORY: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Aviso (utilidade)", AUTHENTICATION: "Autenticação", AUTHENTICATION_INTERNATIONAL: "Autenticação internacional", SERVICE: "Atendimento" };

/**
 * Where the savings happen: by category, event type, free window and tier. Estimated = WCO's
 * decision; realized = confirmed by Meta's webhooks. Shown at the bottom of the overview.
 */
export function OptimizationDetails({ data }: { data: Analytics }) {
  const c = data.summary.currency ?? "BRL";
  const m = (v: number) => money(v, c);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <LineCard
          title="Economia por dia: estimada e confirmada pela Meta"
          subtitle="Confirmada só quando a Meta informa o preço na entrega"
          rows={data.daily.map((d) => ({ day: d.day, estimated: Number(d.savingsEstimated), realized: Number(d.savingsRealized) }))}
          xKey="day"
          xLabel="Dia"
          xFormat={day}
          series={[
            { key: "estimated", label: "Estimada" },
            { key: "realized", label: "Confirmada" },
          ]}
          format={m}
        />
        <BarCard
          title="Custo por tipo de mensagem: sem WCO e com WCO"
          subtitle="Quem decide o tipo de cada mensagem é a Meta"
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
          title="Mensagens grátis e pagas"
          subtitle="Grátis porque o cliente veio de anúncio ou falou nas últimas 24 h, pela cota do mês, ou pagas"
          layout="horizontal"
          rows={[
            { k: "Veio de anúncio", v: data.summary.free.entryPoint },
            { k: "Falou nas últimas 24 h", v: data.summary.free.customerServiceWindow },
            { k: "Cota gratuita", v: data.summary.free.quota },
            { k: "Outras gratuitas", v: data.summary.free.other },
            { k: "Pagas", v: data.summary.free.paid },
          ]}
          xKey="k"
          xLabel="Tipo"
          series={[{ key: "v", label: "Mensagens" }]}
          format={(v) => int(v)}
        />
        <BarCard
          title="Economia na taxa de intermediário por dia"
          subtitle={`Separada da economia na Meta. Custo do WCO no período: ${money(data.daily.reduce((a, d) => a + Number(d.infraSavings), 0), c, 4)} — pode ser negativa, pois o WCO tem custo próprio.`}
          rows={data.daily.map((d) => ({ day: d.day, bsp: Number(d.bspSavings) }))}
          xKey="day"
          xLabel="Dia"
          xFormat={day}
          series={[{ key: "bsp", label: "Economia" }]}
          format={(v) => money(v, c, 2)}
        />
      </div>

      <Card title="Por tipo de aviso" subtitle="Pedidos de envio, mensagens enviadas e o que não precisou sair" padded={false}>
        <Table
          rows={data.breakdown.byEventType}
          rowKey={(r) => r.eventType}
          columns={[
            { key: "e", header: "Tipo de aviso", render: (r) => <code className="text-xs">{r.eventType}</code> },
            { key: "i", header: "Pedidos", align: "right", render: (r) => int(r.intents) },
            { key: "s", header: "Enviadas", align: "right", render: (r) => int(r.sent) },
            { key: "d", header: "Repetidas", align: "right", render: (r) => int(r.deduplicated) },
            { key: "u", header: "Trocadas", align: "right", render: (r) => int(r.superseded) },
            { key: "c", header: "Juntadas", align: "right", render: (r) => int(r.consolidated) },
            { key: "r", header: "Redução", align: "right", render: (r) => pct(r.intents ? ((r.intents - r.sent) / r.intents) * 100 : 0) },
            { key: "a", header: "Custo médio", align: "right", render: (r) => money(r.averageCost, c, 4) },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Por tipo de mensagem" padded={false}>
          <Table
            rows={data.breakdown.byCategory}
            rowKey={(r) => r.category}
            columns={[
              { key: "c", header: "Tipo", render: (r) => CATEGORY[r.category] ?? r.category },
              { key: "i", header: "Eventos", align: "right", render: (r) => int(r.intents) },
              { key: "s", header: "Enviadas", align: "right", render: (r) => int(r.sent) },
              { key: "b", header: "Sem WCO", align: "right", render: (r) => money(r.baselineCost, c) },
              { key: "o", header: "Com WCO", align: "right", render: (r) => money(r.cost, c) },
              { key: "e", header: "Economia", align: "right", render: (r) => money(r.savings, c) },
            ]}
          />
        </Card>
        <Card title="Desconto por volume" subtitle="Mensagens pagas por país, tipo e faixa de preço da Meta no mês" padded={false}>
          <Table
            dense
            rows={data.breakdown.tiers}
            rowKey={(r) => `${r.market}-${r.category}-${r.tier}`}
            columns={[
              { key: "m", header: "País", render: (r) => r.market },
              { key: "c", header: "Tipo", render: (r) => CATEGORY[r.category] ?? r.category },
              { key: "t", header: "Faixa", render: (r) => r.tier },
              { key: "n", header: "Mensagens", align: "right", render: (r) => int(r.messages) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
