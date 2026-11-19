import { z } from "zod";
import type { AppContext } from "./context";
import { RangeQuery } from "./analytics";

export const MirrorVariantSchema = z.object({
  groupKey: z.string().min(1).max(120),
  metaTemplateName: z.string().min(1).max(200),
  language: z.string().min(2).max(20).default("pt_BR"),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]).default("UTILITY"),
  status: z.enum(["APPROVED", "PAUSED", "DISABLED", "REJECTED"]).default("APPROVED"),
  priority: z.number().int().min(1).max(100).default(1),
});

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function finopsSummary(ctx: AppContext, tenantId: string, q: z.infer<typeof RangeQuery>) {
  const to = q.to ?? ctx.now();
  const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
  const now = ctx.now();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const [ledger, suppressionsRaw, quotasRaw, mirrorVariants] = await Promise.all([
    ctx.db.finOpsSavingsLedger.findMany({
      where: { tenantId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    ctx.db.globalSuppression.groupBy({
      by: ["reason"],
      where: { expiresAt: { gt: now } },
      _count: { _all: true },
      _sum: { hitCount: true },
    }),
    ctx.db.monthlyServiceQuota.findMany({
      where: { tenantId, yearMonth },
      orderBy: { wabaPhoneId: "asc" },
    }),
    ctx.db.mirrorTemplateVariant.findMany({
      where: { tenantId },
      orderBy: [{ groupKey: "asc" }, { priority: "asc" }, { metaTemplateName: "asc" }],
    }),
  ]);

  let baselineUsd = 0;
  let finalUsd = 0;
  let metaSavingsUsd = 0;
  let bspSavingsUsd = 0;
  let totalSavingsUsd = 0;

  const byStatus: Record<string, number> = { DISPATCH: 0, SUPPRESSED: 0, DEFERRED: 0 };
  const byTransport: Record<string, number> = { DIRECT_CLOUD_API: 0, EXTERNAL_HTTP_BRIDGE: 0, NONE: 0 };
  const strategyMap = new Map<string, { strategy: string; count: number; savingsUsd: number }>();

  const parseStrategies = (raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  for (const row of ledger) {
    baselineUsd += row.baselineTotalCostUsd;
    finalUsd += row.finalTotalCostUsd;
    metaSavingsUsd += row.metaTariffSavingsUsd;
    bspSavingsUsd += row.avoidedBspFeeUsd;
    totalSavingsUsd += row.totalSavingsUsd;

    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byTransport[row.transport] = (byTransport[row.transport] ?? 0) + 1;

    for (const s of parseStrategies(row.appliedStrategiesJson)) {
      const cur = strategyMap.get(s) ?? { strategy: s, count: 0, savingsUsd: 0 };
      cur.count += 1;
      cur.savingsUsd += row.totalSavingsUsd;
      strategyMap.set(s, cur);
    }
  }

  let invalid131026 = 0;
  let freqCap131049 = 0;
  let totalSuppressionHits = 0;
  for (const s of suppressionsRaw) {
    const c = s._count._all;
    totalSuppressionHits += s._sum.hitCount ?? c;
    if (s.reason.includes("131026")) invalid131026 += c;
    else if (s.reason.includes("131049")) freqCap131049 += c;
  }

  return {
    range: { from, to },
    currency: "USD",
    totals: {
      decisions: ledger.length,
      baselineUsd: r4(baselineUsd),
      finalUsd: r4(finalUsd),
      metaTariffSavingsUsd: r4(metaSavingsUsd),
      avoidedBspFeeUsd: r4(bspSavingsUsd),
      totalSavingsUsd: r4(totalSavingsUsd),
    },
    byStatus,
    byTransport,
    strategies: Array.from(strategyMap.values())
      .map((x) => ({ ...x, savingsUsd: r4(x.savingsUsd) }))
      .sort((a, b) => b.count - a.count),
    suppressions: {
      activeTotal: invalid131026 + freqCap131049,
      totalHits: totalSuppressionHits,
      invalidRecipient131026: invalid131026,
      marketingFrequencyCap131049: freqCap131049,
    },
    quotas: quotasRaw.map((item) => ({
      id: item.id,
      wabaPhoneId: item.wabaPhoneId,
      yearMonth: item.yearMonth,
      freeUsedCount: item.freeUsedCount,
      freeLimit: item.freeLimit,
      remaining: Math.max(0, item.freeLimit - item.freeUsedCount),
    })),
    mirrorVariants,
    recent: ledger.slice(0, 15).map((row) => ({
      id: row.id,
      intentId: row.intentId,
      status: row.status,
      transport: row.transport,
      deliveryMode: row.deliveryMode,
      selectedTemplateName: row.selectedTemplateName,
      baselineTotalCostUsd: r4(row.baselineTotalCostUsd),
      finalTotalCostUsd: r4(row.finalTotalCostUsd),
      totalSavingsUsd: r4(row.totalSavingsUsd),
      strategies: parseStrategies(row.appliedStrategiesJson),
      createdAt: row.createdAt,
    })),
  };
}

export async function listMirrorVariants(ctx: AppContext, tenantId: string) {
  return ctx.db.mirrorTemplateVariant.findMany({
    where: { tenantId },
    orderBy: [{ groupKey: "asc" }, { priority: "asc" }, { metaTemplateName: "asc" }],
  });
}

export async function upsertMirrorVariant(ctx: AppContext, tenantId: string, raw: unknown) {
  const input = MirrorVariantSchema.parse(raw);
  return ctx.db.mirrorTemplateVariant.upsert({
    where: {
      tenantId_metaTemplateName_language: {
        tenantId,
        metaTemplateName: input.metaTemplateName,
        language: input.language,
      },
    },
    update: {
      groupKey: input.groupKey,
      category: input.category,
      status: input.status,
      priority: input.priority,
    },
    create: {
      tenantId,
      groupKey: input.groupKey,
      metaTemplateName: input.metaTemplateName,
      language: input.language,
      category: input.category,
      status: input.status,
      priority: input.priority,
    },
  });
}

export async function deleteMirrorVariant(ctx: AppContext, tenantId: string, id: string) {
  await ctx.db.mirrorTemplateVariant.deleteMany({ where: { id, tenantId } });
  return { deleted: true, id };
}
