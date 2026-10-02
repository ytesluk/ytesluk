import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import { barChart, lineChart } from "./charts";
import type { ExperimentResult } from "./experiment";
import type { SweepResult } from "./sweeps";

/**
 * Exportable report (spec §39): JSON, CSVs (table view of every chart), SVG charts and a Markdown
 * summary. Every number comes from the run — nothing is typed by hand (spec §79).
 */
const brl = (v: number | string, currency = "BRL") =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number) => v.toLocaleString("pt-BR");

export function armsCsv(r: ExperimentResult): string {
  return stringify(
    r.arms.map((a) => ({
      arm: a.arm,
      label: a.label,
      events: a.events,
      messages_sent: a.messagesSent,
      messages_delivered: a.messagesDelivered,
      messages_failed: a.messagesFailed,
      duplicates_blocked: a.duplicatesBlocked,
      supersessions: a.supersessions,
      consolidated_intents: a.consolidatedIntents,
      consolidated_messages: a.consolidatedMessages,
      messages_avoided: a.messagesAvoided,
      meta_cost: a.metaCost,
      meta_cost_estimated: a.metaCostEstimated,
      bsp_cost: a.bspCost,
      infra_cost: a.infraCost,
      total_cost: a.totalCost,
      average_cost_per_delivered: a.averageCostPerDelivered,
      free_entry_point: a.freeEntryPoint,
      free_customer_service_window: a.freeCustomerServiceWindow,
      free_quota: a.freeQuota,
      quota_utilization_pct: a.quotaUtilization,
      free_window_utilization_pct: a.freeWindowUtilization,
      paid_messages: a.paidMessages,
      unknown_pricing: a.unknownPricing,
    })),
    { header: true },
  );
}

export function comparisonsCsv(r: ExperimentResult): string {
  return stringify(r.comparisons.map((c) => ({ ...c })), { header: true });
}

export function tiersCsv(r: ExperimentResult): string {
  const rows: Array<Record<string, string | number>> = [];
  for (const a of r.arms) for (const [k, v] of Object.entries(a.tierDistribution)) {
    const [market, category, tier] = k.split("|");
    rows.push({ arm: a.arm, market: market!, category: category!, tier: tier!, messages: v });
  }
  return stringify(rows, { header: true });
}

export function dailyCsv(r: ExperimentResult): string {
  const rows: Array<Record<string, string | number>> = [];
  for (const a of r.arms) for (const [day, v] of Object.entries(a.daily)) rows.push({ arm: a.arm, day, dispatched: v.dispatched, delivered: v.delivered, meta_cost: v.cost });
  return stringify(rows, { header: true });
}

export function sweepCsv(s: SweepResult): string {
  return stringify(
    s.points.map((p) => ({
      [s.parameter]: p.x,
      control_events: p.control.events,
      control_messages: p.control.messagesSent,
      control_meta_cost: p.control.metaCost,
      control_total_cost: p.control.totalCost,
      optimized_messages: p.optimized.messagesSent,
      optimized_meta_cost: p.optimized.metaCost,
      optimized_total_cost: p.optimized.totalCost,
      meta_savings_pct: p.metaSavingsPercent,
      total_savings_pct: p.totalSavingsPercent,
      quota_utilization_pct: p.optimized.quotaUtilization,
    })),
    { header: true },
  );
}

export function sweepCharts(sweeps: SweepResult[], currency: string): Record<string, string> {
  const out: Record<string, string> = {};
  const money = (v: number) => brl(v, currency);
  const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  for (const s of sweeps) {
    const pts = (f: (p: SweepResult["points"][number]) => number) => s.points.map((p) => ({ x: p.x, y: f(p) }));
    switch (s.name) {
      case "cost_vs_volume":
        out["cost_vs_volume.svg"] = lineChart({
          title: "Custo Meta vs volume de eventos",
          subtitle: "Simulado · tarifas DEMO · controle (A) vs otimizado (E)",
          xLabel: "Eventos no mês",
          yLabel: `Custo Meta (${currency})`,
          series: [
            { name: "Sem otimização (A)", points: pts((p) => Number(p.control.metaCost)) },
            { name: "Com WCO (E)", points: pts((p) => Number(p.optimized.metaCost)) },
          ],
          yFormat: money,
        });
        out["messages_vs_events.svg"] = lineChart({
          title: "Mensagens enviadas vs eventos",
          subtitle: "Simulado · cada evento vira no máximo uma mensagem",
          xLabel: "Eventos no mês",
          yLabel: "Mensagens enviadas",
          series: [
            { name: "Sem otimização (A)", points: pts((p) => p.control.messagesSent) },
            { name: "Com WCO (E)", points: pts((p) => p.optimized.messagesSent) },
          ],
        });
        break;
      case "savings_vs_duplication":
        out["savings_vs_duplication.svg"] = lineChart({ title: "Economia Meta vs taxa de duplicação", subtitle: "Simulado · braço E vs A", xLabel: "Taxa de duplicação na origem", yLabel: "Economia Meta (%)", series: [{ name: "Economia (E vs A)", points: pts((p) => p.metaSavingsPercent) }], xFormat: (v) => pct(v * 100), yFormat: pct });
        break;
      case "savings_vs_aggregation":
        out["savings_vs_aggregation.svg"] = lineChart({ title: "Economia Meta vs taxa de agregação", subtitle: "Simulado · fração de pedidos com atualizações em rajada", xLabel: "Pedidos em rajada", yLabel: "Economia Meta (%)", series: [{ name: "Economia (E vs A)", points: pts((p) => p.metaSavingsPercent) }], xFormat: (v) => pct(v * 100), yFormat: pct });
        break;
      case "savings_vs_fep":
        out["savings_vs_fep.svg"] = lineChart({ title: "Economia Meta vs taxa de Free Entry Point", subtitle: "Simulado · conversas iniciadas por anúncio Click-to-WhatsApp", xLabel: "Conversas via anúncio", yLabel: "Economia Meta (%)", series: [{ name: "Economia (E vs A)", points: pts((p) => p.metaSavingsPercent) }], xFormat: (v) => pct(v * 100), yFormat: pct });
        break;
      case "savings_vs_free_quota":
        out["savings_vs_free_quota.svg"] = lineChart({
          title: "Economia Meta vs uso da cota gratuita de Service",
          subtitle: "Simulado · cota de 1.000 mensagens/número/mês (política 2026-10)",
          xLabel: "Utilização da cota (%)",
          yLabel: "Economia Meta (%)",
          series: [{ name: "Economia (E vs A)", points: s.points.map((p) => ({ x: p.optimized.quotaUtilization, y: p.metaSavingsPercent })) }],
          xFormat: (v) => pct(v),
          yFormat: pct,
        });
        break;
    }
  }
  return out;
}

export function baselineVsOptimizedChart(r: ExperimentResult): string {
  return barChart({
    title: "Custo total por braço do experimento",
    subtitle: `Simulado · Meta + BSP + infraestrutura · ${r.isDemoRates ? "tarifas DEMO (fictícias)" : "rate card importado"}`,
    yLabel: `Custo total (${r.currency})`,
    bars: r.arms.map((a) => ({ label: a.arm, value: Number(a.totalCost), note: a.label.length > 18 ? a.label.slice(0, 17) + "…" : a.label })),
    yFormat: (v) => brl(v, r.currency),
  });
}

export function markdownReport(r: ExperimentResult, sweeps: SweepResult[] = [], extra: { title?: string; notes?: string[] } = {}): string {
  const c = r.currency;
  const A = r.arms.find((a) => a.arm === "A")!;
  const lines: string[] = [];
  lines.push(`# ${extra.title ?? "Relatório do experimento"} — ${r.scenario.name}`);
  lines.push("");
  lines.push(`> **Resultado SIMULADO.** ${r.isDemoRates ? "Custos calculados com o rate card **DEMO** (valores fictícios, não são tarifas da Meta)." : "Custos calculados com o rate card importado."} Nunca é economia garantida.`);
  lines.push("");
  lines.push(`- Gerado em: ${r.generatedAt}`);
  lines.push(`- Dataset: ${int(r.datasetSize.intents)} eventos de negócio + ${int(r.datasetSize.inbound)} mensagens de clientes · seed ${r.scenario.seed} · ${r.scenario.days} dias a partir de ${r.scenario.start} (${r.scenario.timezone})`);
  lines.push(`- Políticas de preço usadas: ${Object.entries(A.policyVersions).map(([k, v]) => `${k} (${int(v)} entregas)`).join(", ")}`);
  lines.push(`- Rate cards usados: ${Object.keys(A.rateCards).join(", ")}`);
  lines.push(`- Modelo de custo BSP (hipótese): ${r.costModel.bsp.label ?? r.costModel.bsp.type} · infra: ${r.costModel.infraPerEvent}/evento WCO, ${r.costModel.infraPerProviderCall}/chamada ao provedor`);
  lines.push("");
  lines.push("## Resultados por braço");
  lines.push("");
  lines.push("| Braço | Descrição | Eventos | Mensagens | Entregues | Evitadas | Dedup | Supersession | Consolidadas | Custo Meta | Custo BSP | Custo infra | Custo total | Custo médio/entregue |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const a of r.arms) {
    lines.push(
      `| ${a.arm} | ${a.label} | ${int(a.events)} | ${int(a.messagesSent)} | ${int(a.messagesDelivered)} | ${int(a.messagesAvoided)} | ${int(a.duplicatesBlocked)} | ${int(a.supersessions)} | ${int(a.consolidatedIntents)} | ${brl(a.metaCost, c)} | ${brl(a.bspCost, c)} | ${brl(a.infraCost, c)} | ${brl(a.totalCost, c)} | ${Number(a.averageCostPerDelivered).toFixed(4)} |`,
    );
  }
  lines.push("");
  lines.push("## Economia em relação ao controle (A)");
  lines.push("");
  lines.push("| Braço | Economia Meta | Economia Meta % | Economia BSP | Economia infra | Economia total | Economia total % | Estimada (decisão) | Realizada (entrega simulada) | Mensagens evitadas |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const x of r.comparisons) {
    lines.push(
      `| ${x.arm} | ${brl(x.metaSavings, c)} | ${x.metaSavingsPercent ?? "—"}% | ${brl(x.bspSavings, c)} | ${brl(x.infraSavings, c)} | ${brl(x.totalSavings, c)} | ${x.totalSavingsPercent ?? "—"}% | ${brl(x.estimatedMetaSavings, c)} | ${brl(x.realizedMetaSavings, c)} | ${int(x.messagesAvoided)} |`,
    );
  }
  lines.push("");
  lines.push("Economia Meta, BSP e infraestrutura são apresentadas separadamente. A economia de infraestrutura pode ser **negativa**: o WCO tem custo próprio de processamento por evento.");
  lines.push("");
  lines.push("## Janelas gratuitas, cota e tiers");
  lines.push("");
  lines.push("| Braço | Grátis por FEP | Grátis por CSW | Cota Service usada | Utilização da cota | Mensagens pagas | Preço desconhecido |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const a of r.arms) lines.push(`| ${a.arm} | ${int(a.freeEntryPoint)} | ${int(a.freeCustomerServiceWindow)} | ${int(a.freeQuota)} / ${int(a.quotaAvailable)} | ${a.quotaUtilization}% | ${int(a.paidMessages)} | ${int(a.unknownPricing)} |`);
  lines.push("");
  lines.push("### Distribuição por tier (mensagens cobradas)");
  lines.push("");
  lines.push("| Braço | Mercado | Categoria | Tier | Mensagens |");
  lines.push("|---|---|---|---|---:|");
  for (const a of [A, r.arms.find((x) => x.arm === "E") ?? A]) {
    for (const [k, v] of Object.entries(a.tierDistribution).sort((x, y) => y[1] - x[1])) {
      const [m, cat, tier] = k.split("|");
      lines.push(`| ${a.arm} | ${m} | ${cat} | ${tier} | ${int(v)} |`);
    }
  }
  if (sweeps.length) {
    lines.push("");
    lines.push("## Varreduras de parâmetros (braço E vs A)");
    for (const s of sweeps) {
      lines.push("");
      lines.push(`### ${s.name} (${s.parameter})`);
      lines.push("");
      lines.push(`| ${s.parameter} | Mensagens A | Mensagens E | Custo Meta A | Custo Meta E | Economia Meta % | Economia total % |`);
      lines.push("|---:|---:|---:|---:|---:|---:|---:|");
      for (const p of s.points) {
        lines.push(`| ${p.x} | ${int(p.control.messagesSent)} | ${int(p.optimized.messagesSent)} | ${brl(p.control.metaCost, c)} | ${brl(p.optimized.metaCost, c)} | ${p.metaSavingsPercent}% | ${p.totalSavingsPercent}% |`);
      }
    }
  }
  lines.push("");
  lines.push("## Gráficos");
  lines.push("");
  lines.push("Arquivos SVG em `charts/` e os mesmos dados em CSV (visão de tabela).");
  if (extra.notes?.length) {
    lines.push("");
    lines.push("## Notas");
    for (const n of extra.notes) lines.push(`- ${n}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(dir: string, r: ExperimentResult, sweeps: SweepResult[] = [], extra: { title?: string; notes?: string[] } = {}): string[] {
  mkdirSync(join(dir, "charts"), { recursive: true });
  const files: Record<string, string> = {
    "results.json": JSON.stringify({ experiment: r, sweeps: sweeps.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x, metaSavingsPercent: p.metaSavingsPercent, totalSavingsPercent: p.totalSavingsPercent, control: p.control, optimized: p.optimized })) })) }, null, 2),
    "arms.csv": armsCsv(r),
    "comparisons.csv": comparisonsCsv(r),
    "tiers.csv": tiersCsv(r),
    "daily.csv": dailyCsv(r),
    "REPORT.md": markdownReport(r, sweeps, extra),
    "charts/baseline_vs_optimized.svg": baselineVsOptimizedChart(r),
  };
  for (const s of sweeps) files[`sweep_${s.name}.csv`] = sweepCsv(s);
  for (const [name, svg] of Object.entries(sweepCharts(sweeps, r.currency))) files[`charts/${name}`] = svg;
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return Object.keys(files);
}
