import { z } from "zod";
import { Money, money, percentage, type Decimal } from "@wco/domain";
import { Prisma } from "@wco/database";
import { detectCostAnomaly, opportunities, recommend, type EventTypeStats } from "@wco/optimization";
import { bspCost, type BspFeeModel } from "@wco/pricing";
import type { AppContext } from "./context";
import { queueDepths } from "./queues";

export const RangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function range(q: z.infer<typeof RangeQuery>, now: Date): { from: Date; to: Date } {
  const to = q.to ?? now;
  const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

const D = (v: unknown): Decimal => money(v === null || v === undefined ? 0 : String(v));
const f2 = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
const f4 = (d: Decimal) => d.toDecimalPlaces(4).toFixed(4);

/** Dashboard summary (spec §34, §35). META, BSP and INFRASTRUCTURE are never merged silently. */
export async function summary(ctx: AppContext, tenantId: string, q: z.infer<typeof RangeQuery>) {
  const { from, to } = range(q, ctx.now());
  const tenant = await ctx.tenants.get(tenantId);
  const [statusRows, costRow, savingsRows, freeRows, consolidatedRow, demoRow] = await Promise.all([
    ctx.db.messageIntent.groupBy({ by: ["status"], where: { tenantId, requestedAt: { gte: from, lte: to } }, _count: { _all: true } }),
    ctx.db.$queryRaw<Array<{ baseline: string | null; realized: string | null; realized_n: bigint; pending_estimated: string | null; currency: string | null }>>`
      SELECT
        SUM("baselineCost") FILTER (WHERE status NOT IN ('BLOCKED','CANCELLED')) AS baseline,
        SUM("realizedCost") FILTER (WHERE "realizedCost" IS NOT NULL) AS realized,
        COUNT(*) FILTER (WHERE "realizedConfidence" = 'REALIZED') AS realized_n,
        SUM("estimatedCost") FILTER (WHERE "realizedCost" IS NULL AND status IN ('READY_TO_SEND','QUEUED','SENDING','SENT','DELAYED')) AS pending_estimated,
        MAX(currency) AS currency
      FROM "MessageIntent" WHERE "tenantId" = ${tenantId}::uuid AND "requestedAt" BETWEEN ${from} AND ${to}`,
    ctx.db.savingsRecord.groupBy({ by: ["kind", "confidence", "mechanism"], where: { tenantId, day: { gte: new Date(from.toISOString().slice(0, 10)), lte: to } }, _sum: { savings: true }, _count: { _all: true } }),
    ctx.db.$queryRaw<Array<{ free_reason: string | null; n: bigint }>>`
      SELECT c."freeReason" AS free_reason, COUNT(*) AS n FROM "CostDecision" c
      JOIN "MessageIntent" i ON i.id = c."messageIntentId"
      WHERE c."tenantId" = ${tenantId}::uuid AND c.kind = 'REALIZED' AND i."requestedAt" BETWEEN ${from} AND ${to}
      GROUP BY c."freeReason"`,
    ctx.db.$queryRaw<Array<{ n: bigint; covered: bigint | null }>>`
      SELECT COUNT(*) AS n, SUM(cardinality("coveredIntentIds")) AS covered FROM "MessageAttempt"
      WHERE "tenantId" = ${tenantId}::uuid AND cardinality("coveredIntentIds") > 1 AND "requestedAt" BETWEEN ${from} AND ${to}`,
    ctx.db.$queryRaw<Array<{ demo: boolean }>>`SELECT bool_or("isDemo") AS demo FROM "PriceCatalogImport" WHERE status = 'ACTIVE'`,
  ]);
  const by = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all])) as Record<string, number>;
  const n = (k: string) => by[k] ?? 0;
  const intents = Object.values(by).reduce((a, b) => a + b, 0);
  const sent = n("SENT") + n("DELIVERED") + n("READ") + n("FAILED");
  const delivered = n("DELIVERED") + n("READ");
  const avoided = n("DEDUPLICATED") + n("SUPERSEDED") + n("CONSOLIDATED");
  const c = costRow[0];
  const currency = c?.currency ?? tenant.defaultCurrency;
  const baseline = D(c?.baseline);
  const realized = D(c?.realized);
  const withWco = realized.plus(D(c?.pending_estimated));
  const savingsBy = (pred: (r: (typeof savingsRows)[number]) => boolean) => savingsRows.filter(pred).reduce((a, r) => a.plus(D(r._sum.savings)), new Money(0) as Decimal);
  const metaEstimated = savingsBy((r) => r.kind === "META");
  const metaRealized = savingsBy((r) => r.kind === "META" && r.confidence === "REALIZED");
  const bspSav = savingsBy((r) => r.kind === "BSP");
  const infraSav = savingsBy((r) => r.kind === "INFRASTRUCTURE");
  const bspModel = (tenant.bspFeeModel as BspFeeModel | null) ?? null;
  const bspCostWco = tenant.usesBsp ? bspCost(bspModel, { metaCost: withWco, messagesSent: sent, billableMessages: sent }).total : new Money(0);
  const bspCostBaseline = tenant.usesBsp ? bspCost(bspModel, { metaCost: baseline, messagesSent: sent + avoided, billableMessages: sent + avoided }).total : new Money(0);
  const perCall = money(ctx.config.env.INFRA_COST_PER_PROVIDER_CALL);
  const perEvent = money(ctx.config.env.INFRA_COST_PER_MESSAGE_PROCESSED);
  const infraWco = perCall.times(sent).plus(perEvent.times(intents));
  const infraBaseline = perCall.times(sent + avoided);
  const totalBaseline = baseline.plus(bspCostBaseline).plus(infraBaseline);
  const totalWco = withWco.plus(bspCostWco).plus(infraWco);
  const free = Object.fromEntries(freeRows.map((r) => [r.free_reason ?? "paid", Number(r.n)])) as Record<string, number>;
  return {
    range: { from, to },
    currency,
    isDemoRates: !!demoRow[0]?.demo,
    messages: {
      processed: intents,
      sent,
      delivered,
      read: n("READ"),
      failed: n("FAILED"),
      avoided,
      deduplicated: n("DEDUPLICATED"),
      superseded: n("SUPERSEDED"),
      consolidated: n("CONSOLIDATED"),
      consolidatedMessages: Number(consolidatedRow[0]?.n ?? 0),
      blocked: n("BLOCKED"),
      cancelled: n("CANCELLED"),
      pending: n("PENDING_OPTIMIZATION") + n("DELAYED") + n("READY_TO_SEND") + n("QUEUED") + n("SENDING"),
      byStatus: by,
    },
    costs: {
      metaWithoutWco: f2(baseline),
      metaWithWco: f2(withWco),
      metaRealized: f2(realized),
      realizedMessages: Number(c?.realized_n ?? 0),
      bsp: f2(bspCostWco),
      bspWithoutWco: f2(bspCostBaseline),
      infrastructure: f4(infraWco),
      infrastructureWithoutWco: f4(infraBaseline),
      totalWithoutWco: f2(totalBaseline),
      totalWithWco: f2(totalWco),
      savingsPercent: percentage(totalBaseline.minus(totalWco), totalBaseline)?.toFixed(1) ?? null,
    },
    savings: {
      estimated: { meta: f2(metaEstimated), bsp: f2(bspSav), infrastructure: f4(infraSav), total: f2(metaEstimated.plus(bspSav).plus(infraSav)) },
      realized: { meta: f2(metaRealized) },
      byMechanism: savingsRows.filter((r) => r.kind === "META").reduce<Record<string, string>>((acc, r) => {
        acc[r.mechanism] = f2(D(acc[r.mechanism]).plus(D(r._sum.savings)));
        return acc;
      }, {}),
      note: "Estimated: baseline is a counterfactual (cost without WCO). Realized: optimized side confirmed by Meta delivery webhooks.",
    },
    free: {
      entryPoint: free.free_entry_point_window ?? 0,
      customerServiceWindow: free.customer_service_window ?? 0,
      quota: free.free_monthly_quota ?? 0,
      other: free.not_billable ?? 0,
      paid: free.paid ?? 0,
    },
  };
}

/** Daily series for charts (spec §36) — computed in the WABA/tenant timezone. */
export async function daily(ctx: AppContext, tenantId: string, q: z.infer<typeof RangeQuery>) {
  const { from, to } = range(q, ctx.now());
  const tenant = await ctx.tenants.get(tenantId);
  const tz = tenant.defaultTimezone;
  const rows = await ctx.db.$queryRaw<
    Array<{ day: string; intents: bigint; sent: bigint; delivered: bigint; deduplicated: bigint; superseded: bigint; consolidated: bigint; blocked: bigint; baseline: string | null; cost: string | null }>
  >`
    SELECT to_char(("requestedAt" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
      COUNT(*) AS intents,
      COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ','FAILED')) AS sent,
      COUNT(*) FILTER (WHERE status IN ('DELIVERED','READ')) AS delivered,
      COUNT(*) FILTER (WHERE status = 'DEDUPLICATED') AS deduplicated,
      COUNT(*) FILTER (WHERE status = 'SUPERSEDED') AS superseded,
      COUNT(*) FILTER (WHERE status = 'CONSOLIDATED') AS consolidated,
      COUNT(*) FILTER (WHERE status = 'BLOCKED') AS blocked,
      SUM("baselineCost") FILTER (WHERE status NOT IN ('BLOCKED','CANCELLED')) AS baseline,
      SUM(COALESCE("realizedCost", CASE WHEN status IN ('READY_TO_SEND','QUEUED','SENDING','SENT','DELAYED') THEN "estimatedCost" END)) AS cost
    FROM "MessageIntent"
    WHERE "tenantId" = ${tenantId}::uuid AND "requestedAt" BETWEEN ${from} AND ${to}
    GROUP BY 1 ORDER BY 1`;
  const savings = await ctx.db.$queryRaw<Array<{ day: string; kind: string; confidence: string; savings: string }>>`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, kind::text, confidence::text, SUM(savings)::text AS savings
    FROM "SavingsRecord" WHERE "tenantId" = ${tenantId}::uuid AND day BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2, 3 ORDER BY 1`;
  const sav = new Map<string, { meta: Decimal; metaRealized: Decimal; bsp: Decimal; infra: Decimal }>();
  for (const s of savings) {
    const e = sav.get(s.day) ?? { meta: new Money(0), metaRealized: new Money(0), bsp: new Money(0), infra: new Money(0) };
    if (s.kind === "META") {
      e.meta = e.meta.plus(D(s.savings));
      if (s.confidence === "REALIZED") e.metaRealized = e.metaRealized.plus(D(s.savings));
    } else if (s.kind === "BSP") e.bsp = e.bsp.plus(D(s.savings));
    else e.infra = e.infra.plus(D(s.savings));
    sav.set(s.day, e);
  }
  return rows.map((r) => {
    const s = sav.get(r.day);
    return {
      day: r.day,
      intents: Number(r.intents),
      sent: Number(r.sent),
      delivered: Number(r.delivered),
      deduplicated: Number(r.deduplicated),
      superseded: Number(r.superseded),
      consolidated: Number(r.consolidated),
      blocked: Number(r.blocked),
      avoided: Number(r.deduplicated) + Number(r.superseded) + Number(r.consolidated),
      baselineCost: f2(D(r.baseline)),
      cost: f2(D(r.cost)),
      savingsEstimated: f2(s?.meta ?? new Money(0)),
      savingsRealized: f2(s?.metaRealized ?? new Money(0)),
      bspSavings: f2(s?.bsp ?? new Money(0)),
      infraSavings: f4(s?.infra ?? new Money(0)),
    };
  });
}

/** Optimization dashboard (spec §36): by category, by event type, free usage, tiers. */
export async function optimizationBreakdown(ctx: AppContext, tenantId: string, q: z.infer<typeof RangeQuery>) {
  const { from, to } = range(q, ctx.now());
  const [byCategory, byEventType, tiers, quota] = await Promise.all([
    ctx.db.$queryRaw<Array<{ category: string | null; intents: bigint; sent: bigint; avoided: bigint; baseline: string | null; cost: string | null }>>`
      SELECT category::text, COUNT(*) AS intents,
        COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ','FAILED')) AS sent,
        COUNT(*) FILTER (WHERE status IN ('DEDUPLICATED','SUPERSEDED','CONSOLIDATED')) AS avoided,
        SUM("baselineCost") FILTER (WHERE status NOT IN ('BLOCKED','CANCELLED')) AS baseline,
        SUM(COALESCE("realizedCost", CASE WHEN status IN ('READY_TO_SEND','QUEUED','SENDING','SENT','DELAYED') THEN "estimatedCost" END)) AS cost
      FROM "MessageIntent" WHERE "tenantId" = ${tenantId}::uuid AND "requestedAt" BETWEEN ${from} AND ${to}
      GROUP BY 1 ORDER BY 2 DESC`,
    ctx.db.$queryRaw<Array<{ event_type: string; intents: bigint; sent: bigint; deduplicated: bigint; superseded: bigint; consolidated: bigint; avg_cost: string | null }>>`
      SELECT "eventType" AS event_type, COUNT(*) AS intents,
        COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ','FAILED')) AS sent,
        COUNT(*) FILTER (WHERE status = 'DEDUPLICATED') AS deduplicated,
        COUNT(*) FILTER (WHERE status = 'SUPERSEDED') AS superseded,
        COUNT(*) FILTER (WHERE status = 'CONSOLIDATED') AS consolidated,
        AVG("baselineCost") AS avg_cost
      FROM "MessageIntent" WHERE "tenantId" = ${tenantId}::uuid AND "requestedAt" BETWEEN ${from} AND ${to}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    ctx.db.$queryRaw<Array<{ market: string; category: string | null; tier: string | null; n: bigint }>>`
      SELECT c.market, c.category::text, c.tier, COUNT(*) AS n FROM "CostDecision" c
      JOIN "MessageIntent" i ON i.id = c."messageIntentId"
      WHERE c."tenantId" = ${tenantId}::uuid AND c.kind = 'REALIZED' AND c."pricingStatus" = 'PAID' AND i."requestedAt" BETWEEN ${from} AND ${to}
      GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
    ctx.db.freeQuotaCounter.findMany({ where: { tenantId }, orderBy: { periodStart: "desc" }, take: 24 }),
  ]);
  return {
    byCategory: byCategory.map((r) => ({ category: r.category, intents: Number(r.intents), sent: Number(r.sent), avoided: Number(r.avoided), baselineCost: f2(D(r.baseline)), cost: f2(D(r.cost)), savings: f2(D(r.baseline).minus(D(r.cost))) })),
    byEventType: byEventType.map((r) => ({ eventType: r.event_type, intents: Number(r.intents), sent: Number(r.sent), deduplicated: Number(r.deduplicated), superseded: Number(r.superseded), consolidated: Number(r.consolidated), averageCost: f4(D(r.avg_cost)) })),
    tiers: tiers.map((t) => ({ market: t.market, category: t.category, tier: t.tier ?? "List rate", messages: Number(t.n) })),
    quota: quota.map((x) => ({ phoneNumberId: x.phoneNumberId, category: x.category, period: x.periodKey, used: x.used, usedConfirmed: x.usedConfirmed, quota: x.quota, utilization: Math.round((Math.max(x.used, x.usedConfirmed) / Math.max(1, x.quota)) * 1000) / 10, policy: x.sourcePolicyVersion })),
  };
}

export async function insights(ctx: AppContext, tenantId: string, q: z.infer<typeof RangeQuery>) {
  const { from, to } = range(q, ctx.now());
  const tenant = await ctx.tenants.get(tenantId);
  const s = await summary(ctx, tenantId, q);
  const rows = await ctx.db.$queryRaw<Array<{ event_type: string; intents: bigint; deduplicated: bigint; superseded: bigint; consolidated: bigint; sent: bigint; avg_cost: string | null; bursts: bigint }>>`
    WITH x AS (
      SELECT "eventType", status, "baselineCost", "requestedAt",
        LAG("requestedAt") OVER (PARTITION BY "groupKey" ORDER BY "requestedAt") AS prev
      FROM "MessageIntent" WHERE "tenantId" = ${tenantId}::uuid AND "requestedAt" BETWEEN ${from} AND ${to})
    SELECT "eventType" AS event_type, COUNT(*) AS intents,
      COUNT(*) FILTER (WHERE status = 'DEDUPLICATED') AS deduplicated,
      COUNT(*) FILTER (WHERE status = 'SUPERSEDED') AS superseded,
      COUNT(*) FILTER (WHERE status = 'CONSOLIDATED') AS consolidated,
      COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ','FAILED')) AS sent,
      AVG("baselineCost") AS avg_cost,
      COUNT(*) FILTER (WHERE prev IS NOT NULL AND "requestedAt" - prev < interval '2 minutes') AS bursts
    FROM x GROUP BY 1`;
  const stats: EventTypeStats[] = rows.map((r) => {
    const pol = tenant.policies.find((p) => p.eventType === r.event_type);
    return {
      eventType: r.event_type,
      intents: Number(r.intents),
      deduplicated: Number(r.deduplicated),
      superseded: Number(r.superseded),
      consolidated: Number(r.consolidated),
      sent: Number(r.sent),
      burstIntents: Number(r.bursts),
      aggregationEnabled: !!pol?.allowAggregation,
      supersessionEnabled: !!pol?.allowSupersession,
      paidJustAfterWindow: 0,
      averageCost: D(r.avg_cost),
    };
  });
  const avg = stats.length ? stats.reduce((a, b) => a.plus(b.averageCost), new Money(0) as Decimal).dividedBy(stats.length) : new Money(0);
  const dailyRows = await daily(ctx, tenantId, { from: new Date(to.getTime() - 31 * 86_400_000), to });
  const history = dailyRows.slice(0, -1).map((d) => money(d.cost));
  const today = dailyRows.length ? money(dailyRows[dailyRows.length - 1]!.cost) : new Money(0);
  return {
    recommendations: recommend(stats, s.currency),
    opportunities: opportunities({
      currency: s.currency,
      averageCost: avg,
      duplicates: stats.reduce((a, b) => a + b.deduplicated, 0),
      burstIntents: stats.filter((x) => !x.aggregationEnabled).reduce((a, b) => a + b.burstIntents, 0),
      paidJustAfterWindow: 0,
      freeEntryPointEligibleMissed: 0,
      bspMonthlyFees: tenant.usesBsp ? money(s.costs.bsp) : undefined,
    }),
    anomaly: detectCostAnomaly(history, today),
    disclaimer: "Oportunidades e recomendações são estimativas, nunca economia garantida.",
  };
}

export async function cost(ctx: AppContext, tenantId: string, q: z.infer<typeof RangeQuery>, kind: "estimate" | "actual") {
  const s = await summary(ctx, tenantId, q);
  if (kind === "estimate") {
    return { label: "ESTIMATED", currency: s.currency, metaWithoutWco: s.costs.metaWithoutWco, metaWithWco: s.costs.metaWithWco, bsp: s.costs.bsp, infrastructure: s.costs.infrastructure, total: s.costs.totalWithWco, isDemoRates: s.isDemoRates };
  }
  return {
    label: "REALIZED",
    currency: s.currency,
    metaRealized: s.costs.metaRealized,
    realizedMessages: s.costs.realizedMessages,
    note: "Realized = messages confirmed by Meta delivery webhooks with a pricing object, priced with the rate card in force on the delivery date.",
    isDemoRates: s.isDemoRates,
  };
}

/** Operational metrics for the observability page (spec §47). */
export async function operations(ctx: AppContext, tenantId: string) {
  const since = new Date(ctx.now().getTime() - 3_600_000);
  const [queues, attempts, webhooks] = await Promise.all([
    queueDepths(ctx.queues),
    ctx.db.messageAttempt.groupBy({ by: ["status"], where: { tenantId, requestedAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } }),
    ctx.db.webhookEvent.groupBy({ by: ["status"], where: { OR: [{ tenantId }, { tenantId: null }], receivedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const total = attempts.reduce((a, r) => a + r._count._all, 0);
  const failed = attempts.filter((r) => r.status === "FAILED").reduce((a, r) => a + r._count._all, 0);
  const latencies = attempts.filter((r) => r._avg.latencyMs !== null);
  return {
    window: "last 60 minutes",
    queues,
    throughputPerMinute: Math.round((total / 60) * 10) / 10,
    errorRate: total ? Math.round((failed / total) * 1000) / 10 : 0,
    metaApiLatencyMs: latencies.length ? Math.round(latencies.reduce((a, r) => a + (r._avg.latencyMs ?? 0), 0) / latencies.length) : null,
    attempts: Object.fromEntries(attempts.map((r) => [r.status, r._count._all])),
    webhooks: Object.fromEntries(webhooks.map((r) => [r.status, r._count._all])),
  };
}

export { Prisma };
