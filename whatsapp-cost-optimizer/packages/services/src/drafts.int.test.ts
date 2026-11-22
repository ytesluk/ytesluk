import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@wco/domain";
import { migrateTestDatabase, TEST_APP_SECRET, truncateAll, useTestEnv } from "@wco/testing";
import { buildInboundPayload, computeSignature } from "@wco/whatsapp";
import { createAppContext, flushPendingSends, getInboxConversation, ingestWebhook, listPendingSends, processWebhook, seedAll, sendDraftInChat, sendDraftToList, type Actor, type AppContext } from "./index";

/**
 * Integration tests (PostgreSQL + Redis, mock WhatsApp) of "write your own message": the text goes to
 * Meta as a template and is sent once Meta approves it (at once in the mock, or later via webhook).
 */
let ctx: AppContext;
let acme: Actor;

beforeAll(async () => {
  useTestEnv();
  migrateTestDatabase();
  ctx = createAppContext({ service: "test", subscribe: false });
  await truncateAll(ctx.db);
  await ctx.redis.flushdb();
  const s = await seedAll(ctx, { demoHistory: false });
  acme = { type: "SYSTEM", id: null, tenantId: s.acmeTenantId, role: Role.OWNER };
});

afterAll(async () => {
  await ctx?.close();
});

async function metaPost(payload: Record<string, unknown>) {
  const raw = Buffer.from(JSON.stringify(payload));
  const r = await ingestWebhook(ctx, { rawBody: raw, signature: computeSignature(raw, TEST_APP_SECRET) });
  await processWebhook(ctx, { webhookEventId: r.id! }, { finalAttempt: true });
}

const templateStatus = (name: string, event: string, reason?: string) =>
  metaPost({
    object: "whatsapp_business_account",
    entry: [{ id: "mock-waba-acme", changes: [{ field: "message_template_status_update", value: { event, message_template_id: 99, message_template_name: name, message_template_language: "pt_BR", ...(reason ? { reason } : {}) } }] }],
  });

/** A template the company wrote, still under Meta's review, with one customer waiting for it. */
async function waitingDraft(name: string) {
  const waba = await ctx.db.waba.findFirstOrThrow({ where: { tenantId: acme.tenantId } });
  const customer = await ctx.db.customer.findFirstOrThrow({ where: { tenantId: acme.tenantId, phoneEncrypted: { not: null } } });
  const t = await ctx.db.template.create({
    data: { tenantId: acme.tenantId, wabaId: waba.id, name, language: "pt_BR", declaredCategory: "UTILITY", status: "PENDING", components: [{ type: "BODY", text: "Seu pedido chegou na loja.", params: [], parameterFormat: "NAMED" }] },
  });
  await ctx.db.pendingSend.create({ data: { tenantId: acme.tenantId, templateId: t.id, customerIds: [customer.id], consentSource: "test" } });
  return t;
}

describe("Write your own message", () => {
  it("a list: the text goes to Meta and, once approved (the mock approves at once), to every valid number", async () => {
    const r = await sendDraftToList(ctx, acme, { text: "Olá! Sua encomenda já pode ser retirada na loja do centro.", customers: ["+5511950009301", "+5511950009302", "sem-numero"], consent: { optIn: true, source: "test" } });
    expect(r).toMatchObject({ customers: 2, sent: 2, failed: 0, invalidLines: [3], template: { status: "APPROVED" } });
    expect(r.template.name).toMatch(/^wco_msg_\d+$/);
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, templateName: r.template.name } })).toBe(2);
    expect(await ctx.db.pendingSend.findUniqueOrThrow({ where: { id: r.pendingSendId } })).toMatchObject({ status: "SENT", sent: 2 });
  });

  it("refuses variables in the text and requires consent for a list", async () => {
    await expect(sendDraftToList(ctx, acme, { text: "Oi {{nome}}", customers: ["+5511950009303"], consent: { optIn: true } })).rejects.toThrow();
    await expect(sendDraftToList(ctx, acme, { text: "Olá!", customers: ["+5511950009303"], consent: { optIn: false } })).rejects.toThrow();
  });

  it("a chat whose window closed: the agent's own text is sent and shows up in the conversation", async () => {
    await metaPost(buildInboundPayload({ wabaId: "mock-waba-acme", phoneNumberId: "mock-pn-acme-1", from: "5511950009310", text: "Oi, ainda tem o produto?", timestamp: new Date(ctx.now().getTime() - 30 * 3_600_000) }));
    const conv = await ctx.db.conversation.findFirstOrThrow({ where: { tenantId: acme.tenantId }, orderBy: { createdAt: "desc" } });
    const r = await sendDraftInChat(ctx, acme, conv.id, { text: "Oi! Chegou ontem, pode passar aqui quando quiser." });
    expect(r).toMatchObject({ customers: 1, sent: 1 });
    const chat = await getInboxConversation(ctx, acme.tenantId, conv.id);
    expect(chat.windowOpen).toBe(false);
    expect(chat.messages.at(-1)).toMatchObject({ direction: "OUT", kind: "template", text: "Oi! Chegou ontem, pode passar aqui quando quiser." });
  });

  it("under Meta's review: waits, and goes out when Meta approves it", async () => {
    const t = await waitingDraft("wco_msg_aprova_depois");
    expect((await listPendingSends(ctx, acme.tenantId)).map((p) => p.templateStatus)).toContain("PENDING");
    await templateStatus(t.name, "APPROVED");
    const p = await ctx.db.pendingSend.findFirstOrThrow({ where: { templateId: t.id } });
    expect(p).toMatchObject({ status: "SENT", sent: 1 });
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, templateName: t.name } })).toBe(1);
    // Sending again (a repeated approval, or the immediate path racing the webhook) sends nothing twice.
    expect(await flushPendingSends(ctx, acme.tenantId, t.id)).toEqual({ sent: 0, failed: 0 });
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, templateName: t.name } })).toBe(1);
  });

  it("rejected by Meta: nothing is sent, the wait is cancelled and the company gets an alert", async () => {
    const t = await waitingDraft("wco_msg_recusada");
    await templateStatus(t.name, "REJECTED", "INVALID_FORMAT");
    expect(await ctx.db.pendingSend.findFirstOrThrow({ where: { templateId: t.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, templateName: t.name } })).toBe(0);
    const alert = await ctx.db.alert.findFirstOrThrow({ where: { tenantId: acme.tenantId, type: "TEMPLATE_REJECTED" } });
    expect(alert.message).toContain("INVALID_FORMAT");
  });
});
