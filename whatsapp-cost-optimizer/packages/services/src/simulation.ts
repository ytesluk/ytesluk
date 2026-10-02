import { z } from "zod";
import { BillingCategory } from "@wco/domain";
import { compareDirectVsBsp, simulateRateCard } from "@wco/pricing";
import { DEFAULT_SCENARIO, importHistory, runExperiment, simulateSavings, type ScenarioParams } from "@wco/simulator";
import { audit } from "./audit";
import type { Actor, AppContext } from "./context";

/**
 * Simulators exposed to the dashboard (spec §16, §37, §38, §39, §66). All use the policies and rate cards
 * stored in the database; every output is labelled ESTIMATED/SIMULATED — never guaranteed savings.
 */
const Bsp = z.object({
  type: z.enum(["NONE", "PERCENTAGE", "FIXED_PER_MESSAGE", "MONTHLY", "MIXED"]),
  percentOfMeta: z.string().optional(),
  perMessage: z.string().optional(),
  perMessageAppliesTo: z.enum(["ALL_SENT", "BILLABLE_ONLY"]).optional(),
  monthlyFee: z.string().optional(),
});

export const SavingsSimulationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  market: z.string().default("BR"),
  currency: z.string().length(3).default("BRL"),
  customers: z.number().int().min(1).default(10_000),
  monthlyMessages: z.number().int().min(1).max(500_000_000),
  mix: z.object({ marketing: z.number().min(0), utility: z.number().min(0), authentication: z.number().min(0), service: z.number().min(0) }),
  duplicateRate: z.number().min(0).max(1).default(0),
  consolidationRate: z.number().min(0).max(1).default(0),
  supersessionRate: z.number().min(0).max(1).default(0),
  fepEligibilityPercent: z.number().min(0).max(100).default(0),
  windowCaptureImprovement: z.number().min(0).max(100).default(0),
  freeQuotaPerPhoneNumber: z.number().int().min(0).optional(),
  phoneNumbers: z.number().int().min(1).default(1),
  currentTierPosition: z.number().int().min(0).default(0),
  deliveryRate: z.number().min(0).max(1).default(0.97),
  bsp: Bsp.optional(),
  infraFeePerMessage: z.string().optional(),
});

export async function savingsSimulation(ctx: AppContext, raw: unknown) {
  const input = SavingsSimulationSchema.parse(raw);
  const engine = await ctx.pricing.engine();
  return simulateSavings({ ...input, date: input.date ?? ctx.now().toISOString().slice(0, 10) }, engine.policies, engine.rates);
}

export const RateCardSimulationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  market: z.string().default("BR"),
  currency: z.string().length(3).default("BRL"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "AUTHENTICATION_INTERNATIONAL", "SERVICE"]),
  monthlyMessages: z.number().int().min(1).max(500_000_000),
  currentTierPosition: z.number().int().min(0).default(0),
  deliveryRate: z.number().min(0).max(1).default(0.97),
  freeQuota: z.number().int().min(0).optional(),
  phoneNumbers: z.number().int().min(1).default(1),
  fepPercent: z.number().min(0).max(100).default(0),
  serviceWindowPercent: z.number().min(0).max(100).default(0),
  bsp: Bsp.optional(),
  infraFeePerMessage: z.string().optional(),
  optimizationReductionPercent: z.number().min(0).max(100).default(0),
  windowShiftPercent: z.number().min(0).max(100).default(0),
});

export async function rateCardSimulation(ctx: AppContext, raw: unknown) {
  const input = RateCardSimulationSchema.parse(raw);
  const engine = await ctx.pricing.engine();
  return simulateRateCard({ ...input, category: input.category as BillingCategory, date: input.date ?? ctx.now().toISOString().slice(0, 10) }, engine.policies, engine.rates);
}

export const BspComparisonSchema = z.object({
  currency: z.string().length(3).default("BRL"),
  metaMonthlyCost: z.string(),
  monthlyMessages: z.number().int().min(0),
  billableMessages: z.number().int().min(0).optional(),
  bsp: Bsp,
  directMonthlyExtra: z.string().optional(),
  bspMonthlyExtra: z.string().optional(),
});

export function bspComparison(raw: unknown) {
  return compareDirectVsBsp(BspComparisonSchema.parse(raw));
}

export const HistoryImportSchema = z.object({ content: z.string().min(10).max(50_000_000), filename: z.string().default("history.csv") });

export async function historyImport(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = HistoryImportSchema.parse(raw);
  const tenant = await ctx.tenants.get(actor.tenantId);
  const engine = await ctx.pricing.engine();
  const job = await ctx.db.importJob.create({ data: { tenantId: actor.tenantId, type: "HISTORY_CSV", filename: input.filename, status: "RUNNING", createdBy: actor.id } });
  try {
    const result = importHistory(input.content, { timezone: tenant.defaultTimezone, currency: tenant.defaultCurrency, rates: engine.rates });
    await ctx.db.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", rowCount: result.rows, errorCount: result.invalid, errors: result.errors as never, report: { ...result, replay: result.replay ? { control: summarizeArm(result.replay.control), optimized: summarizeArm(result.replay.optimized) } : null } as never, finishedAt: ctx.now() } });
    await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "import.history", entityType: "ImportJob", entityId: job.id, data: { rows: result.rows, invalid: result.invalid } });
    return { jobId: job.id, ...result };
  } catch (e) {
    await ctx.db.importJob.update({ where: { id: job.id }, data: { status: "FAILED", errors: [{ message: (e as Error).message }] as never, finishedAt: ctx.now() } });
    throw e;
  }
}

function summarizeArm(a: { arm: string; messagesSent: number; metaCost: string; messagesAvoided: number; freeEntryPoint: number; freeQuota: number }) {
  return { arm: a.arm, messagesSent: a.messagesSent, metaCost: a.metaCost, messagesAvoided: a.messagesAvoided, freeEntryPoint: a.freeEntryPoint, freeQuota: a.freeQuota };
}

export const ResearchSchema = z.object({
  name: z.string().default("dashboard-run"),
  events: z.number().int().min(100).max(20_000).default(5_000),
  customers: z.number().int().min(10).max(20_000).default(1_500),
  seed: z.number().int().default(DEFAULT_SCENARIO.seed),
  duplicateRate: z.number().min(0).max(1).default(DEFAULT_SCENARIO.duplicateRate),
  burstRate: z.number().min(0).max(1).default(DEFAULT_SCENARIO.burstRate),
  fepRate: z.number().min(0).max(1).default(DEFAULT_SCENARIO.fepRate),
  days: z.number().int().min(1).max(31).default(30),
});

/** Research / academic simulation from the dashboard (small runs; large runs via `pnpm research`). */
export async function runResearch(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = ResearchSchema.parse(raw);
  const engine = await ctx.pricing.engine();
  const params: ScenarioParams = { ...DEFAULT_SCENARIO, ...input, name: input.name, start: new Date(`${ctx.now().toISOString().slice(0, 7)}-01T03:00:00.000Z`).toISOString() };
  const run = await ctx.db.experimentRun.create({ data: { tenantId: actor.tenantId, name: input.name, params: params as never, status: "RUNNING", createdBy: actor.id } });
  const result = runExperiment(params, { rates: engine.rates });
  await ctx.db.experimentRun.update({ where: { id: run.id }, data: { status: "COMPLETED", results: result as never, finishedAt: ctx.now() } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "research.run", entityType: "ExperimentRun", entityId: run.id, data: { events: input.events } });
  return { runId: run.id, ...result };
}

export async function listResearchRuns(ctx: AppContext, tenantId: string) {
  return ctx.db.experimentRun.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, status: true, createdAt: true, finishedAt: true, params: true, results: true } });
}
