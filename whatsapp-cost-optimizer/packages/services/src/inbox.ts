import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Errors } from "@wco/domain";
import { audit } from "./audit";
import { publishTenantChanged, type Actor, type AppContext } from "./context";
import { createIntent } from "./intents";

/**
 * Inbox: agents chat with customers INSIDE the WCO, so every reply goes through the optimizer.
 *   - consecutive short replies are joined into one message (policy "agent.reply");
 *   - free-form text only while the customer service window is open (Meta rule); outside it, only an
 *     approved template, which is a paid message;
 *   - deadlines that matter for cost are shown: the window closing, and the 24 h to answer a lead
 *     that came from an ad (Free Entry Point → 72 h free).
 * Message texts are stored only when the tenant turns the inbox on (encrypted, payload retention).
 */
export const INBOX_EVENT_REPLY = "agent.reply";
export const INBOX_EVENT_TEMPLATE = "agent.template";
const PREVIEW = 90;

const entityOf = (conversationId: string) => `chat:${conversationId}`;

export async function setInboxEnabled(ctx: AppContext, actor: Actor, raw: unknown) {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(raw);
  await ctx.db.tenant.update({ where: { id: actor.tenantId }, data: { inboxEnabled: enabled } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: enabled ? "inbox.enabled" : "inbox.disabled", entityType: "Tenant", entityId: actor.tenantId });
  await publishTenantChanged(ctx, actor.tenantId);
  return { enabled };
}

function decrypt(ctx: AppContext, body: string | null): string | null {
  if (!body) return null;
  try {
    return ctx.vault.decryptSecret(body);
  } catch {
    return null;
  }
}

/** Window and Free Entry Point state of a conversation, as the agent needs it. */
function deadlines(
  now: Date,
  c: { window: { expiresAt: Date } | null; entryPoints: Array<{ eligibility: string; userMessageAt: Date; firstBusinessReplyAt: Date | null; freeWindowExpiresAt: Date | null }> },
) {
  const windowOpen = !!c.window && c.window.expiresAt > now;
  const ep = [...c.entryPoints].sort((a, b) => b.userMessageAt.getTime() - a.userMessageAt.getTime())[0];
  let fep: { state: "REPLY_TO_UNLOCK" | "FREE_OPEN" | "LOST" | "EXPIRED"; until: Date | null } | null = null;
  if (ep) {
    const replyBy = new Date(ep.userMessageAt.getTime() + 24 * 3_600_000);
    if (ep.freeWindowExpiresAt && ep.freeWindowExpiresAt > now) fep = { state: "FREE_OPEN", until: ep.freeWindowExpiresAt };
    else if (!ep.firstBusinessReplyAt && replyBy > now && ep.eligibility !== "NOT_ELIGIBLE") fep = { state: "REPLY_TO_UNLOCK", until: replyBy };
    else if (ep.eligibility === "NOT_ELIGIBLE" || (!ep.firstBusinessReplyAt && replyBy <= now)) fep = { state: "LOST", until: null };
    else fep = { state: "EXPIRED", until: ep.freeWindowExpiresAt };
  }
  return { windowOpen, windowExpiresAt: c.window?.expiresAt ?? null, fep };
}

export async function listInbox(ctx: AppContext, tenantId: string) {
  const now = ctx.now();
  // Only conversations with a stored transcript: older ones (before the inbox) have no texts to show.
  const rows = await ctx.db.conversation.findMany({
    where: { tenantId, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      customer: { select: { phoneMasked: true } },
      window: { select: { expiresAt: true } },
      entryPoints: { select: { eligibility: true, userMessageAt: true, firstBusinessReplyAt: true, freeWindowExpiresAt: true } },
      messages: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
  });
  const items = rows.map((c) => {
    const last = c.messages[0];
    const preview = last ? (decrypt(ctx, last.bodyEncrypted) ?? (last.templateName ? `[template ${last.templateName}]` : `[${last.kind}]`)) : null;
    const lastAt = last?.occurredAt ?? c.lastInboundAt ?? c.updatedAt;
    return {
      id: c.id,
      customer: c.customer.phoneMasked,
      lastMessage: preview ? (preview.length > PREVIEW ? `${preview.slice(0, PREVIEW)}…` : preview) : null,
      lastDirection: last?.direction ?? null,
      lastAt,
      waitingReply: last ? last.direction === "IN" : !!c.lastInboundAt && (!c.lastOutboundAt || c.lastOutboundAt < c.lastInboundAt),
      ...deadlines(now, c),
    };
  });
  items.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return { inboxEnabled: (await ctx.tenants.get(tenantId)).inboxEnabled, conversations: items };
}

const SENT = new Set(["SENT", "DELIVERED", "READ"]);
const ENDED = new Set(["FAILED", "BLOCKED", "CANCELLED", "DEDUPLICATED", "SUPERSEDED"]);

const STATUS_LABEL: Record<string, string> = {
  PENDING_OPTIMIZATION: "aguardando",
  QUEUED: "aguardando",
  DELAYED: "aguardando mais mensagens",
  READY_TO_SEND: "enviando",
  SENDING: "enviando",
  SENT: "enviada",
  DELIVERED: "entregue",
  READ: "lida",
  FAILED: "falhou",
  CONSOLIDATED: "juntada à próxima",
  BLOCKED: "bloqueada",
  CANCELLED: "cancelada",
  DEDUPLICATED: "repetida",
  SUPERSEDED: "substituída",
};

export async function getInboxConversation(ctx: AppContext, tenantId: string, conversationId: string) {
  const c = await ctx.db.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      customer: { select: { phoneMasked: true, optedOutAt: true } },
      window: { select: { expiresAt: true } },
      entryPoints: { select: { eligibility: true, userMessageAt: true, firstBusinessReplyAt: true, freeWindowExpiresAt: true } },
      messages: { orderBy: { occurredAt: "asc" }, take: 500 },
    },
  });
  if (!c) throw Errors.notFound("Conversation");
  const intentIds = c.messages.map((m) => m.intentId).filter((x): x is string => !!x);
  const intents = intentIds.length
    ? await ctx.db.messageIntent.findMany({ where: { tenantId, id: { in: intentIds } }, select: { id: true, status: true, estimatedCost: true, realizedCost: true, currency: true, consolidatedIntoId: true } })
    : [];
  const byId = new Map(intents.map((i) => [i.id, i]));
  const messages = c.messages.map((m) => {
    const i = m.intentId ? byId.get(m.intentId) : undefined;
    return {
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      text: decrypt(ctx, m.bodyEncrypted),
      purged: !!m.bodyPurgedAt,
      templateName: m.templateName,
      occurredAt: m.occurredAt,
      status: i ? { code: i.status, label: STATUS_LABEL[i.status] ?? i.status, joinedInto: i.consolidatedIntoId } : null,
    };
  });
  // Typed replies vs WhatsApp messages actually sent: the difference is what joining saved.
  const typed = intents.length;
  const joined = intents.filter((i) => i.status === "CONSOLIDATED").length;
  const sent = intents.filter((i) => SENT.has(i.status)).length;
  return {
    id: c.id,
    customer: c.customer.phoneMasked,
    optedOut: !!c.customer.optedOutAt,
    ...deadlines(ctx.now(), c),
    messages,
    savings: { repliesTyped: typed, messagesSent: sent, joined, pending: typed - sent - joined - intents.filter((i) => ENDED.has(i.status)).length },
  };
}

export const InboxReplySchema = z.union([
  z.object({ text: z.string().trim().min(1).max(4096) }),
  z.object({ template: z.object({ name: z.string().min(1), language: z.string().min(2) }), data: z.record(z.string(), z.string()).default({}) }),
]);

/**
 * An agent's reply. Free-form text needs the customer service window open (Meta rule) and is joined
 * with the agent's next messages of the next few seconds; a template is sent right away (paid).
 */
export async function sendInboxReply(ctx: AppContext, actor: Actor, conversationId: string, raw: unknown) {
  const input = InboxReplySchema.parse(raw);
  const tenant = await ctx.tenants.get(actor.tenantId);
  if (!tenant.inboxEnabled) throw Errors.validation("Ative a caixa de entrada antes de responder por ela");
  const c = await ctx.db.conversation.findFirst({ where: { id: conversationId, tenantId: actor.tenantId }, include: { customer: true, window: true } });
  if (!c) throw Errors.notFound("Conversation");
  const phone = ctx.vault.decryptPhone(c.customer.phoneEncrypted);
  if (!phone) throw Errors.validation("Os dados deste cliente foram apagados (LGPD)");
  const now = ctx.now();
  const base = { customer: phone, entityId: entityOf(c.id), phoneNumberId: c.phoneNumberId, idempotencyKey: `inbox-${randomUUID()}` };

  let intentId: string;
  if ("text" in input) {
    if (!c.window || c.window.expiresAt <= now) {
      throw Errors.conflict("Janela de atendimento fechada: a Meta só permite enviar um template aprovado (mensagem paga).");
    }
    // `text` also goes into data so two different replies never look identical to the optimizer.
    intentId = (await createIntent(ctx, actor, { ...base, eventType: INBOX_EVENT_REPLY, category: "SERVICE", text: input.text, data: { text: input.text } })).intentId;
  } else {
    const template = tenant.templates.get(input.template.name);
    if (!template || !template.approved) throw Errors.validation(`Template ${input.template.name} não está aprovado`);
    intentId = (await createIntent(ctx, actor, { ...base, eventType: INBOX_EVENT_TEMPLATE, template: input.template, data: input.data, mustSendImmediately: true })).intentId;
  }
  const msg = await ctx.db.chatMessage.create({
    data: {
      tenantId: actor.tenantId,
      conversationId: c.id,
      direction: "OUT",
      kind: "text" in input ? "text" : "template",
      bodyEncrypted: "text" in input ? ctx.vault.encryptSecret(input.text) : null,
      templateName: "text" in input ? null : input.template.name,
      intentId,
      authorUserId: actor.type === "USER" ? actor.id : null,
      occurredAt: now,
    },
  });
  await ctx.db.conversation.update({ where: { id: c.id }, data: { updatedAt: now } });
  return { messageId: msg.id, intentId };
}
