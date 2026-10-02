/**
 * pnpm simulate — the mandatory final simulation (spec §112): 100,000 business events replayed
 * through the production optimization and pricing engines, arms A–F (spec §77).
 *
 *   pnpm simulate                                   100k events, DEMO rates → reports/final-100k/
 *   pnpm simulate --events 20000 --out reports/runs/quick --no-sweeps
 *   pnpm simulate --scenario HIGH_DUPLICATION       one of the §40 presets
 *   pnpm simulate --dataset data/datasets/100000/MEDIUM_DUPLICATION.csv   replay a generated file
 *   pnpm simulate --rate-card my-card.json          use an imported (real) rate card instead of DEMO
 *   pnpm simulate --seed 42 --days 30 --customers 20000
 *
 * Output: REPORT.md, results.json, arms/comparisons/tiers/daily CSVs (table view of each chart),
 * SVG charts. Results are SIMULATED — never guaranteed savings.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { RateCatalog, importRateCard } from "@wco/pricing";
import {
  DEFAULT_SCENARIO,
  SCENARIOS,
  datasetStats,
  generateDataset,
  readDatasetCsv,
  runExperiment,
  scenarioPreset,
  standardSweeps,
  writeReport,
  type ExperimentDeps,
  type ScenarioName,
  type ScenarioParams,
} from "@wco/simulator";

const { values } = parseArgs({
  options: {
    events: { type: "string" },
    customers: { type: "string" },
    days: { type: "string" },
    seed: { type: "string" },
    scenario: { type: "string" },
    dataset: { type: "string" },
    "rate-card": { type: "string" },
    out: { type: "string" },
    "no-sweeps": { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
  },
});

const log = (...a: unknown[]) => {
  if (!values.quiet) console.log(...a);
};

const base: ScenarioParams = values.scenario
  ? (() => {
      if (!SCENARIOS.includes(values.scenario as ScenarioName)) throw new Error(`cenário inválido: ${values.scenario} (use ${SCENARIOS.join(", ")})`);
      return scenarioPreset(values.scenario as ScenarioName);
    })()
  : { ...DEFAULT_SCENARIO, name: "final-100k" };
const params: ScenarioParams = {
  ...base,
  events: values.events ? Number(values.events) : base.events,
  customers: values.customers ? Number(values.customers) : values.events ? Math.max(2_000, Math.round(Number(values.events) / 5)) : base.customers,
  days: values.days ? Number(values.days) : base.days,
  seed: values.seed ? Number(values.seed) : base.seed,
};

const deps: ExperimentDeps = { onProgress: (m) => log(`  · ${m}`) };
if (values["rate-card"]) {
  const r = importRateCard(readFileSync(values["rate-card"], "utf8"), {});
  if (!r.ok || !r.card) throw new Error(`rate card inválido: ${r.issues.map((i) => i.message).join("; ")}`);
  if (r.card.meta.currency !== params.currency) params.currency = r.card.meta.currency;
  deps.rates = new RateCatalog([r.card]);
  log(`Rate card importado: ${r.card.meta.name} (${r.card.meta.currency}, ${r.rows.length} linhas${r.card.meta.isDemo ? ", DEMO" : ""})`);
}

const out = values.out ?? (values.events || values.scenario || values.dataset ? `reports/runs/${params.name}-${params.events}` : "reports/final-100k");

const t0 = Date.now();
let dataset;
if (values.dataset) {
  const raw = readFileSync(values.dataset);
  dataset = readDatasetCsv(values.dataset.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
  params.name = values.dataset.split("/").pop()!.replace(/\.csv(\.gz)?$/, "");
  log(`Dataset lido de ${values.dataset}: ${dataset.length} eventos`);
} else {
  log(`Gerando dataset "${params.name}" (${params.events.toLocaleString("pt-BR")} eventos, seed ${params.seed})…`);
  dataset = generateDataset(params);
}
log("Estatísticas do dataset:", JSON.stringify(datasetStats(dataset)));

log("Executando braços A–F…");
const result = runExperiment(params, deps, dataset);
const sweeps = values["no-sweeps"] ? [] : (log("Executando varreduras de parâmetros…"), standardSweeps(params, deps));
const files = writeReport(out, result, sweeps, {
  title: values.out || values.events || values.scenario || values.dataset ? "Simulação" : "Simulação final obrigatória (100.000 eventos)",
  notes: [
    "Cada braço reprocessa exatamente o mesmo dataset com os mesmos motores de produção (OptimizationEngine, PricingPolicy, TierCalculator); só os recursos habilitados mudam.",
    "'Estimada' = custo previsto no momento da decisão; 'Realizada' = custo da entrega simulada (no sistema real, confirmada pelo objeto pricing dos webhooks da Meta).",
    "Mensagens com preço desconhecido (UNKNOWN) não são contadas como economia.",
    `Tempo de execução: ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
  ],
});

const A = result.arms.find((a) => a.arm === "A")!;
const E = result.arms.find((a) => a.arm === "E")!;
const F = result.arms.find((a) => a.arm === "F")!;
const cF = result.comparisons.find((c) => c.arm === "F")!;
const cE = result.comparisons.find((c) => c.arm === "E")!;
const money = (v: string) => `${result.currency} ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

console.log("");
console.log(`=== Resultado SIMULADO — ${result.isDemoRates ? "tarifas DEMO (fictícias)" : "rate card importado"} ===`);
console.log(`Eventos de negócio: ${result.datasetSize.intents.toLocaleString("pt-BR")} · mensagens de clientes: ${result.datasetSize.inbound.toLocaleString("pt-BR")}`);
console.log(`Custo baseline (A, sem WCO):      Meta ${money(A.metaCost)} · BSP ${money(A.bspCost)} · infra ${money(A.infraCost)} · total ${money(A.totalCost)}`);
console.log(`Custo otimizado (E, via BSP):     Meta ${money(E.metaCost)} · BSP ${money(E.bspCost)} · infra ${money(E.infraCost)} · total ${money(E.totalCost)}`);
console.log(`Custo otimizado (F, Cloud API):   Meta ${money(F.metaCost)} · BSP ${money(F.bspCost)} · infra ${money(F.infraCost)} · total ${money(F.totalCost)}`);
console.log(`Economia Meta (E vs A):           estimada ${money(cE.estimatedMetaSavings)} · realizada (simulada) ${money(cE.realizedMetaSavings)} (${cE.metaSavingsPercent}%)`);
console.log(`Economia total (F vs A):          ${money(cF.totalSavings)} (${cF.totalSavingsPercent}%) — Meta ${money(cF.metaSavings)}, BSP ${money(cF.bspSavings)}, infra ${money(cF.infraSavings)}`);
console.log(`Mensagens: A ${A.messagesSent} → E ${E.messagesSent} (evitadas ${E.messagesAvoided}: dedup ${E.duplicatesBlocked}, supersession ${E.supersessions}, consolidadas ${E.consolidatedIntents} em ${E.consolidatedMessages} mensagens)`);
console.log(`Gratuidade (E): FEP ${E.freeEntryPoint} · CSW ${E.freeCustomerServiceWindow} · cota ${E.freeQuota}/${E.quotaAvailable} (${E.quotaUtilization}%) · pagas ${E.paidMessages} · preço desconhecido ${E.unknownPricing}`);
console.log(`Tiers (E): ${Object.entries(E.tierDistribution).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`Relatório: ${out}/REPORT.md (${files.length} arquivos)`);
