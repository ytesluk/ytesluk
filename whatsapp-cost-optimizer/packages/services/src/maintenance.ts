import { AlertSeverity, AlertType, money } from "@wco/domain";
import { detectCostAnomaly } from "@wco/optimization";
import { retentionCutoffs, DEFAULT_RETENTION, type DataRetentionPolicyConfig, type RetentionDays } from "@wco/policy";
import { daily } from "./analytics";
import { audit, raiseAlert } from "./audit";
import type { AppContext } from "./context";

/** DailyMetric rollup (cheap dashboards over long ranges). Idempotent: recomputes the last N days. */
export async function rollupDailyMetrics(ctx: AppContext, days = 2): Promise<number> {
  const tenants = await ctx.db.tenant.findMany({ select: { id: true, defaultCurrency: true } });
  let rows = 0;
  const to = ctx.now();
  const from = new Date(to.getTime() - days * 86_400_000);
  for (const t of tenants) {
    const series = await daily(ctx, t.id, { from, to });
    for (const d of series) {
      const day = new Date(`${d.day}T00:00:00.000Z`);
      const data = {
        intents: d.intents,
        messagesSent: d.sent,
        messagesDelivered: d.delivered,
        deduplicated: d.deduplicated,
        superseded: d.superseded,
        consolidated: d.consolidated,
        blocked: d.blocked,
        baselineCost: d.baselineCost,
        estimatedCost: d.cost,
        realizedCost: d.cost,
        estimatedSavings: d.savingsEstimated,
        realizedSavings: d.savingsRealized,
        bspSavings: d.bspSavings,
        infraSavings: d.infraSavings,
      };
      await ctx.db.dailyMetric.upsert({
        where: { tenantId_day_currency: { tenantId: t.id, day, currency: t.defaultCurrency } },
        create: { tenantId: t.id, day, currency: t.defaultCurrency, ...data },
        update: data,
      });
      rows++;
    }
  }
  return rows;
}

/** Alerts (spec §93, §94): cost anomaly, quota near limit, high duplicate rate. */
export async function evaluateAlerts(ctx: AppContext): Promise<number> {
  const tenants = await ctx.db.tenant.findMany({ select: { id: true } });
  let raised = 0;
  const now = ctx.now();
  const today = now.toISOString().slice(0, 10);
  for (const t of tenants) {
    const series = await daily(ctx, t.id, { from: new Date(now.getTime() - 31 * 86_400_000), to: now });
    if (series.length > 1) {
      const anomaly = detectCostAnomaly(series.slice(0, -1).map((d) => money(d.cost)), money(series[series.length - 1]!.cost));
      if (anomaly.anomalous && (await raiseAlert(ctx.db, { tenantId: t.id, type: AlertType.UNEXPECTED_COST_INCREASE, severity: AlertSeverity.WARNING, title: "Aumento inesperado de custo", message: `${anomaly.message} (média ${anomaly.mean}, hoje ${anomaly.today})`, dedupKey: `anomaly:${t.id}:${today}`, data: anomaly }))) raised++;
      const last = series[series.length - 1]!;
      if (last.intents >= 50 && last.deduplicated / last.intents >= 0.2) {
        if (await raiseAlert(ctx.db, { tenantId: t.id, type: AlertType.HIGH_DUPLICATE_RATE, title: "Taxa alta de eventos duplicados", message: `${Math.round((last.deduplicated / last.intents) * 100)}% dos eventos de hoje eram duplicados. Verifique a integração de origem.`, dedupKey: `dup:${t.id}:${today}` })) raised++;
      }
    }
    const quotas = await ctx.db.freeQuotaCounter.findMany({ where: { tenantId: t.id, periodEnd: { gt: now } } });
    for (const q of quotas) {
      const used = Math.max(q.used, q.usedConfirmed);
      if (used / Math.max(1, q.quota) >= 0.8) {
        if (await raiseAlert(ctx.db, { tenantId: t.id, type: AlertType.QUOTA_NEAR_LIMIT, title: "Cota gratuita perto do limite", message: `${used}/${q.quota} mensagens de ${q.category} no período ${q.periodKey} (número ${q.scopeKey.slice(0, 8)}…).`, dedupKey: `quota:${q.id}:${used >= q.quota ? "100" : "80"}` })) raised++;
      }
    }
    const since = new Date(now.getTime() - 3_600_000);
    const attempts = await ctx.db.messageAttempt.groupBy({ by: ["status"], where: { tenantId: t.id, requestedAt: { gte: since } }, _count: { _all: true } });
    const total = attempts.reduce((a, r) => a + r._count._all, 0);
    const failed = attempts.find((r) => r.status === "FAILED")?._count._all ?? 0;
    if (total >= 20 && failed / total >= 0.2) {
      if (await raiseAlert(ctx.db, { tenantId: t.id, type: AlertType.HIGH_API_ERROR_RATE, severity: AlertSeverity.CRITICAL, title: "Taxa alta de erros da API", message: `${Math.round((failed / total) * 100)}% das tentativas falharam na última hora.`, dedupKey: `apierr:${t.id}:${now.toISOString().slice(0, 13)}` })) raised++;
    }
  }
  return raised;
}

/** Retention (spec §24, §100): purge payloads, raw webhooks, old messages and audit logs per tenant policy. */
export async function applyRetention(ctx: AppContext): Promise<Record<string, number>> {
  const out: Record<string, number> = { payloads: 0, attempts: 0, intents: 0, events: 0, audit: 0, webhooks: 0 };
  const tenants = await ctx.db.tenant.findMany({ include: { retentionPolicy: true } });
  const now = ctx.now();
  for (const t of tenants) {
    const p: DataRetentionPolicyConfig = t.retentionPolicy
      ? { retentionDays: t.retentionPolicy.retentionDays as RetentionDays, auditRetentionDays: t.retentionPolicy.auditRetentionDays, rawWebhookRetentionDays: t.retentionPolicy.rawWebhookRetentionDays, payloadRetentionDays: t.retentionPolicy.payloadRetentionDays }
      : DEFAULT_RETENTION;
    const c = retentionCutoffs(p, now);
    out.payloads! += (await ctx.db.messageIntent.updateMany({ where: { tenantId: t.id, requestedAt: { lt: c.payloads }, payloadPurgedAt: null }, data: { data: {}, freeFormText: null, payloadPurgedAt: now } })).count;
    out.attempts! += (await ctx.db.messageAttempt.updateMany({ where: { tenantId: t.id, requestedAt: { lt: c.payloads }, payload: { not: null as never } }, data: { payload: null as never } })).count;
    out.events! += (await ctx.db.conversationEvent.deleteMany({ where: { tenantId: t.id, occurredAt: { lt: c.messages } } })).count;
    // Savings rows survive (intentId set null) so aggregated analytics remain; message rows are deleted.
    out.intents! += (await ctx.db.messageIntent.deleteMany({ where: { tenantId: t.id, requestedAt: { lt: c.messages } } })).count;
    out.audit! += (await ctx.db.auditLog.deleteMany({ where: { tenantId: t.id, createdAt: { lt: c.audit } } })).count;
    out.webhooks! += (await ctx.db.webhookEvent.updateMany({ where: { tenantId: t.id, receivedAt: { lt: c.rawWebhooks }, rawPurgedAt: null }, data: { rawPayload: null as never, rawPurgedAt: now } })).count;
  }
  // Raw webhooks without tenant (unknown phone numbers) use the default 30 days.
  out.webhooks! += (await ctx.db.webhookEvent.updateMany({ where: { tenantId: null, receivedAt: { lt: new Date(now.getTime() - DEFAULT_RETENTION.rawWebhookRetentionDays * 86_400_000) }, rawPurgedAt: null }, data: { rawPayload: null as never, rawPurgedAt: now } })).count;
  await audit(ctx.db, { tenantId: null, action: "retention.applied", entityType: "System", data: out });
  return out;
}
