import { z } from "zod";
import { Errors } from "@wco/domain";
import { ALLOWED_RETENTION_DAYS } from "@wco/policy";
import { audit } from "./audit";
import type { Actor, AppContext } from "./context";

/**
 * LGPD (spec §24): data subject export and deletion, consent records, retention configuration.
 * Deletion anonymizes: the encrypted phone and payloads are erased, aggregated savings remain.
 */
export async function exportCustomerData(ctx: AppContext, actor: Actor, phone: string) {
  const hash = ctx.vault.hashPhone(phone);
  const customer = await ctx.db.customer.findFirst({ where: { tenantId: actor.tenantId, phoneHash: hash } });
  if (!customer) throw Errors.notFound("Customer");
  const [consents, intents, conversations] = await Promise.all([
    ctx.db.consentRecord.findMany({ where: { tenantId: actor.tenantId, customerId: customer.id }, orderBy: { occurredAt: "asc" } }),
    ctx.db.messageIntent.findMany({
      where: { tenantId: actor.tenantId, customerId: customer.id },
      select: { id: true, eventType: true, status: true, category: true, templateName: true, requestedAt: true, sentAt: true, deliveredAt: true, readAt: true, data: true, payloadPurgedAt: true },
      orderBy: { requestedAt: "asc" },
    }),
    ctx.db.conversation.findMany({ where: { tenantId: actor.tenantId, customerId: customer.id }, include: { window: true, entryPoints: true } }),
  ]);
  const request = await ctx.db.dataSubjectRequest.create({ data: { tenantId: actor.tenantId, type: "EXPORT", customerHash: hash, status: "COMPLETED", requestedBy: actor.id, completedAt: ctx.now(), result: { intents: intents.length, consents: consents.length } } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "privacy.export", entityType: "Customer", entityId: customer.id, data: { requestId: request.id } });
  return {
    requestId: request.id,
    customer: { phone: ctx.vault.decryptPhone(customer.phoneEncrypted), createdAt: customer.createdAt, optedInAt: customer.optedInAt, optedOutAt: customer.optedOutAt, marketingOptedOutAt: customer.marketingOptedOutAt, market: customer.market },
    consents,
    messages: intents,
    conversations: conversations.map((c) => ({ id: c.id, lastInboundAt: c.lastInboundAt, lastOutboundAt: c.lastOutboundAt, window: c.window, entryPoints: c.entryPoints.map((e) => ({ type: e.type, occurredAt: e.occurredAt, verificationStatus: e.verificationStatus })) })),
    note: "Message contents of inbound messages are never stored by WCO.",
  };
}

export async function deleteCustomerData(ctx: AppContext, actor: Actor, phone: string) {
  const hash = ctx.vault.hashPhone(phone);
  const customer = await ctx.db.customer.findFirst({ where: { tenantId: actor.tenantId, phoneHash: hash } });
  if (!customer) throw Errors.notFound("Customer");
  const now = ctx.now();
  const result = await ctx.db.$transaction(async (tx) => {
    const intents = await tx.messageIntent.updateMany({ where: { tenantId: actor.tenantId, customerId: customer.id }, data: { data: {}, freeFormText: null, payloadPurgedAt: now } });
    const attempts = await tx.messageAttempt.updateMany({ where: { tenantId: actor.tenantId, intent: { customerId: customer.id } }, data: { payload: null as never } });
    const convs = await tx.conversation.findMany({ where: { tenantId: actor.tenantId, customerId: customer.id }, select: { id: true } });
    const events = await tx.conversationEvent.deleteMany({ where: { tenantId: actor.tenantId, conversationId: { in: convs.map((c) => c.id) } } });
    await tx.customer.update({ where: { id: customer.id }, data: { phoneEncrypted: null, phoneMasked: "[erased]", erasedAt: now, optedOutAt: now } });
    return { intents: intents.count, attempts: attempts.count, events: events.count };
  });
  const request = await ctx.db.dataSubjectRequest.create({ data: { tenantId: actor.tenantId, type: "DELETE", customerHash: hash, status: "COMPLETED", requestedBy: actor.id, completedAt: now, result } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "privacy.delete", entityType: "Customer", entityId: customer.id, data: { requestId: request.id, ...result } });
  return { requestId: request.id, ...result, note: "Phone erased, payloads purged; aggregated savings and audit trail are kept (legal basis: accountability)." };
}

export const RetentionSchema = z.object({
  retentionDays: z.number().int().refine((d) => (ALLOWED_RETENTION_DAYS as readonly number[]).includes(d), "retentionDays must be one of 30, 90, 180, 365"),
  auditRetentionDays: z.number().int().min(90).max(3650).optional(),
  rawWebhookRetentionDays: z.number().int().min(1).max(365).optional(),
  payloadRetentionDays: z.number().int().min(1).max(365).optional(),
});

export async function getRetention(ctx: AppContext, tenantId: string) {
  return (await ctx.db.dataRetentionPolicy.findUnique({ where: { tenantId } })) ?? { tenantId, retentionDays: 90, auditRetentionDays: 365, rawWebhookRetentionDays: 30, payloadRetentionDays: 30 };
}

export async function setRetention(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = RetentionSchema.parse(raw);
  const row = await ctx.db.dataRetentionPolicy.upsert({ where: { tenantId: actor.tenantId }, create: { tenantId: actor.tenantId, ...input }, update: input });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "privacy.retention.updated", entityType: "DataRetentionPolicy", entityId: row.id, data: input });
  return row;
}

export const ConsentSchema = z.object({ customer: z.string().min(8), type: z.enum(["OPT_IN", "OPT_OUT"]), scope: z.enum(["ALL", "MARKETING"]).default("ALL"), source: z.string().max(100).default("API") });

export async function recordConsent(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = ConsentSchema.parse(raw);
  const p = ctx.vault.phone(input.customer);
  const now = ctx.now();
  const customer = await ctx.db.customer.upsert({
    where: { tenantId_phoneHash: { tenantId: actor.tenantId, phoneHash: p.hash } },
    create: { tenantId: actor.tenantId, phoneHash: p.hash, phoneEncrypted: p.encrypted, phoneMasked: p.masked },
    update: {},
  });
  await ctx.db.consentRecord.create({ data: { tenantId: actor.tenantId, customerId: customer.id, type: input.type, scope: input.scope, source: input.source, occurredAt: now } });
  const data =
    input.type === "OPT_IN"
      ? input.scope === "ALL"
        ? { optedInAt: now, optedOutAt: null }
        : { marketingOptedOutAt: null }
      : input.scope === "ALL"
        ? { optedOutAt: now }
        : { marketingOptedOutAt: now };
  await ctx.db.customer.update({ where: { id: customer.id }, data });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: `consent.${input.type.toLowerCase()}`, entityType: "Customer", entityId: customer.id, data: { scope: input.scope, source: input.source } });
  return { customerId: customer.id, ...input, customer: p.masked };
}
