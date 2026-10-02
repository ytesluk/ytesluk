import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BillingCategory,
  Errors,
  MessageKind,
  MessageStatus,
  PRIORITIES,
  addSeconds,
  localDate,
  payloadHash,
  resolveMarket,
} from "@wco/domain";
import { metrics, withSpan } from "@wco/logging";
import { consolidationKey, eventHash, groupKey, supersessionKey } from "@wco/optimization";
import { resolvePolicy } from "@wco/policy";
import { audit, event } from "./audit";
import type { Actor, AppContext } from "./context";
import { QUEUE } from "./queues";

/** Spec §31 request body (extended with optional, documented fields). */
export const CreateIntentSchema = z.object({
  customer: z.string().min(8).describe("Recipient phone in E.164 (e.g. +5511999999999)"),
  eventType: z.string().min(1).max(120),
  entityId: z.string().max(200).optional().nullable(),
  data: z.record(z.string(), z.unknown()).default({}),
  priority: z.enum(PRIORITIES as [string, ...string[]]).optional(),
  maxDelaySeconds: z.number().int().min(0).max(7 * 86_400).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  occurredAt: z.coerce.date().optional(),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"]).optional(),
  template: z.object({ name: z.string().min(1), language: z.string().min(2).optional() }).optional(),
  text: z.string().max(4096).optional().describe("Free-form body (service message, only inside an open customer service window)"),
  mustSendImmediately: z.boolean().optional(),
  earliestSendAt: z.coerce.date().optional(),
  preferredSendAt: z.coerce.date().optional(),
  phoneNumberId: z.string().optional().describe("Internal or Meta business phone number id; defaults to the tenant's default number"),
  optimization: z
    .object({ allowDeduplication: z.boolean().optional(), allowAggregation: z.boolean().optional(), allowSupersession: z.boolean().optional() })
    .optional(),
  consent: z.object({ optIn: z.boolean(), source: z.string().max(100).optional() }).optional(),
});
export type CreateIntentInput = z.infer<typeof CreateIntentSchema>;

export interface CreateIntentResult {
  intentId: string;
  status: MessageStatus;
  idempotent: boolean;
}

export async function createIntent(ctx: AppContext, actor: Actor, raw: unknown, opts: { requestId?: string } = {}): Promise<CreateIntentResult> {
  const input = CreateIntentSchema.parse(raw);
  return withSpan("intent.create", async (span) => {
    const tenant = await ctx.tenants.get(actor.tenantId);
    const phone =
      (input.phoneNumberId && tenant.phones.find((p) => p.id === input.phoneNumberId || p.metaPhoneNumberId === input.phoneNumberId)) ||
      tenant.phones.find((p) => p.isDefault) ||
      tenant.phones[0];
    if (!phone) throw Errors.validation("Tenant has no WhatsApp phone number connected (see Admin > Providers / Connect WhatsApp)");
    const waba = tenant.wabas.get(phone.wabaId);
    const timezone = waba?.timezone ?? tenant.defaultTimezone;
    const now = ctx.now();
    const p = ctx.vault.phone(input.customer);
    const market = resolveMarket(p.e164, localDate(now, timezone)).market;

    const customer = await ctx.db.customer.upsert({
      where: { tenantId_phoneHash: { tenantId: tenant.id, phoneHash: p.hash } },
      create: { tenantId: tenant.id, phoneHash: p.hash, phoneEncrypted: p.encrypted, phoneMasked: p.masked, market },
      update: { market },
    });
    if (customer.erasedAt) throw Errors.validation("Customer data was erased (LGPD); a new opt-in is required");
    if (input.consent) {
      await ctx.db.consentRecord.create({
        data: { tenantId: tenant.id, customerId: customer.id, type: input.consent.optIn ? "OPT_IN" : "OPT_OUT", scope: "ALL", source: input.consent.source ?? "API", occurredAt: now },
      });
      await ctx.db.customer.update({ where: { id: customer.id }, data: input.consent.optIn ? { optedInAt: now, optedOutAt: null } : { optedOutAt: now } });
    }

    const policy = resolvePolicy(input.eventType, tenant.policies);
    const template = input.template?.name ? tenant.templates.get(input.template.name) : undefined;
    if (input.template?.name && !template) throw Errors.validation(`Template "${input.template.name}" is not registered for this tenant`);
    const freeForm = !input.template && !!input.text && (input.category === "SERVICE" || policy.category === BillingCategory.SERVICE);
    const messageKind = freeForm ? MessageKind.NON_TEMPLATE : MessageKind.TEMPLATE;
    const category = (freeForm ? BillingCategory.SERVICE : (template?.category ?? input.category ?? policy.category ?? BillingCategory.UTILITY)) as BillingCategory;
    const templateName = messageKind === MessageKind.TEMPLATE ? (template?.name ?? policy.defaultTemplate ?? null) : null;
    if (messageKind === MessageKind.TEMPLATE && !templateName) {
      throw Errors.validation(`No template given and no default template configured for event type "${input.eventType}"`);
    }
    const allowDedup = input.optimization?.allowDeduplication ?? policy.allowDeduplication;
    const allowAgg = input.optimization?.allowAggregation ?? policy.allowAggregation;
    const allowSup = input.optimization?.allowSupersession ?? policy.allowSupersession;
    const maxDelay = input.maxDelaySeconds ?? policy.maxDelaySeconds;
    const earliest = input.earliestSendAt && input.earliestSendAt > now ? input.earliestSendAt : now;
    const preferred = input.preferredSendAt && input.preferredSendAt > earliest ? input.preferredSendAt : earliest;
    const g = groupKey(tenant.id, phone.id, p.hash, input.entityId ?? null);
    const pHash = payloadHash(input.data);
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    span.setAttribute("tenant", tenant.id);
    span.setAttribute("eventType", input.eventType);

    try {
      const intent = await ctx.db.messageIntent.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          customerPhoneHash: p.hash,
          phoneNumberId: phone.id,
          businessEntityId: input.entityId ?? null,
          eventType: input.eventType,
          payloadHash: pHash,
          eventHash: eventHash({ eventType: input.eventType, businessEntityId: input.entityId ?? null, payloadHash: pHash, customerKey: p.hash, phoneNumberId: phone.id, templateName }),
          idempotencyKey,
          occurredAt: input.occurredAt ?? now,
          requestedAt: now,
          status: MessageStatus.PENDING_OPTIMIZATION,
          priority: (input.priority ?? policy.priority) as never,
          maxDelaySeconds: maxDelay,
          earliestSendAt: earliest,
          preferredSendAt: preferred,
          deadlineAt: addSeconds(preferred, maxDelay),
          mustSendImmediately: input.mustSendImmediately ?? false,
          allowDeduplication: allowDedup,
          allowAggregation: allowAgg,
          allowSupersession: allowSup,
          messageKind,
          category,
          templateId: template?.id ?? null,
          templateName,
          templateLanguage: input.template?.language ?? template?.language ?? policy.defaultLanguage ?? "pt_BR",
          data: input.data as never,
          freeFormText: input.text ?? null,
          groupKey: g,
          supersessionKey: supersessionKey(g, input.eventType, policy, allowSup),
          consolidationKey: consolidationKey(g, category, policy, allowAgg),
          market,
          currency: waba?.currency ?? tenant.defaultCurrency,
        },
      });
      await Promise.all([
        event(ctx.db, { tenantId: tenant.id, type: "INTENT_CREATED", intentId: intent.id, occurredAt: now, data: { eventType: input.eventType, priority: intent.priority, maxDelaySeconds: maxDelay } }),
        event(ctx.db, { tenantId: tenant.id, type: "STATE_TRANSITION", intentId: intent.id, occurredAt: now, data: { from: "CREATED", to: "PENDING_OPTIMIZATION", reason: "accepted" } }),
        audit(ctx.db, { tenantId: tenant.id, actor, action: "intent.created", entityType: "MessageIntent", entityId: intent.id, requestId: opts.requestId, data: { eventType: input.eventType, entityId: input.entityId, customer: p.masked } }),
      ]);
      await ctx.queues[QUEUE.OPTIMIZE].add("optimize", { tenantId: tenant.id, intentId: intent.id }, { jobId: `opt-${intent.id}` });
      metrics.intentsReceived.inc({ tenant_id: tenant.id, event_type: input.eventType });
      return { intentId: intent.id, status: MessageStatus.PENDING_OPTIMIZATION, idempotent: false };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        const existing = await ctx.db.messageIntent.findFirst({ where: { tenantId: tenant.id, idempotencyKey } });
        if (existing) return { intentId: existing.id, status: existing.status as MessageStatus, idempotent: true };
      }
      throw e;
    }
  });
}

export const ListIntentsQuery = z.object({
  status: z.string().optional(),
  eventType: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export async function listIntents(ctx: AppContext, tenantId: string, q: z.infer<typeof ListIntentsQuery>) {
  const rows = await ctx.db.messageIntent.findMany({
    where: {
      tenantId,
      ...(q.status ? { status: { in: q.status.split(",") as never[] } } : {}),
      ...(q.eventType ? { eventType: q.eventType } : {}),
      ...(q.from || q.to ? { requestedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { customer: { select: { phoneMasked: true } } },
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit).map((r) => ({
    id: r.id,
    eventType: r.eventType,
    entityId: r.businessEntityId,
    customer: r.customer.phoneMasked,
    status: r.status,
    priority: r.priority,
    category: r.category,
    messageKind: r.messageKind,
    templateName: r.templateName,
    decisionAction: r.decisionAction,
    decisionReason: r.decisionReason,
    market: r.market,
    currency: r.currency,
    estimatedCost: r.estimatedCost?.toString() ?? null,
    baselineCost: r.baselineCost?.toString() ?? null,
    realizedCost: r.realizedCost?.toString() ?? null,
    realizedConfidence: r.realizedConfidence,
    requestedAt: r.requestedAt,
    scheduledFor: r.scheduledFor,
    sentAt: r.sentAt,
    deliveredAt: r.deliveredAt,
    supersededById: r.supersededById,
    duplicateOfId: r.duplicateOfId,
    consolidatedIntoId: r.consolidatedIntoId,
  }));
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

/** Message Audit (spec §81, §82): events, decisions, policy, pricing, delivery, optimization, savings. */
export async function getIntentAudit(ctx: AppContext, tenantId: string, intentId: string) {
  const intent = await ctx.db.messageIntent.findFirst({
    where: { id: intentId, tenantId },
    include: {
      customer: { select: { phoneMasked: true, market: true, optedInAt: true, optedOutAt: true, marketingOptedOutAt: true } },
      decisions: { orderBy: { createdAt: "asc" } },
      costs: { orderBy: { createdAt: "asc" } },
      savings: true,
      attempts: { include: { deliveries: { orderBy: { occurredAt: "asc" } } }, orderBy: { attemptNumber: "asc" } },
    },
  });
  if (!intent) throw Errors.notFound("Message");
  const [events, coveredBy] = await Promise.all([
    ctx.db.conversationEvent.findMany({ where: { tenantId, intentId }, orderBy: { occurredAt: "asc" }, take: 200 }),
    intent.consolidatedIntoId ? ctx.db.messageAttempt.findFirst({ where: { tenantId, coveredIntentIds: { has: intent.id } } }) : Promise.resolve(null),
  ]);
  const realized = intent.costs.find((c) => c.kind === "REALIZED");
  const optimized = [...intent.costs].reverse().find((c) => c.kind === "OPTIMIZED");
  const policyIds = [...new Set(intent.costs.map((c) => c.policyVersion).filter((x): x is string => !!x))];
  const policies = policyIds.length ? await ctx.db.pricingPolicyVersion.findMany({ where: { id: { in: policyIds } }, select: { id: true, name: true, effectiveFrom: true, effectiveUntil: true, sourceUrl: true, status: true, notes: true } }) : [];
  const decision = intent.decisions[intent.decisions.length - 1];
  const why = {
    whySent: decision && decision.action === "SEND_NOW" ? decision.reasons : intent.sentAt ? ["janela de buffer encerrada: enviado o estado mais recente"] : null,
    whyDelayed: decision && (decision.action === "DELAY" || decision.action === "CONSOLIDATE") ? decision.reasons : null,
    whyConsolidated:
      intent.status === "CONSOLIDATED"
        ? [`consolidada na intent ${intent.consolidatedIntoId}`]
        : intent.status === "SUPERSEDED"
          ? [`substituída pela intent ${intent.supersededById} (estado mais recente da mesma entidade)`]
          : decision?.action === "CONSOLIDATE" && (intent.attempts[0]?.coveredIntentIds.length ?? 0) > 1
            ? [`mensagem-resumo cobrindo ${intent.attempts[0]!.coveredIntentIds.length} eventos`]
            : null,
    whyFree: (realized ?? optimized)?.isFree ? ((realized ?? optimized)!.evidence as string[]) : null,
    whyCharged: (realized ?? optimized) && !(realized ?? optimized)!.isFree && (realized ?? optimized)!.pricingStatus === "PAID" ? ((realized ?? optimized)!.evidence as string[]) : null,
    whyCategory: intent.templateName
      ? [`template ${intent.templateName}: categoria ${intent.category} atribuída pela Meta (ou a declarada, enquanto a Meta não informar)`]
      : [`mensagem livre dentro da janela de atendimento → ${intent.category}`],
    pricingPolicy: (realized ?? optimized)?.policyVersion ?? null,
    rateCard: (realized ?? optimized)?.rateCardId ?? null,
    tier: (realized ?? optimized)?.tier ?? null,
  };
  return {
    intent: {
      ...intent,
      customer: intent.customer,
      estimatedCost: intent.estimatedCost?.toString() ?? null,
      baselineCost: intent.baselineCost?.toString() ?? null,
      realizedCost: intent.realizedCost?.toString() ?? null,
      decisions: undefined,
      costs: undefined,
      savings: undefined,
      attempts: undefined,
      freeFormText: intent.freeFormText ? "[stored]" : null,
    },
    decisions: intent.decisions.map((d) => ({ ...d, estimatedSavings: d.estimatedSavings.toString() })),
    costs: intent.costs.map((c) => ({ ...c, baseRate: c.baseRate?.toString() ?? null, effectiveRate: c.effectiveRate.toString(), estimatedCost: c.estimatedCost.toString() })),
    attempts: intent.attempts.map((a) => ({ ...a, payload: undefined, estimatedCost: a.estimatedCost?.toString() ?? null, realizedCost: a.realizedCost?.toString() ?? null })),
    consolidatedInto: coveredBy ? { attemptId: coveredBy.id, primaryIntentId: coveredBy.intentId } : null,
    savings: intent.savings.map((s) => ({ ...s, baselineCost: s.baselineCost.toString(), optimizedCost: s.optimizedCost.toString(), savings: s.savings.toString() })),
    events,
    policies,
    why,
  };
}
