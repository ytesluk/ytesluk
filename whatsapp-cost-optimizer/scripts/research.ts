/**
 * pnpm research — the academic experiment matrix (spec §39, §40, §77–§79).
 *
 *   pnpm research                                        9 scenarios × {10k, 50k} × 3 seeds, arms A–F
 *   pnpm research --sizes 10000 --seeds 1                quick run
 *   pnpm research --sizes 1000000 --scenarios MEDIUM_DUPLICATION --seeds 1     scale check
 *   pnpm research --out reports/research
 *
 * For every (scenario, size, seed) the SAME dataset is replayed through every arm (paired design),
 * so differences between arms come only from the enabled techniques. Several seeds give the
 * dispersion of the effect (mean, standard deviation, min, max). Results are SIMULATED with the DEMO
 * rate card unless --rate-card is given; they are never guaranteed savings.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { stringify } from "csv-stringify/sync";
import { RateCatalog, importRateCard } from "@wco/pricing";
import { ARMS, SCENARIOS, barChart, generateDataset, lineChart, runExperiment, scenarioPreset, type ExperimentDeps, type ScenarioName } from "@wco/simulator";

const { values } = parseArgs({
  options: {
    sizes: { type: "string", default: "10000,50000" },
    scenarios: { type: "string", default: SCENARIOS.join(",") },
    seeds: { type: "string", default: "3" },
    out: { type: "string", default: "reports/research" },
    "rate-card": { type: "string" },
  },
});

const sizes = values.sizes!.split(",").map((s) => Number(s.trim().replace(/_/g, "")));
const scenarios = values.scenarios!.split(",").map((s) => s.trim()) as ScenarioName[];
const seeds = Array.from({ length: Number(values.seeds) }, (_, i) => 20261002 + i * 7919);
const deps: ExperimentDeps = {};
if (values["rate-card"]) {
  const r = importRateCard(readFileSync(values["rate-card"], "utf8"), {});
  if (!r.ok || !r.card) throw new Error("rate card inválido");
  deps.rates = new RateCatalog([r.card]);
}
const out = values.out!;
mkdirSync(join(out, "charts"), { recursive: true });

interface Row {
  scenario: ScenarioName;
  dimension: string;
  level: string;
  parameter: number;
  size: number;
  seed: number;
  arm: string;
  intents: number;
  inbound: number;
  messages_sent: number;
  messages_avoided: number;
  deduplicated: number;
  superseded: number;
  consolidated: number;
  meta_cost: number;
  bsp_cost: number;
  infra_cost: number;
  total_cost: number;
  meta_savings_pct: number;
  total_savings_pct: number;
  free_fep: number;
  free_quota: number;
  paid: number;
  unknown_pricing: number;
  us_per_event: number;
}

const rows: Row[] = [];
const started = Date.now();
let demo = true;
for (const size of sizes) {
  for (const scenario of scenarios) {
    for (const seed of seeds) {
      const params = scenarioPreset(scenario, { events: size, customers: Math.max(2_000, Math.round(size / 5)), seed });
      const [level, dimension] = scenario.split("_") as [string, string];
      const parameter = dimension === "DUPLICATION" ? params.duplicateRate : dimension === "AGGREGATION" ? params.burstRate : params.fepRate;
      const t0 = Date.now();
      const ds = generateDataset(params);
      const r = runExperiment(params, deps, ds);
      demo = demo && r.isDemoRates;
      const A = r.arms.find((a) => a.arm === "A")!;
      for (const a of r.arms) {
        const c = r.comparisons.find((x) => x.arm === a.arm);
        rows.push({
          scenario,
          dimension,
          level,
          parameter,
          size,
          seed,
          arm: a.arm,
          intents: a.events,
          inbound: a.inbound,
          messages_sent: a.messagesSent,
          messages_avoided: A.messagesSent - a.messagesSent,
          deduplicated: a.duplicatesBlocked,
          superseded: a.supersessions,
          consolidated: a.consolidatedIntents,
          meta_cost: Number(a.metaCost),
          bsp_cost: Number(a.bspCost),
          infra_cost: Number(a.infraCost),
          total_cost: Number(a.totalCost),
          meta_savings_pct: c ? Number(c.metaSavingsPercent ?? 0) : 0,
          total_savings_pct: c ? Number(c.totalSavingsPercent ?? 0) : 0,
          free_fep: a.freeEntryPoint,
          free_quota: a.freeQuota,
          paid: a.paidMessages,
          unknown_pricing: a.unknownPricing,
          us_per_event: Math.round((a.durationMs * 1000) / Math.max(1, a.events)),
        });
      }
      console.log(`${scenario.padEnd(20)} ${String(size).padStart(8)} seed ${seed}  E: Meta −${rows.at(-2)!.meta_savings_pct}%  F: total −${rows.at(-1)!.total_savings_pct}%  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
}

// ---------------------------------------------------------------- aggregation (mean ± sd over seeds)
const stats = (xs: number[]) => {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: Math.round(mean * 100) / 100, sd: Math.round(sd * 100) / 100, min: Math.min(...xs), max: Math.max(...xs) };
};
const summary: Array<Record<string, string | number>> = [];
for (const size of sizes)
  for (const scenario of scenarios)
    for (const arm of ARMS.filter((a) => a.id !== "A")) {
      const sel = rows.filter((r) => r.size === size && r.scenario === scenario && r.arm === arm.id);
      if (!sel.length) continue;
      const m = stats(sel.map((r) => r.meta_savings_pct));
      const t = stats(sel.map((r) => r.total_savings_pct));
      const av = stats(sel.map((r) => r.messages_avoided));
      summary.push({ scenario, size, arm: arm.id, seeds: m.n, meta_savings_mean: m.mean, meta_savings_sd: m.sd, meta_savings_min: m.min, meta_savings_max: m.max, total_savings_mean: t.mean, total_savings_sd: t.sd, messages_avoided_mean: av.mean });
    }

writeFileSync(join(out, "matrix.csv"), stringify(rows as unknown as Array<Record<string, unknown>>, { header: true }));
writeFileSync(join(out, "summary.csv"), stringify(summary, { header: true }));

// ---------------------------------------------------------------- charts (table view = CSVs above)
const refSize = sizes.includes(50_000) ? 50_000 : sizes[sizes.length - 1]!;
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const meanOf = (scenario: ScenarioName, arm: string, key: "meta_savings_pct" | "total_savings_pct") => {
  const sel = rows.filter((r) => r.size === refSize && r.scenario === scenario && r.arm === arm);
  return sel.length ? sel.reduce((a, r) => a + r[key], 0) / sel.length : NaN;
};
const charts: Record<string, string> = {};
for (const dim of ["DUPLICATION", "AGGREGATION", "FEP"] as const) {
  const scen = (["LOW", "MEDIUM", "HIGH"] as const).map((l) => `${l}_${dim}` as ScenarioName).filter((s) => scenarios.includes(s));
  if (scen.length < 2) continue;
  const x = (s: ScenarioName) => rows.find((r) => r.scenario === s)!.parameter;
  const label = { DUPLICATION: "Taxa de duplicação na origem", AGGREGATION: "Pedidos com atualizações em rajada", FEP: "Conversas iniciadas por anúncio (FEP)" }[dim];
  charts[`research_${dim.toLowerCase()}.svg`] = lineChart({
    title: `Economia Meta por técnica — cenários ${dim}`,
    subtitle: `Simulado · ${refSize.toLocaleString("pt-BR")} eventos · média de ${seeds.length} seed(s) · ${demo ? "tarifas DEMO" : "rate card importado"}`,
    xLabel: label,
    yLabel: "Economia Meta vs A (%)",
    series: [
      { name: "B · deduplicação", points: scen.map((s) => ({ x: x(s), y: meanOf(s, "B", "meta_savings_pct") })) },
      { name: "D · + supersession e agregação", points: scen.map((s) => ({ x: x(s), y: meanOf(s, "D", "meta_savings_pct") })) },
      { name: "E · + otimizador de preço", points: scen.map((s) => ({ x: x(s), y: meanOf(s, "E", "meta_savings_pct") })) },
    ],
    xFormat: (v) => pct(v * 100),
    yFormat: pct,
  });
}
charts["research_total_savings_by_scenario.svg"] = barChart({
  title: "Economia total (Meta + BSP + infra) — braço F vs A",
  subtitle: `Simulado · ${refSize.toLocaleString("pt-BR")} eventos · média de ${seeds.length} seed(s) · BSP hipotético de 10%`,
  yLabel: "Economia total (%)",
  bars: scenarios.map((s) => ({ label: s.replace("_", " ").replace("DUPLICATION", "DUP").replace("AGGREGATION", "AGG"), value: Math.round(meanOf(s, "F", "total_savings_pct") * 10) / 10 })),
  yFormat: pct,
  width: 900,
});
for (const [name, svg] of Object.entries(charts)) writeFileSync(join(out, "charts", name), svg);

// ---------------------------------------------------------------- report
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout */
}
const L: string[] = [];
L.push("# Matriz do experimento acadêmico (braços A–F)");
L.push("");
L.push(`> **Resultados SIMULADOS** ${demo ? "com o rate card **DEMO** (valores fictícios, não são tarifas da Meta)" : "com rate card importado"}. Não representam economia garantida.`);
L.push("");
L.push(`- Gerado em ${new Date().toISOString()} · commit \`${commit}\` · Node ${process.version} · duração ${((Date.now() - started) / 1000).toFixed(0)} s`);
L.push(`- Tamanhos: ${sizes.map((s) => s.toLocaleString("pt-BR")).join(", ")} eventos · cenários: ${scenarios.length} · seeds: ${seeds.join(", ")}`);
L.push("- Desenho pareado: para cada (cenário, tamanho, seed) o MESMO dataset é reprocessado por todos os braços.");
L.push("- Reproduzir: `pnpm research --sizes " + sizes.join(",") + " --seeds " + seeds.length + "`");
L.push("");
L.push("## Economia Meta média por braço (vs controle A)");
L.push("");
L.push(`| Cenário | Tamanho | B | C | D | E | F (total) | Mensagens evitadas (E) |`);
L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const size of sizes)
  for (const scenario of scenarios) {
    const g = (arm: string, k: string) => summary.find((s) => s.size === size && s.scenario === scenario && s.arm === arm)?.[k];
    const cell = (arm: string) => `${g(arm, "meta_savings_mean")}% ± ${g(arm, "meta_savings_sd")}`;
    L.push(`| ${scenario} | ${size.toLocaleString("pt-BR")} | ${cell("B")} | ${cell("C")} | ${cell("D")} | ${cell("E")} | ${g("F", "total_savings_mean")}% ± ${g("F", "total_savings_sd")} | ${Number(g("E", "messages_avoided_mean")).toLocaleString("pt-BR")} |`);
  }
L.push("");
L.push("Valores: média ± desvio-padrão amostral entre seeds. B–E: economia no custo Meta. F: economia total (Meta + BSP + infraestrutura), pois F remove a taxa de BSP hipotética.");
L.push("");
const allE = rows.filter((r) => r.arm === "E");
const positive = allE.filter((r) => r.meta_savings_pct > 0).length;
L.push("## Teste da hipótese H1");
L.push("");
L.push(`H1: *o braço com todas as técnicas de otimização (E) tem custo Meta menor que o controle (A) no mesmo dataset.* Em ${positive} de ${allE.length} execuções pareadas a economia Meta de E foi positiva (mínimo ${Math.min(...allE.map((r) => r.meta_savings_pct))}%, máximo ${Math.max(...allE.map((r) => r.meta_savings_pct))}%).`);
L.push("");
L.push("Monotonicidade esperada: B ≤ C ≤ D ≤ E em economia Meta (cada braço adiciona técnicas ao anterior).");
const violations = [];
for (const size of sizes)
  for (const scenario of scenarios)
    for (const seed of seeds) {
      const v = ["B", "C", "D", "E"].map((a) => rows.find((r) => r.size === size && r.scenario === scenario && r.seed === seed && r.arm === a)?.meta_savings_pct ?? 0);
      for (let i = 1; i < v.length; i++) if (v[i]! + 0.01 < v[i - 1]!) violations.push(`${scenario}/${size}/${seed}: ${["B", "C", "D", "E"][i - 1]}=${v[i - 1]}% > ${["B", "C", "D", "E"][i]}=${v[i]}%`);
    }
L.push(violations.length ? `Violações observadas (${violations.length}) — ver discussão em ACADEMIC-EXPERIMENT.md:\n${violations.map((v) => `- ${v}`).join("\n")}` : "Nenhuma violação de monotonicidade observada.");
L.push("");
L.push("## Desempenho");
L.push("");
const perf = rows.filter((r) => r.arm === "E");
L.push(`Tempo médio de simulação do braço E: ${Math.round(perf.reduce((a, r) => a + r.us_per_event, 0) / perf.length)} µs/evento (processo único, motor em memória — não é o throughput do sistema com PostgreSQL/Redis).`);
L.push("");
L.push("## Arquivos");
L.push("");
L.push("- `matrix.csv` — uma linha por (cenário, tamanho, seed, braço)");
L.push("- `summary.csv` — média, desvio, mínimo e máximo por (cenário, tamanho, braço)");
L.push("- `charts/*.svg` — gráficos (mesmos dados das tabelas acima)");
L.push("");
writeFileSync(join(out, "REPORT.md"), L.join("\n"));
console.log(`\nRelatório: ${join(out, "REPORT.md")}  (${rows.length} linhas, ${((Date.now() - started) / 1000).toFixed(0)} s)`);
