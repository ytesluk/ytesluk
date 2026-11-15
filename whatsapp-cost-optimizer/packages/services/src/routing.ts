import { createHash } from "node:crypto";
import type { MessageIntentModel } from "@wco/database";
import { BillingCategory, MessageKind, MessageStatus, RoutingReason, WcoEventType } from "@wco/domain";
import { metrics } from "@wco/logging";
import { priceAt } from "@wco/optimization";
import { buildHandoffLink } from "@wco/whatsapp";
import { audit, event } from "./audit";
import type { AppContext, TenantConfig } from "./context";
import { loadConversationContext } from "./conversations";
import { loadCounters } from "./counters";
import { emitWcoEvent } from "./outbound-webhooks";
import { QUEUE } from "./queues";
import { toIntentRecord } from "./records";

const groupHash = (g: string) => createHash("sha1").update(g).digest("hex").slice(0, 20);

/** Schedules the flush job of a buffer group (idempotent per group and instant). */
export async function enqueueFlush(ctx: AppContext, tenantId: string, group: string, at: Date): Promise<void> {
  const delay = Math.max(0, at.getTime() - ctx.now().getTime());
  await ctx.queues[QUEUE.FLUSH].add("flush", { tenantId, groupKey: group }, { jobId: `flush-${groupHash(group)}-${at.getTime()}`, delay });
}

const appendReason = (current: string | null, reason: string) => (current ? (current.split(",").includes(reason) ? current : `${current},${reason}`) : reason);

/**
 * Inbound-first, step 1: the template is being held for a short grace. Tell the tenant's other
 * channels (EVENTS webhook → e-mail, push, in-app banner, SMS) to invite the customer to open the
 * WhatsApp conversation, with a wa.me link to the official number. Nothing is sent on WhatsApp here.
 */
export async function requestInboundWakeUp(ctx: AppContext, tenant: TenantConfig, intent: Pick<MessageIntentModel, "id" | "customerId" | "phoneNumberId" | "eventType" | "businessEntityId" | "idempotencyKey" | "templateName">, fallbackAt: Date): Promise<number> {
  const phone = tenant.phones.find((p) => p.id === intent.phoneNumberId);
  const customer = await ctx.db.customer.findFirst({ where: { id: intent.customerId, tenantId: tenant.id }, select: { phoneEncrypted: true } });
  const recipient = ctx.vault.decryptPhone(customer?.phoneEncrypted);
  if (!phone || !recipient) return 0;
  const link = buildHandoffLink({ officialPhone: phone.displayPhoneNumber, seed: intent.id, prompt: "Olá! Quero receber minha mensagem" });
  const endpoints = await emitWcoEvent(
    ctx,
    tenant,
    WcoEventType.INBOUND_WAKEUP_REQUESTED,
    {
      intentId: intent.id,
      eventType: intent.eventType,
      entityId: intent.businessEntityId,
      idempotencyKey: intent.idempotencyKey,
      templateName: intent.templateName,
      // The tenant's own customer identifier, so it can reach them on its other channels.
      customer: recipient,
      link: link.url,
      prefilledText: link.text,
      ref: link.ref,
      // If the customer has not written by then, the approved template is sent as usual.
      fallbackAt: fallbackAt.toISOString(),
    },
    { dedupKey: `wakeup-${intent.id}` },
  );
  await event(ctx.db, { tenantId: tenant.id, type: WcoEventType.INBOUND_WAKEUP_REQUESTED, intentId: intent.id, data: { ref: link.ref, endpoints, fallbackAt } });
  metrics.routingDecisions.inc({ tenant_id: tenant.id, reason: RoutingReason.INBOUND_FIRST_WAIT });
  return endpoints;
}

/**
 * Inbound-first, step 2: the customer wrote while templates were being held. The window is open, so
 * the same content goes now as a free-form service message (rendered from the template). Consent is
 * unchanged: the content keeps its category for opt-in/opt-out checks.
 */
export async function convertHeldForInbound(ctx: AppContext, tenant: TenantConfig, input: { customerId: string; phoneNumberId: string; at: Date }): Promise<number> {
  const held = await ctx.db.messageIntent.findMany({
    where: { tenantId: tenant.id, customerId: input.customerId, phoneNumberId: input.phoneNumberId, status: MessageStatus.DELAYED, messageKind: MessageKind.TEMPLATE, decisionReason: { contains: RoutingReason.INBOUND_FIRST_WAIT } },
    select: { groupKey: true },
    take: 100,
  });
  let converted = 0;
  for (const group of new Set(held.map((h) => h.groupKey))) {
    const now = ctx.now();
    const ids = await ctx.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${group}, 0))`;
      const rows = await tx.messageIntent.findMany({ where: { tenantId: tenant.id, groupKey: group, status: MessageStatus.DELAYED, messageKind: MessageKind.TEMPLATE, decisionReason: { contains: RoutingReason.INBOUND_FIRST_WAIT } } });
      const out: string[] = [];
      for (const r of rows) {
        // Only templates whose content can still be shown as a free-form message; the rest go as templates at the grace end.
        if (!r.templateName || !tenant.templates.get(r.templateName)?.freeFormConvertible) continue;
        await tx.messageIntent.update({
          where: { id: r.id, tenantId: tenant.id },
          data: { messageKind: MessageKind.NON_TEMPLATE, category: BillingCategory.SERVICE, contentCategory: r.category, scheduledFor: now, decisionReason: appendReason(r.decisionReason, RoutingReason.INBOUND_FIRST_CONVERTED) },
        });
        await event(tx, { tenantId: tenant.id, type: "DECISION", intentId: r.id, occurredAt: now, data: { action: "INBOUND_FIRST_CONVERTED", reasons: [RoutingReason.INBOUND_FIRST_CONVERTED], from: r.category, to: BillingCategory.SERVICE } });
        out.push(r.id);
      }
      return out;
    });
    if (ids.length > 0) {
      await enqueueFlush(ctx, tenant.id, group, now);
      converted += ids.length;
      metrics.routingDecisions.inc({ tenant_id: tenant.id, reason: RoutingReason.INBOUND_FIRST_CONVERTED }, ids.length);
    }
  }
  return converted;
}

/**
 * Free entry point priority: a FEP window just opened (or was confirmed by Meta) for this
 * conversation. Messages already waiting to go LATER — scheduled attempts or buffered intents — that
 * would be paid then and are free now, are brought forward, never before the client's
 * `earliestSendAt`. No message is created: only the send time of messages that were going to be
 * sent anyway changes. Messages waiting out a 131049 cooldown are left alone.
 */
export async function prioritizeForFreeEntryPoint(ctx: AppContext, input: { tenantId: string; phoneNumberId: string; customerId: string }): Promise<number> {
  const now = ctx.now();
  const waiting = await ctx.db.messageIntent.findMany({
    where: {
      tenantId: input.tenantId,
      customerId: input.customerId,
      phoneNumberId: input.phoneNumberId,
      status: { in: [MessageStatus.QUEUED, MessageStatus.DELAYED] },
      scheduledFor: { gt: new Date(now.getTime() + 60_000) },
      earliestSendAt: { lte: now },
      NOT: { decisionReason: { contains: RoutingReason.DEFERRED_FREQUENCY_CAP } },
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });
  if (waiting.length === 0) return 0;
  const tenant = await ctx.tenants.get(input.tenantId);
  const phone = tenant.phones.find((p) => p.id === input.phoneNumberId);
  const waba = phone ? tenant.wabas.get(phone.wabaId) : undefined;
  const timezone = waba?.timezone ?? tenant.defaultTimezone;
  const currency = waba?.currency ?? tenant.defaultCurrency;
  const engine = await ctx.pricing.engine();
  const { context, conversationId } = await loadConversationContext(ctx.db, tenant.id, input.phoneNumberId, input.customerId);
  const flush = new Set<string>();
  let moved = 0;
  for (const intent of waiting) {
    if (!intent.scheduledFor) continue;
    const counters = await loadCounters(ctx.db, { tenantId: tenant.id, phoneNumberId: intent.phoneNumberId, businessAccountId: waba?.businessAccountId ?? "-", market: intent.market, timezone, at: now });
    const pricing = { engine, counters, timezone, currency, quotaUsed: 0, tierPosition: 0, authInternationalEligible: waba?.authInternationalEligible ?? false };
    const rec = toIntentRecord(intent);
    const nowCost = priceAt(rec, now, rec.messageKind, rec.category, context, pricing, false);
    const laterCost = priceAt(rec, intent.scheduledFor, rec.messageKind, rec.category, context, pricing, false);
    if (nowCost.freeReason !== "free_entry_point_window" || laterCost.isFree) continue;

    if (intent.status === MessageStatus.QUEUED) {
      // Already an attempt with a delayed dispatch job: release the job now.
      const attempt = await ctx.db.messageAttempt.findFirst({ where: { tenantId: tenant.id, intentId: intent.id, status: MessageStatus.QUEUED }, orderBy: { attemptNumber: "desc" } });
      const job = attempt ? await ctx.queues[QUEUE.DISPATCH].getJob(`dispatch-${attempt.id}`) : undefined;
      if (!job || !(await job.isDelayed())) continue;
      await job.promote();
    } else {
      // Still in the buffer: its flush time becomes now.
      flush.add(intent.groupKey);
    }
    const updated = await ctx.db.messageIntent.updateMany({
      where: { id: intent.id, tenantId: tenant.id, status: intent.status },
      data: { scheduledFor: now, decisionReason: appendReason(intent.decisionReason, RoutingReason.FEP_PRIORITY) },
    });
    if (updated.count === 0) continue;
    await event(ctx.db, { tenantId: tenant.id, type: "DECISION", intentId: intent.id, conversationId, occurredAt: now, data: { action: "FEP_PRIORITY", reasons: [RoutingReason.FEP_PRIORITY], from: intent.scheduledFor, to: now } });
    await audit(ctx.db, { tenantId: tenant.id, action: "intent.reprioritized", entityType: "MessageIntent", entityId: intent.id, data: { reason: RoutingReason.FEP_PRIORITY } });
    metrics.routingDecisions.inc({ tenant_id: tenant.id, reason: RoutingReason.FEP_PRIORITY });
    moved++;
  }
  for (const group of flush) await enqueueFlush(ctx, tenant.id, group, now);
  return moved;
}
