import { createHash } from "node:crypto";
import {
  BUFFERED_STATUSES,
  Confidence,
  DecisionAction,
  MessageKind,
  MessageStatus,
  PricingStatus,
  money,
  type Decimal,
} from "@wco/domain";
import { metrics, withSpan } from "@wco/logging";
import {
  ALL_FEATURES,
  decide,
  extendDebounce,
  nextFlushTime,
  planFlush,
  selectFlushSet,
  type BufferedEntry,
  type FlushMessage,
  type OptimizationDecision,
} from "@wco/optimization";
import { resolvePolicy } from "@wco/policy";
import type { CostDecision } from "@wco/pricing";
import { audit, event } from "./audit";
import type { AppContext, TenantConfig } from "./context";
import { loadConversationContext } from "./conversations";
import { loadCounters } from "./counters";
import { QUEUE } from "./queues";
import { toIntentRecord } from "./records";
import { recordSavings } from "./savings-store";

type Tx = Parameters<Parameters<AppContext["db"]["$transaction"]>[0]>[0];

const groupHash = (g: string) => createHash("sha1").update(g).digest("hex").slice(0, 20);

export function costRows(tenantId: string, intentId: string, decisions: Array<CostDecision | null | undefined>, at: Date) {
  return decisions
    .filter((c): c is CostDecision => !!c)
    .map((c) => ({
      tenantId,
      messageIntentId: intentId,
      kind: c.kind,
      category: c.category,
      market: c.market,
      currency: c.currency,
      baseRate: c.baseRate ? c.baseRate.toFixed(8) : null,
      effectiveRate: c.effectiveRate.toFixed(8),
      isFree: c.isFree,
      freeReason: c.freeReason,
      pricingStatus: c.pricingStatus,
      tier: c.tier,
      policyVersion: c.policyVersion,
      rateCardId: c.rateCardId,
      estimatedCost: c.estimatedCost.toFixed(8),
      confidence: c.confidence,
      decisionReason: c.decisionReason,
      evidence: c.evidence,
      evaluatedAt: at,
    }));
}

const known = (c: CostDecision | null | undefined): Decimal | null =>
  c && c.pricingStatus !== PricingStatus.UNKNOWN && c.pricingStatus !== PricingStatus.NOT_ELIGIBLE ? c.estimatedCost : null;

/** Post-commit side effects (enqueue only after the transaction committed). */
type After = Array<() => Promise<unknown>>;

async function scheduleFlush(ctx: AppContext, after: After, tenantId: string, group: string, at: Date): Promise<void> {
  const delay = Math.max(0, at.getTime() - ctx.now().getTime());
  after.push(() => ctx.queues[QUEUE.FLUSH].add("flush", { tenantId, groupKey: group }, { jobId: `flush-${groupHash(group)}-${at.getTime()}`, delay }));
}

async function createAttempt(ctx: AppContext, tx: Tx, after: After, tenantId: string, m: FlushMessage, sendAt: Date): Promise<string> {
  const count = await tx.messageAttempt.count({ where: { tenantId, intentId: m.primaryIntentId } });
  const attempt = await tx.messageAttempt.create({
    data: {
      tenantId,
      intentId: m.primaryIntentId,
      attemptNumber: count + 1,
      provider: ctx.config.meta.mock ? "MOCK" : "META_CLOUD_API",
      status: MessageStatus.QUEUED,
      coveredIntentIds: m.coveredIntentIds,
      messageKind: m.messageKind,
      templateName: m.templateName,
      category: m.category,
      payload: { parameters: m.parameters, text: m.text, consolidated: m.consolidated, reasons: m.reasons },
    },
  });
  await tx.messageIntent.update({ where: { id: m.primaryIntentId, tenantId }, data: { status: MessageStatus.QUEUED, scheduledFor: sendAt, dispatchedAt: ctx.now() } });
  await event(tx, { tenantId, type: "STATE_TRANSITION", intentId: m.primaryIntentId, data: { from: "READY_TO_SEND", to: "QUEUED", attemptId: attempt.id, consolidated: m.consolidated, covered: m.coveredIntentIds.length } });
  const delay = Math.max(0, sendAt.getTime() - ctx.now().getTime());
  after.push(() => ctx.queues[QUEUE.DISPATCH].add("dispatch", { tenantId, attemptId: attempt.id }, { jobId: `dispatch-${attempt.id}`, delay }));
  return attempt.id;
}

async function markAvoided(
  ctx: AppContext,
  tx: Tx,
  tenant: TenantConfig,
  row: { id: string; eventType: string; category: string | null; baselineCost: { toString(): string } | null; currency: string | null; policyVersionId: string | null },
  status: MessageStatus,
  at: Date,
  extra: { supersededById?: string; duplicateOfId?: string; consolidatedIntoId?: string },
): Promise<void> {
  await tx.messageIntent.update({ where: { id: row.id, tenantId: tenant.id }, data: { status, ...extra } });
  await event(tx, { tenantId: tenant.id, type: "STATE_TRANSITION", intentId: row.id, occurredAt: at, data: { to: status, ...extra } });
  await recordSavings(tx, ctx, tenant, {
    intentId: row.id,
    status,
    day: at,
    currency: row.currency ?? tenant.defaultCurrency,
    baselineCost: row.baselineCost ? money(row.baselineCost.toString()) : null,
    optimizedCost: null,
    optimizedConfidence: Confidence.ESTIMATED,
    category: row.category,
    eventType: row.eventType,
    policyVersion: row.policyVersionId,
  });
  metrics.messagesAvoided.inc({ tenant_id: tenant.id, reason: status });
}

/** Optimization job: runs the decision engine for one intent under the buffer-group lock. */
export async function optimizeIntent(ctx: AppContext, job: { tenantId: string; intentId: string }): Promise<{ action: DecisionAction | null; skipped?: boolean }> {
  const pre = await ctx.db.messageIntent.findFirst({ where: { id: job.intentId, tenantId: job.tenantId }, select: { groupKey: true, status: true } });
  if (!pre || pre.status !== MessageStatus.PENDING_OPTIMIZATION) return { action: null, skipped: true };
  const tenant = await ctx.tenants.get(job.tenantId);
  const engine = await ctx.pricing.engine();
  const after: After = [];
  let result: OptimizationDecision | null = null;

  await withSpan("intent.optimize", () =>
    ctx.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pre.groupKey}, 0))`;
        const row = await tx.messageIntent.findFirst({ where: { id: job.intentId, tenantId: job.tenantId } });
        if (!row || row.status !== MessageStatus.PENDING_OPTIMIZATION) return;
        const now = ctx.now();
        const policy = resolvePolicy(row.eventType, tenant.policies);
        const maxWindow = Math.max(86_400, ...tenant.policies.map((p) => p.dedupWindowSeconds));
        const [related, customer] = await Promise.all([
          tx.messageIntent.findMany({
            where: { tenantId: tenant.id, groupKey: row.groupKey, OR: [{ status: { in: [...BUFFERED_STATUSES] as never[] } }, { requestedAt: { gte: new Date(now.getTime() - maxWindow * 1000) } }] },
            orderBy: { requestedAt: "desc" },
            take: 1000,
          }),
          tx.customer.findFirstOrThrow({ where: { id: row.customerId, tenantId: tenant.id } }),
        ]);
        const phone = tenant.phones.find((p) => p.id === row.phoneNumberId);
        const waba = phone ? tenant.wabas.get(phone.wabaId) : undefined;
        const timezone = waba?.timezone ?? tenant.defaultTimezone;
        const currency = waba?.currency ?? tenant.defaultCurrency;
        const { context, conversationId } = await loadConversationContext(tx, tenant.id, row.phoneNumberId, row.customerId);
        const counters = await loadCounters(tx, { tenantId: tenant.id, phoneNumberId: row.phoneNumberId, businessAccountId: waba?.businessAccountId ?? "-", market: row.market, timezone, at: now });
        const intent = toIntentRecord(row);
        const d = decide({
          intent,
          policy,
          now,
          related: related.map((r) => toIntentRecord(r)),
          consent: { requireOptIn: tenant.requireOptIn, optedIn: !!customer.optedInAt, optedOut: !!customer.optedOutAt, marketingOptedOut: !!customer.marketingOptedOutAt },
          conversation: context,
          pricing: { engine, counters, timezone, currency, quotaUsed: 0, tierPosition: 0, authInternationalEligible: waba?.authInternationalEligible ?? false },
          rules: tenant.rules,
          features: ALL_FEATURES,
          explain: true,
        });
        result = d;
        const windowDriven = d.reasons.some((r) => r.startsWith("before_"));
        const baseline = known(d.baselineCost);
        await tx.messageIntent.update({
          where: { id: row.id, tenantId: tenant.id },
          data: {
            status: d.nextStatus,
            decisionAction: d.action,
            decisionReason: d.reasons.join(","),
            category: d.category,
            messageKind: d.messageKind,
            templateName: d.messageKind === MessageKind.NON_TEMPLATE ? null : row.templateName,
            estimatedCost: d.cost ? d.cost.estimatedCost.toFixed(8) : null,
            baselineCost: baseline ? baseline.toFixed(8) : null,
            currency,
            policyVersionId: d.cost?.policyVersion ?? d.baselineCost?.policyVersion ?? null,
            scheduledFor: d.sendAt,
            deadlineAt: windowDriven && d.sendAt ? d.sendAt : d.effectiveDeadline,
            supersededById: d.supersededBy,
            duplicateOfId: d.duplicateOf,
          },
        });
        await tx.optimizationDecision.create({
          data: {
            tenantId: tenant.id,
            intentId: row.id,
            action: d.action,
            reasons: d.reasons,
            explanation: { facts: d.facts, rule: d.rule, notes: d.explanation } as never,
            sendAt: d.sendAt,
            estimatedSavings: d.estimatedSavings.toFixed(8),
            currency,
            opportunities: d.opportunities.map((o) => ({ ...o, potentialSaving: o.potentialSaving.toString() })) as never,
            rulesetVersion: `${d.rule.ruleSet}@${tenant.ruleSet.version ?? "custom"}`,
          },
        });
        await tx.costDecision.createMany({ data: costRows(tenant.id, row.id, [d.cost, d.baselineCost, d.alternativeCost && d.alternativeCost !== d.baselineCost ? { ...d.alternativeCost, kind: "ALTERNATIVE" } : null], now) as never });
        await event(tx, { tenantId: tenant.id, type: "DECISION", intentId: row.id, conversationId, occurredAt: now, data: { action: d.action, reasons: d.reasons, sendAt: d.sendAt, facts: d.facts } });
        await event(tx, { tenantId: tenant.id, type: "STATE_TRANSITION", intentId: row.id, occurredAt: now, data: { from: "PENDING_OPTIMIZATION", to: d.nextStatus, reason: d.rule.reason } });
        await audit(tx, { tenantId: tenant.id, action: "intent.optimized", entityType: "MessageIntent", entityId: row.id, data: { action: d.action, reasons: d.reasons } });
        metrics.decisions.inc({ tenant_id: tenant.id, action: d.action });
        if (d.cost && d.cost.pricingStatus !== PricingStatus.UNKNOWN) metrics.estimatedCost.inc({ tenant_id: tenant.id, currency }, d.cost.estimatedCost.toNumber());

        // Older pending updates replaced by this one.
        for (const id of d.supersedes) {
          const old = related.find((r) => r.id === id);
          if (old && BUFFERED_STATUSES.has(old.status as MessageStatus)) {
            await markAvoided(ctx, tx, tenant, old, MessageStatus.SUPERSEDED, now, { supersededById: row.id });
          }
        }

        switch (d.action) {
          case DecisionAction.SUPPRESS_DUPLICATE:
          case DecisionAction.SUPERSEDE:
            await recordSavings(tx, ctx, tenant, {
              intentId: row.id,
              status: d.nextStatus,
              day: now,
              currency,
              baselineCost: baseline,
              optimizedCost: null,
              optimizedConfidence: Confidence.ESTIMATED,
              category: d.category,
              eventType: row.eventType,
              policyVersion: d.baselineCost?.policyVersion ?? null,
            });
            metrics.messagesAvoided.inc({ tenant_id: tenant.id, reason: d.nextStatus });
            break;
          case DecisionAction.SEND_NOW: {
            const m: FlushMessage = {
              primaryIntentId: row.id,
              coveredIntentIds: [row.id],
              consolidated: false,
              templateName: d.messageKind === MessageKind.NON_TEMPLATE ? null : row.templateName,
              messageKind: d.messageKind,
              category: d.category,
              parameters: [],
              text: row.freeFormText,
              reasons: d.reasons,
            };
            await createAttempt(ctx, tx, after, tenant.id, m, d.sendAt ?? now);
            break;
          }
          case DecisionAction.DELAY:
          case DecisionAction.CONSOLIDATE: {
            const buffered = related.filter((r) => r.status === MessageStatus.DELAYED && !d.supersedes.includes(r.id));
            const entries: BufferedEntry[] = buffered.map((r) => ({ intent: toIntentRecord(r), flushAt: r.scheduledFor ?? now, hardDeadline: r.deadlineAt }));
            const mine: BufferedEntry = { intent: { ...intent, status: MessageStatus.DELAYED }, flushAt: d.sendAt ?? now, hardDeadline: windowDriven && d.sendAt ? d.sendAt : d.effectiveDeadline };
            for (const u of extendDebounce(entries, mine)) {
              await tx.messageIntent.update({ where: { id: u.id, tenantId: tenant.id }, data: { scheduledFor: u.flushAt } });
              const e = entries.find((x) => x.intent.id === u.id);
              if (e) e.flushAt = u.flushAt;
            }
            const next = nextFlushTime([...entries, mine]);
            if (next) await scheduleFlush(ctx, after, tenant.id, row.groupKey, next);
            break;
          }
          default:
            break;
        }
      },
      { timeout: 20_000, maxWait: 10_000 },
    ),
  );
  for (const f of after) await f();
  return { action: (result as OptimizationDecision | null)?.action ?? null };
}

/** Flush job: buffered intents of a group leave the buffer (consolidated when compatible). */
export async function flushGroup(ctx: AppContext, job: { tenantId: string; groupKey: string }): Promise<{ messages: number; consolidated: number }> {
  const tenant = await ctx.tenants.get(job.tenantId);
  const after: After = [];
  let out = { messages: 0, consolidated: 0 };
  await withSpan("buffer.flush", () =>
    ctx.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${job.groupKey}, 0))`;
        const now = ctx.now();
        const rows = await tx.messageIntent.findMany({ where: { tenantId: tenant.id, groupKey: job.groupKey, status: MessageStatus.DELAYED } });
        if (rows.length === 0) return;
        const entries: BufferedEntry[] = rows.map((r) => ({ intent: toIntentRecord(r), flushAt: r.scheduledFor ?? now, hardDeadline: r.deadlineAt }));
        const next = nextFlushTime(entries);
        // Tolerance for timer jitter; stale timers simply reschedule.
        const at = new Date(now.getTime() + 500);
        if (next && next > at) {
          await scheduleFlush(ctx, after, tenant.id, job.groupKey, next);
          return;
        }
        const { due, partners } = selectFlushSet(entries, at);
        const set = [...due, ...partners];
        const plan = planFlush(
          set.map((e) => e.intent),
          { policyFor: (t) => resolvePolicy(t, tenant.policies), templateFor: (n) => tenant.templates.get(n), features: ALL_FEATURES },
        );
        for (const c of plan.consolidated) {
          const r = rows.find((x) => x.id === c.intentId)!;
          await markAvoided(ctx, tx, tenant, r, MessageStatus.CONSOLIDATED, now, { consolidatedIntoId: c.into });
          out.consolidated++;
        }
        for (const m of plan.messages) {
          await tx.messageIntent.update({ where: { id: m.primaryIntentId, tenantId: tenant.id }, data: { status: MessageStatus.READY_TO_SEND } });
          await event(tx, { tenantId: tenant.id, type: "STATE_TRANSITION", intentId: m.primaryIntentId, occurredAt: now, data: { from: "DELAYED", to: "READY_TO_SEND", reasons: m.reasons, covered: m.coveredIntentIds } });
          await createAttempt(ctx, tx, after, tenant.id, m, now);
          out.messages++;
        }
        if (plan.notes.length) await audit(tx, { tenantId: tenant.id, action: "buffer.flush.notes", entityType: "Group", entityId: null, data: { notes: plan.notes } });
        const remaining = entries.filter((e) => !set.includes(e));
        const n = nextFlushTime(remaining);
        if (n) await scheduleFlush(ctx, after, tenant.id, job.groupKey, n);
      },
      { timeout: 20_000, maxWait: 10_000 },
    ),
  );
  for (const f of after) await f();
  return out;
}
