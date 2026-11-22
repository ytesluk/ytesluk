import { z } from "zod";
import { Errors, isAppError, Role } from "@wco/domain";
import { analyzeCategory } from "@wco/optimization";
import { audit } from "./audit";
import { BULK_EVENT, BULK_MAX } from "./bulk-send";
import { publishTenantChanged, type Actor, type AppContext } from "./context";
import { INBOX_EVENT_TEMPLATE } from "./inbox";
import { createIntent } from "./intents";
import { TEMPLATE_STATUS } from "./template-sync";

/**
 * "Escreva a sua mensagem": the company writes the text itself, in a chat whose 24 h window closed
 * or for a list of customers. Outside the window Meta only delivers approved templates, so the WCO
 * submits the text to Meta as a template and sends it on its own as soon as Meta approves it (the
 * template status webhook), or cancels it and tells the company if Meta rejects it.
 * Phones are never stored here: customers are referenced by id.
 */
const NAME_PREFIX = "wco_msg_";
const LANGUAGE = "pt_BR";

export const DraftTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((t) => !/\{\{|\}\}/.test(t), "Escreva o texto sem chaves {{ }}");

export const DraftSendSchema = z.object({
  text: DraftTextSchema,
  customers: z.array(z.string().min(8).max(32)).min(1).max(BULK_MAX),
  consent: z.object({ optIn: z.literal(true), source: z.string().max(100).default("painel") }),
});

export const DraftReplySchema = z.object({ text: DraftTextSchema });

/** The category the company's text is likely to get from Meta (Meta decides; marketing costs more). */
function categoryFor(text: string): "UTILITY" | "MARKETING" {
  return analyzeCategory(text).category === "MARKETING" ? "MARKETING" : "UTILITY";
}

async function submitTemplate(ctx: AppContext, actor: Actor, text: string) {
  const tenant = await ctx.tenants.get(actor.tenantId);
  const waba = [...tenant.wabas.values()][0];
  if (!waba) throw Errors.validation("Conecte o WhatsApp da empresa antes de enviar.");
  const provider = ctx.provider(waba);
  const creds = { accessToken: waba.accessTokenEncrypted ? ctx.vault.decryptSecret(waba.accessTokenEncrypted) : (ctx.config.meta.devCredentials.accessToken ?? "mock-token") };
  const now = ctx.now();
  const name = `${NAME_PREFIX}${now.toISOString().replace(/\D/g, "").slice(0, 17)}`;
  const category = categoryFor(text);
  let created;
  try {
    created = await provider.createTemplate(waba.metaWabaId, { name, language: LANGUAGE, category, body: text, namedParams: [] }, creds);
  } catch (e) {
    if (isAppError(e)) throw Errors.validation(`A Meta não aceitou a mensagem: ${e.message}`);
    throw e;
  }
  const status = TEMPLATE_STATUS[created.status.toUpperCase()] ?? "PENDING";
  const metaCategory = created.category.toUpperCase();
  const template = await ctx.db.template.create({
    data: {
      tenantId: actor.tenantId,
      wabaId: waba.id,
      name,
      language: LANGUAGE,
      declaredCategory: category,
      metaCategory: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(metaCategory) ? metaCategory : null) as never,
      status,
      components: [{ type: "BODY", text, params: [], parameterFormat: "NAMED" }],
      externalId: created.id,
      ...(status === "APPROVED" ? { approvedAt: now } : {}),
      ...(status === "REJECTED" ? { rejectedAt: now } : {}),
    },
  });
  await publishTenantChanged(ctx, actor.tenantId);
  return template;
}

async function queue(ctx: AppContext, actor: Actor, text: string, target: { customerIds: string[]; conversationId?: string; consentSource?: string }) {
  const template = await submitTemplate(ctx, actor, text);
  const pending = await ctx.db.pendingSend.create({
    data: {
      tenantId: actor.tenantId,
      templateId: template.id,
      customerIds: target.customerIds,
      conversationId: target.conversationId ?? null,
      authorUserId: actor.type === "USER" ? actor.id : null,
      consentSource: target.consentSource ?? null,
    },
  });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "draft.submitted", entityType: "Template", entityId: template.id, data: { name: template.name, status: template.status, customers: target.customerIds.length, chat: !!target.conversationId } });
  let result = { sent: 0, failed: 0 };
  if (template.status === "APPROVED") result = await flushPendingSends(ctx, actor.tenantId, template.id);
  else if (template.status === "REJECTED") await cancelPendingSends(ctx, actor.tenantId, template.id, "rejected");
  return {
    pendingSendId: pending.id,
    template: { name: template.name, status: template.status, category: template.metaCategory ?? template.declaredCategory },
    customers: target.customerIds.length,
    ...result,
  };
}

/** A list of customers, from "Enviar mensagens". */
export async function sendDraftToList(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = DraftSendSchema.parse(raw);
  const ids: string[] = [];
  const bad: number[] = [];
  for (const [i, c] of input.customers.entries()) {
    try {
      const p = ctx.vault.phone(c.trim());
      const row = await ctx.db.customer.upsert({
        where: { tenantId_phoneHash: { tenantId: actor.tenantId, phoneHash: p.hash } },
        create: { tenantId: actor.tenantId, phoneHash: p.hash, phoneEncrypted: p.encrypted, phoneMasked: p.masked },
        update: {},
      });
      if (!ids.includes(row.id)) ids.push(row.id);
    } catch {
      bad.push(i + 1);
    }
  }
  if (!ids.length) throw Errors.validation("Nenhum número válido na lista.");
  const r = await queue(ctx, actor, input.text, { customerIds: ids, consentSource: input.consent.source });
  return { ...r, invalidLines: bad };
}

/** One chat whose 24 h window closed, from "Conversas". */
export async function sendDraftInChat(ctx: AppContext, actor: Actor, conversationId: string, raw: unknown) {
  const { text } = DraftReplySchema.parse(raw);
  const c = await ctx.db.conversation.findFirst({ where: { id: conversationId, tenantId: actor.tenantId }, select: { id: true, customerId: true } });
  if (!c) throw Errors.notFound("Conversation");
  return queue(ctx, actor, text, { customerIds: [c.customerId], conversationId: c.id });
}

/** What is still waiting for Meta, for the dashboard. */
export async function listPendingSends(ctx: AppContext, tenantId: string) {
  const rows = await ctx.db.pendingSend.findMany({ where: { tenantId, status: { in: ["WAITING", "SENDING"] } }, orderBy: { createdAt: "desc" }, take: 50 });
  const templates = await ctx.db.template.findMany({ where: { tenantId, id: { in: rows.map((r) => r.templateId) } }, select: { id: true, name: true, status: true, components: true } });
  const byId = new Map(templates.map((t) => [t.id, t]));
  return rows.map((r) => {
    const t = byId.get(r.templateId);
    const body = Array.isArray(t?.components) ? (t!.components as Array<{ type?: string; text?: string }>).find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text : undefined;
    return { id: r.id, text: body ?? null, templateStatus: t?.status ?? null, customers: r.customerIds.length, chat: !!r.conversationId, createdAt: r.createdAt };
  });
}

/**
 * Meta approved the template: send every waiting message that uses it. Claimed atomically (WAITING →
 * SENDING) so the webhook and the immediate path never send twice.
 */
export async function flushPendingSends(ctx: AppContext, tenantId: string, templateId: string): Promise<{ sent: number; failed: number }> {
  const template = await ctx.db.template.findFirst({ where: { id: templateId, tenantId } });
  if (!template || template.status !== "APPROVED") return { sent: 0, failed: 0 };
  ctx.tenants.invalidate(tenantId); // the approval just landed: read the template as approved
  const text = Array.isArray(template.components) ? (template.components as Array<{ type?: string; text?: string }>).find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text ?? null : null;
  const waiting = await ctx.db.pendingSend.findMany({ where: { tenantId, templateId, status: "WAITING" } });
  const system: Actor = { type: "SYSTEM", id: null, tenantId, role: Role.OWNER };
  const total = { sent: 0, failed: 0 };
  for (const p of waiting) {
    const claimed = await ctx.db.pendingSend.updateMany({ where: { id: p.id, status: "WAITING" }, data: { status: "SENDING" } });
    if (claimed.count === 0) continue;
    const conv = p.conversationId ? await ctx.db.conversation.findFirst({ where: { id: p.conversationId, tenantId }, select: { id: true, phoneNumberId: true } }) : null;
    const customers = await ctx.db.customer.findMany({ where: { tenantId, id: { in: p.customerIds } }, select: { id: true, phoneEncrypted: true } });
    let sent = 0;
    let failed = 0;
    for (const c of customers) {
      const phone = ctx.vault.decryptPhone(c.phoneEncrypted);
      if (!phone) {
        failed++;
        continue;
      }
      try {
        const r = await createIntent(ctx, system, {
          customer: phone,
          eventType: conv ? INBOX_EVENT_TEMPLATE : BULK_EVENT,
          template: { name: template.name, language: template.language },
          data: {},
          idempotencyKey: `pending-${p.id}-${c.id}`,
          ...(conv ? { entityId: `chat:${conv.id}`, phoneNumberId: conv.phoneNumberId, mustSendImmediately: true } : { consent: { optIn: true, source: p.consentSource ?? "painel" } }),
        });
        if (conv) {
          const now = ctx.now();
          await ctx.db.chatMessage.create({
            data: { tenantId, conversationId: conv.id, direction: "OUT", kind: "template", bodyEncrypted: text ? ctx.vault.encryptSecret(text) : null, templateName: template.name, intentId: r.intentId, authorUserId: p.authorUserId, occurredAt: now },
          });
          await ctx.db.conversation.update({ where: { id: conv.id }, data: { updatedAt: now } });
        }
        sent++;
      } catch {
        failed++;
      }
    }
    failed += p.customerIds.length - customers.length;
    await ctx.db.pendingSend.update({ where: { id: p.id }, data: { status: "SENT", sent, failed, sentAt: ctx.now() } });
    total.sent += sent;
    total.failed += failed;
  }
  return total;
}

/** Meta rejected (or disabled) the template: nothing is sent, and the company is told. */
export async function cancelPendingSends(ctx: AppContext, tenantId: string, templateId: string, reason: string): Promise<number> {
  const r = await ctx.db.pendingSend.updateMany({ where: { tenantId, templateId, status: "WAITING" }, data: { status: "CANCELLED" } });
  if (r.count > 0) {
    await audit(ctx.db, { tenantId, action: "draft.cancelled", entityType: "Template", entityId: templateId, data: { reason, pending: r.count } });
  }
  return r.count;
}
