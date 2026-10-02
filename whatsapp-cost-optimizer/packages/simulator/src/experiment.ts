import { Money, money, percentage, type Decimal } from "@wco/domain";
import { BUILTIN_POLICIES, CostEngine, PolicyRegistry, bspCost, demoRateCatalog, type BspFeeModel, type RateCatalog } from "@wco/pricing";
import { DEFAULT_OPTIMIZATION_POLICIES, DEFAULT_RULESET, PolicyEngine, type OptimizationPolicyConfig } from "@wco/policy";
import {
  ALL_FEATURES,
  DEMO_TEMPLATE_INFOS,
  InMemoryPipeline,
  NO_FEATURES,
  type OptimizationFeatures,
  type PipelineReport,
} from "@wco/optimization";
import { generateDataset, type DatasetEvent, type ScenarioParams } from "./dataset";

/**
 * Academic experiment runner (spec §39, §77). Every arm replays THE SAME dataset through the same
 * production engines; only the feature switches change:
 *
 *   A — no optimization (control)            D — C + aggregation (consolidation)
 *   B — deduplication                         E — D + pricing optimizer (window/quota/channel aware)
 *   C — B + supersession (with buffering)     F — all techniques (E + direct Cloud API, no BSP fees)
 *
 * Costs are SIMULATED with the DEMO rate card unless a real rate catalog is supplied. Meta, BSP and
 * infrastructure costs are reported separately (spec §13).
 */
export interface ArmSpec {
  id: "A" | "B" | "C" | "D" | "E" | "F";
  label: string;
  features: OptimizationFeatures;
  /** F: the operation talks to the Cloud API directly (no BSP fees). */
  direct: boolean;
  /** Arm A represents "without WCO": no WCO processing overhead. */
  wco: boolean;
}

export const ARMS: ArmSpec[] = [
  { id: "A", label: "Sem otimização (controle)", features: NO_FEATURES, direct: false, wco: false },
  { id: "B", label: "Deduplicação", features: { ...NO_FEATURES, deduplication: true }, direct: false, wco: true },
  { id: "C", label: "Dedup + supersession", features: { ...NO_FEATURES, deduplication: true, supersession: true, debounce: true }, direct: false, wco: true },
  { id: "D", label: "Dedup + supersession + agregação", features: { ...NO_FEATURES, deduplication: true, supersession: true, debounce: true, aggregation: true }, direct: false, wco: true },
  { id: "E", label: "D + otimizador de preço", features: ALL_FEATURES, direct: false, wco: true },
  { id: "F", label: "Todas as técnicas (E + Cloud API direta)", features: ALL_FEATURES, direct: true, wco: true },
];

export interface CostModel {
  /** BSP fee model of the baseline operation (assumption — NOT every BSP charges a markup). */
  bsp: BspFeeModel;
  /** WCO processing overhead per event (queue, DB, CPU). */
  infraPerEvent: string;
  /** Infrastructure cost per provider API call (client-side). */
  infraPerProviderCall: string;
}

export const DEFAULT_COST_MODEL: CostModel = {
  bsp: { type: "PERCENTAGE", percentOfMeta: "10", label: "Hypothetical BSP: 10% over Meta charges" },
  infraPerEvent: "0.00002",
  infraPerProviderCall: "0.00005",
};

export interface ArmResult {
  arm: ArmSpec["id"];
  label: string;
  events: number;
  inbound: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
  duplicatesBlocked: number;
  supersessions: number;
  consolidatedIntents: number;
  consolidatedMessages: number;
  blocked: number;
  cancelled: number;
  messagesAvoided: number;
  metaCost: string;
  metaCostEstimated: string;
  bspCost: string;
  infraCost: string;
  totalCost: string;
  averageCostPerDelivered: string;
  freeEntryPoint: number;
  freeCustomerServiceWindow: number;
  freeQuota: number;
  freeNotBillable: number;
  paidMessages: number;
  unknownPricing: number;
  quotaAvailable: number;
  quotaUtilization: number;
  freeWindowUtilization: number;
  tierDistribution: Record<string, number>;
  byCategory: Record<string, { dispatched: number; delivered: number; paid: number; free: number; cost: string }>;
  daily: Record<string, { dispatched: number; delivered: number; cost: string }>;
  avoidedBaselineEstimate: string;
  policyVersions: Record<string, number>;
  rateCards: Record<string, number>;
  durationMs: number;
}

export interface Comparison {
  arm: ArmSpec["id"];
  metaSavings: string;
  bspSavings: string;
  infraSavings: string;
  totalSavings: string;
  totalSavingsPercent: string | null;
  metaSavingsPercent: string | null;
  estimatedMetaSavings: string;
  realizedMetaSavings: string;
  messagesAvoided: number;
}

export interface ExperimentResult {
  scenario: ScenarioParams;
  currency: string;
  isDemoRates: boolean;
  costModel: CostModel;
  datasetSize: { intents: number; inbound: number };
  arms: ArmResult[];
  comparisons: Comparison[];
  generatedAt: string;
  label: "SIMULATED";
}

export interface ExperimentDeps {
  rates?: RateCatalog;
  policies?: OptimizationPolicyConfig[];
  costModel?: CostModel;
  arms?: ArmSpec[];
  onProgress?: (msg: string) => void;
}

const f = (d: Decimal, dp = 4) => d.toDecimalPlaces(dp).toFixed(dp);

export function runArm(dataset: DatasetEvent[], params: ScenarioParams, arm: ArmSpec, deps: ExperimentDeps = {}): ArmResult {
  const started = Date.now();
  const rates = deps.rates ?? demoRateCatalog();
  const engine = new CostEngine(new PolicyRegistry(BUILTIN_POLICIES), rates);
  const costModel = deps.costModel ?? DEFAULT_COST_MODEL;
  const p = new InMemoryPipeline({
    tenantId: "sim",
    timezone: params.timezone,
    currency: params.currency,
    engine,
    rules: new PolicyEngine(DEFAULT_RULESET),
    policies: deps.policies ?? DEFAULT_OPTIMIZATION_POLICIES,
    templates: DEMO_TEMPLATE_INFOS,
    features: arm.features,
    deliveryRate: params.deliveryRate,
    explain: false,
    recordDecisions: false,
    retentionSeconds: 8 * 86_400,
  });
  let inbound = 0;
  for (const e of dataset) {
    if (e.kind === "INBOUND") {
      inbound++;
      p.inbound(e.customerKey, e.phoneNumberId, new Date(e.at), e.entryPoint);
    } else {
      p.submit(e.sub, new Date(e.at));
    }
  }
  const r: PipelineReport = p.drain();
  const meta = r.realizedCost;
  const bsp = arm.direct ? new Money(0) : bspCost(costModel.bsp, { metaCost: meta, messagesSent: r.messagesDispatched, billableMessages: r.paidMessages }).total;
  const infra = money(costModel.infraPerProviderCall).times(r.messagesDispatched).plus(arm.wco ? money(costModel.infraPerEvent).times(r.intents) : 0);
  const total = meta.plus(bsp).plus(infra);
  const months = Math.max(1, Math.round(params.days / 30));
  const quotaAvailable = 1000 * params.phoneNumbers * months;
  const delivered = r.messagesDelivered;
  return {
    arm: arm.id,
    label: arm.label,
    events: r.intents,
    inbound,
    messagesSent: r.messagesDispatched,
    messagesDelivered: delivered,
    messagesFailed: r.messagesFailed,
    duplicatesBlocked: r.deduplicated,
    supersessions: r.superseded,
    consolidatedIntents: r.consolidatedIntents,
    consolidatedMessages: r.consolidatedMessages,
    blocked: r.blocked,
    cancelled: r.cancelled,
    messagesAvoided: r.deduplicated + r.superseded + r.consolidatedIntents,
    metaCost: f(meta),
    metaCostEstimated: f(r.estimatedCost),
    bspCost: f(bsp),
    infraCost: f(infra),
    totalCost: f(total),
    averageCostPerDelivered: delivered ? f(meta.dividedBy(delivered), 6) : "0",
    freeEntryPoint: r.free.entryPoint,
    freeCustomerServiceWindow: r.free.customerServiceWindow,
    freeQuota: r.free.quota,
    freeNotBillable: r.free.notBillable,
    paidMessages: r.paidMessages,
    unknownPricing: r.unknownPricing,
    quotaAvailable,
    quotaUtilization: quotaAvailable ? Math.round((r.free.quota / quotaAvailable) * 10000) / 100 : 0,
    freeWindowUtilization: delivered ? Math.round(((r.free.entryPoint + r.free.customerServiceWindow) / delivered) * 10000) / 100 : 0,
    tierDistribution: r.tiers,
    byCategory: Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, { dispatched: v.dispatched, delivered: v.delivered, paid: v.paid, free: v.free, cost: f(v.realizedCost) }])),
    daily: Object.fromEntries(Object.entries(r.daily).sort().map(([k, v]) => [k, { dispatched: v.dispatched, delivered: v.delivered, cost: f(v.cost) }])),
    avoidedBaselineEstimate: f(r.avoidedBaselineEstimate),
    policyVersions: r.policyVersions,
    rateCards: r.rateCards,
    durationMs: Date.now() - started,
  };
}

export function compare(control: ArmResult, arm: ArmResult): Comparison {
  const d = (a: string, b: string) => money(a).minus(money(b));
  const total = d(control.totalCost, arm.totalCost);
  const meta = d(control.metaCost, arm.metaCost);
  const pct = percentage(total, control.totalCost);
  const metaPct = percentage(meta, control.metaCost);
  return {
    arm: arm.arm,
    metaSavings: f(meta),
    bspSavings: f(d(control.bspCost, arm.bspCost)),
    infraSavings: f(d(control.infraCost, arm.infraCost)),
    totalSavings: f(total),
    totalSavingsPercent: pct ? pct.toFixed(2) : null,
    metaSavingsPercent: metaPct ? metaPct.toFixed(2) : null,
    estimatedMetaSavings: f(d(control.metaCostEstimated, arm.metaCostEstimated)),
    realizedMetaSavings: f(meta),
    messagesAvoided: control.messagesSent - arm.messagesSent,
  };
}

export function runExperiment(params: ScenarioParams, deps: ExperimentDeps = {}, dataset?: DatasetEvent[]): ExperimentResult {
  const data = dataset ?? generateDataset(params);
  const arms = deps.arms ?? ARMS;
  const results: ArmResult[] = [];
  for (const arm of arms) {
    deps.onProgress?.(`arm ${arm.id} (${arm.label})`);
    results.push(runArm(data, params, arm, deps));
  }
  const control = results.find((r) => r.arm === "A") ?? results[0]!;
  const rates = deps.rates ?? demoRateCatalog();
  return {
    scenario: params,
    currency: params.currency,
    isDemoRates: rates.cards.every((c) => c.meta.isDemo),
    costModel: deps.costModel ?? DEFAULT_COST_MODEL,
    datasetSize: { intents: data.filter((e) => e.kind === "INTENT").length, inbound: data.filter((e) => e.kind === "INBOUND").length },
    arms: results,
    comparisons: results.filter((r) => r !== control).map((r) => compare(control, r)),
    generatedAt: new Date().toISOString(),
    label: "SIMULATED",
  };
}
