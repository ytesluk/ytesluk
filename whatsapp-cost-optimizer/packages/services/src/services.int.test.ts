import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant } from "@wco/database";
import { Role } from "@wco/domain";
import { TEST_APP_SECRET, migrateTestDatabase, statusWebhook, truncateAll, useTestEnv } from "@wco/testing";
import { buildInboundPayload, computeSignature } from "@wco/whatsapp";
import {
  authenticateBearer,
  billingOverview,
  closeBillingPeriod,
  createAppContext,
  createIntent,
  deleteCustomerData,
  dispatchAttempt,
  exportCustomerData,
  getIntentAudit,
  ingestWebhook,
  listIntents,
  optimizeIntent,
  processWebhook,
  seedAll,
  planUsageAlerts,
  signup,
  flushGroup,
  getInboxConversation,
  listInbox,
  sendInboxReply,
  setInboxEnabled,
  syncTemplates,
  setWebhookOverride,
  summary,
  type Actor,
  type AppContext,
} from "./index";

/**
 * Integration tests (PostgreSQL + Redis): tenant isolation (spec §41 case 9), webhook idempotency
 * (case 10), signature validation, billing realization from Meta's pricing object and LGPD flows.
 */
let ctx: AppContext;
let demo: Actor;
let acme: Actor;

beforeAll(async () => {
  useTestEnv();
  migrateTestDatabase();
  ctx = createAppContext({ service: "test", subscribe: false });
  await truncateAll(ctx.db);
  await ctx.redis.flushdb();
  const s = await seedAll(ctx, { demoHistory: false });
  demo = { type: "SYSTEM", id: null, tenantId: s.demoTenantId, role: Role.OWNER };
  acme = { type: "SYSTEM", id: null, tenantId: s.acmeTenantId, role: Role.OWNER };
});

afterAll(async () => {
  await ctx?.close();
});

/** Runs the worker steps inline: optimize → dispatch (no BullMQ worker needed). */
async function sendNow(actor: Actor, body: Record<string, unknown>) {
  const r = await createIntent(ctx, actor, { mustSendImmediately: true, consent: { optIn: true, source: "test" }, ...body });
  await optimizeIntent(ctx, { tenantId: actor.tenantId, intentId: r.intentId });
  const attempt = await ctx.db.messageAttempt.findFirstOrThrow({ where: { tenantId: actor.tenantId, coveredIntentIds: { has: r.intentId } } });
  await dispatchAttempt(ctx, { tenantId: actor.tenantId, attemptId: attempt.id }, { finalAttempt: true });
  const intent = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: r.intentId } });
  return { intentId: r.intentId, phoneNumberId: intent.phoneNumberId, attempt: await ctx.db.messageAttempt.findUniqueOrThrow({ where: { id: attempt.id } }) };
}

describe("Case 9 — cross-tenant access", () => {
  it("a tenant cannot read another tenant's message audit, list or analytics", async () => {
    const r = await createIntent(ctx, demo, { customer: "+5511988880001", eventType: "payment.approved", entityId: "ORD-1", data: { orderId: "ORD-1" } });
    await expect(getIntentAudit(ctx, acme.tenantId, r.intentId)).rejects.toMatchObject({ httpStatus: 404 });
    const acmeList = await listIntents(ctx, acme.tenantId, { limit: 100 } as never);
    expect(JSON.stringify(acmeList)).not.toContain(r.intentId);
    const own = await getIntentAudit(ctx, demo.tenantId, r.intentId);
    expect(own.intent.id).toBe(r.intentId);
    const acmeSummary = await summary(ctx, acme.tenantId, {} as never);
    expect(acmeSummary.messages.processed).toBe(0);
  });

  it("the tenant guard scopes reads and refuses cross-tenant writes", async () => {
    const r = await createIntent(ctx, demo, { customer: "+5511988880002", eventType: "payment.approved", entityId: "ORD-2", data: { orderId: "ORD-2" } });
    const acmeDb = forTenant(ctx.db, acme.tenantId);
    expect(await acmeDb.messageIntent.findFirst({ where: { id: r.intentId } })).toBeNull();
    expect(await acmeDb.messageIntent.count()).toBe(0);
    await expect(acmeDb.messageIntent.update({ where: { id: r.intentId }, data: { decisionReason: "tampered" } })).rejects.toThrow();
    await expect(acmeDb.customer.create({ data: { tenantId: demo.tenantId, phoneHash: "x", phoneEncrypted: "x", phoneMasked: "x" } })).rejects.toThrow(/tenant/i);
    const untouched = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: r.intentId } });
    expect(untouched.decisionReason).not.toBe("tampered");
  });

  it("the same phone number is a different customer in each tenant", async () => {
    await createIntent(ctx, demo, { customer: "+5511988880003", eventType: "payment.approved", entityId: "A", data: {} });
    await createIntent(ctx, acme, { customer: "+5511988880003", eventType: "payment.approved", entityId: "A", data: {} });
    const rows = await ctx.db.customer.findMany({ where: { phoneMasked: { contains: "0003" } } });
    expect(new Set(rows.map((c) => c.tenantId)).size).toBe(2);
    expect(rows.every((c) => !(c.phoneEncrypted ?? "").includes("5511988880003"))).toBe(true);
  });
});

describe("Case 10 — duplicate webhook is processed once", () => {
  it("stores identical deliveries once and realizes the cost once", async () => {
    const { intentId, attempt, phoneNumberId } = await sendNow(demo, { customer: "+5511977770001", eventType: "authentication.otp", entityId: "login-1", data: { code: "123456" } });
    expect(attempt.providerMessageId).toBeTruthy();
    const tenant = await ctx.tenants.get(demo.tenantId);
    const phone = tenant.phones.find((p) => p.id === phoneNumberId)!;
    const waba = tenant.wabas.get(phone.wabaId)!;
    const payload = statusWebhook({
      wabaId: waba.metaWabaId,
      phoneNumberId: phone.metaPhoneNumberId,
      providerMessageId: attempt.providerMessageId!,
      recipientWaId: "5511977770001",
      status: "delivered",
      pricing: { billable: true, pricing_model: "PMP", category: "authentication", type: "regular" },
    });
    const raw = Buffer.from(JSON.stringify(payload));
    const sig = computeSignature(raw, TEST_APP_SECRET);

    const first = await ingestWebhook(ctx, { rawBody: raw, signature: sig });
    const second = await ingestWebhook(ctx, { rawBody: raw, signature: sig });
    expect(first.status).toBe(200);
    expect(second).toMatchObject({ status: 200, duplicate: true });
    expect(await ctx.db.webhookEvent.count({ where: { payloadHash: { not: "" } } })).toBe(1);

    expect((await processWebhook(ctx, { webhookEventId: first.id! }, { finalAttempt: true })).events).toBe(1);
    expect((await processWebhook(ctx, { webhookEventId: first.id! }, { finalAttempt: true })).events).toBe(0);

    // Same status re-serialized (different bytes): a new raw event, but the delivery is unique.
    const raw2 = Buffer.from(JSON.stringify(payload, null, 1));
    const third = await ingestWebhook(ctx, { rawBody: raw2, signature: computeSignature(raw2, TEST_APP_SECRET) });
    await processWebhook(ctx, { webhookEventId: third.id! }, { finalAttempt: true });
    expect(await ctx.db.messageDelivery.count({ where: { providerMessageId: attempt.providerMessageId!, status: "DELIVERED" } })).toBe(1);
    expect(await ctx.db.costDecision.count({ where: { messageIntentId: intentId, kind: "REALIZED" } })).toBe(1);

    const audit = await getIntentAudit(ctx, demo.tenantId, intentId);
    expect(audit.intent.realizedConfidence).toBe("REALIZED");
    expect(Number(audit.intent.realizedCost)).toBeGreaterThan(0);
  });

  it("rejects an invalid signature without storing anything", async () => {
    const before = await ctx.db.webhookEvent.count();
    const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    expect((await ingestWebhook(ctx, { rawBody: raw, signature: "sha256=deadbeef" })).status).toBe(401);
    expect((await ingestWebhook(ctx, { rawBody: raw, signature: undefined })).status).toBe(401);
    expect((await ingestWebhook(ctx, { rawBody: raw, signature: computeSignature(raw, "another-secret") })).status).toBe(401);
    expect(await ctx.db.webhookEvent.count()).toBe(before);
  });

  it("Meta's pricing object decides free vs billable (free when billable=false)", async () => {
    const { intentId, attempt, phoneNumberId } = await sendNow(demo, { customer: "+5511977770002", eventType: "authentication.otp", entityId: "login-2", data: { code: "654321" } });
    const tenant = await ctx.tenants.get(demo.tenantId);
    const phone = tenant.phones.find((p) => p.id === phoneNumberId)!;
    const payload = statusWebhook({
      wabaId: tenant.wabas.get(phone.wabaId)!.metaWabaId,
      phoneNumberId: phone.metaPhoneNumberId,
      providerMessageId: attempt.providerMessageId!,
      recipientWaId: "5511977770002",
      status: "delivered",
      pricing: { billable: false, pricing_model: "PMP", category: "authentication", type: "free_customer_service" },
    });
    const raw = Buffer.from(JSON.stringify(payload));
    const r = await ingestWebhook(ctx, { rawBody: raw, signature: computeSignature(raw, TEST_APP_SECRET) });
    await processWebhook(ctx, { webhookEventId: r.id! }, { finalAttempt: true });
    const intent = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(Number(intent.realizedCost)).toBe(0);
    expect(intent.realizedConfidence).toBe("REALIZED");
  });
});

describe("LGPD (spec §24)", () => {
  it("exports and erases a customer's data within the tenant only", async () => {
    await createIntent(ctx, demo, { customer: "+5511966660001", eventType: "payment.approved", entityId: "L-1", data: { orderId: "L-1" }, consent: { optIn: true, source: "checkout" } });
    await createIntent(ctx, acme, { customer: "+5511966660001", eventType: "payment.approved", entityId: "L-1", data: { orderId: "L-1" } });
    const exported = await exportCustomerData(ctx, demo, "+5511966660001");
    expect(JSON.stringify(exported)).toContain("L-1");
    await deleteCustomerData(ctx, demo, "+5511966660001");
    await expect(createIntent(ctx, demo, { customer: "+5511966660001", eventType: "payment.approved", entityId: "L-2", data: {} })).rejects.toMatchObject({ httpStatus: 400 });
    // The other tenant's relationship with the same person is untouched.
    const other = await createIntent(ctx, acme, { customer: "+5511966660001", eventType: "payment.approved", entityId: "L-3", data: {} });
    expect(other.intentId).toBeTruthy();
  });
});

describe("SaaS self-service signup", () => {
  const body = { companyName: "Padaria São João", name: "Ana", email: "ana@padaria.test", password: "senha-forte-123", acceptTerms: true };

  it("creates an isolated FREE tenant with its OWNER, default policies and a working session", async () => {
    const s = await signup(ctx, body);
    expect(s.user.role).toBe("OWNER");
    expect(s.user.tenant.slug).toBe("padaria-sao-joao");
    const actor = await authenticateBearer(ctx, s.token);
    expect(actor).toMatchObject({ tenantId: s.user.tenant.id, role: "OWNER" });
    const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, include: { subscription: true } });
    expect(tenant.plan).toBe("FREE");
    expect(tenant.subscription?.plan).toBe("FREE");
    expect(tenant.requireOptIn).toBe(true);
    expect(await ctx.db.optimizationPolicy.count({ where: { tenantId: actor.tenantId } })).toBeGreaterThan(0);
    expect(await ctx.db.waba.count({ where: { tenantId: actor.tenantId } })).toBe(0);
    expect((await listIntents(ctx, actor.tenantId, { limit: 100 } as never)).items).toHaveLength(0);
    const logged = await ctx.db.auditLog.findFirstOrThrow({ where: { tenantId: actor.tenantId, action: "tenant.signup" } });
    expect(logged.data).toMatchObject({ termsVersion: ctx.config.env.TERMS_VERSION });
  });

  it("refuses a duplicate e-mail, missing consent and keeps slugs unique", async () => {
    await expect(signup(ctx, { ...body, email: "ANA@padaria.test" })).rejects.toMatchObject({ httpStatus: 409 });
    await expect(signup(ctx, { ...body, email: "b@padaria.test", acceptTerms: false })).rejects.toThrow();
    const other = await signup(ctx, { ...body, email: "c@padaria.test" });
    expect(other.user.tenant.slug).toMatch(/^padaria-sao-joao-[0-9a-f]{6}$/);
  });
});

describe("SaaS plan usage and invoices", () => {
  it("counts this month's usage and drafts last month's invoice exactly once", async () => {
    const overview = await billingOverview(ctx, demo.tenantId);
    expect(overview.plan.code).toBe("PRO");
    expect(overview.usage.intents).toBeGreaterThan(0);
    const nextMonth = new Date(overview.usage.periodEnd.getTime() + 86_400_000);
    const first = await closeBillingPeriod(ctx, nextMonth);
    expect(first.created).toBeGreaterThan(0);
    const invoice = await ctx.db.invoice.findUniqueOrThrow({ where: { tenantId_periodKey: { tenantId: demo.tenantId, periodKey: overview.usage.periodKey } } });
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.amount.toString()).toBe("899");
    expect(invoice.snapshot).toMatchObject({ usage: { intents: overview.usage.intents }, plan: { code: "PRO" } });
    const again = await closeBillingPeriod(ctx, nextMonth);
    expect(again.created).toBe(0);
  });

  it("warns near the included volume once per level and never blocks", async () => {
    const pro = await ctx.db.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    await ctx.db.plan.update({ where: { code: "PRO" }, data: { includedIntents: 1 } });
    try {
      expect(await planUsageAlerts(ctx, demo.tenantId)).toBe(1);
      expect(await planUsageAlerts(ctx, demo.tenantId)).toBe(0);
      const alert = await ctx.db.alert.findFirstOrThrow({ where: { tenantId: demo.tenantId, type: "PLAN_USAGE_NEAR_LIMIT" } });
      expect(alert.title).toBe("Volume do plano ultrapassado");
      const r = await createIntent(ctx, demo, { customer: "+5511988880099", eventType: "payment.approved", entityId: "ORD-OVER", data: { orderId: "ORD-OVER" } });
      expect(r.intentId).toBeTruthy();
    } finally {
      await ctx.db.plan.update({ where: { code: "PRO" }, data: { includedIntents: pro.includedIntents } });
    }
  });
});

describe("template sync from the connected WABA", () => {
  it("imports Meta's templates with Meta's status and category and makes them sendable by name", async () => {
    const r = await syncTemplates(ctx, demo);
    expect(r).toMatchObject({ wabas: 1, synced: 1, approved: 1 });
    const t = await ctx.db.template.findUniqueOrThrow({ where: { tenantId_name_language: { tenantId: demo.tenantId, name: "hello_world", language: "en_US" } } });
    expect(t).toMatchObject({ status: "APPROVED", metaCategory: "UTILITY", externalId: "mock-template-hello" });
    const intent = await createIntent(ctx, demo, { customer: "+5511988880123", eventType: "order.status", entityId: "SYNC-1", template: { name: "hello_world", language: "en_US" }, consent: { optIn: true, source: "test" }, data: {} });
    expect(intent.intentId).toBeTruthy();
    expect((await syncTemplates(ctx, demo)).synced).toBe(1); // idempotent upsert
  });
});

describe("webhook override (Meta webhook overrides)", () => {
  it("refuses unsafe URLs and tenants without a real WABA", async () => {
    await expect(setWebhookOverride(ctx, demo, { callbackUrl: "http://example.com/api/v1/webhooks/meta" })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(setWebhookOverride(ctx, demo, { callbackUrl: "https://example.com/other" })).rejects.toMatchObject({ httpStatus: 400 });
    // The demo tenant only has a MOCK WABA: nothing to point at Meta.
    await expect(setWebhookOverride(ctx, demo, { callbackUrl: "https://example.com/api/v1/webhooks/meta" })).rejects.toThrow(/No real WABA/);
  });
});

describe("Inbox: agents chat inside the WCO", () => {
  const owner = () => ({ type: "USER" as const, id: null, tenantId: demo.tenantId, role: Role.OWNER });
  async function customerWrites(from: string, text: string, viaAd = false) {
    const payload = buildInboundPayload({ wabaId: "mock-waba-loja-demo", phoneNumberId: "mock-pn-loja-demo-1", from, text, timestamp: ctx.now(), referral: viaAd ? { sourceType: "ad", sourceId: "ad-1" } : undefined });
    const raw = Buffer.from(JSON.stringify(payload));
    const r = await ingestWebhook(ctx, { rawBody: raw, signature: computeSignature(raw, TEST_APP_SECRET) });
    await processWebhook(ctx, { webhookEventId: r.id! }, { finalAttempt: true });
  }

  it("stores what the customer wrote only after the inbox is enabled, encrypted", async () => {
    await setInboxEnabled(ctx, owner(), { enabled: false }); // the demo seed turns it on
    await customerWrites("5511955550101", "mensagem antes de ativar");
    expect(await ctx.db.chatMessage.count({ where: { tenantId: demo.tenantId } })).toBe(0);
    await setInboxEnabled(ctx, owner(), { enabled: true });
    await customerWrites("5511955550101", "Oi, quero um orçamento", true);
    const row = await ctx.db.chatMessage.findFirstOrThrow({ where: { tenantId: demo.tenantId, direction: "IN" } });
    expect(row.bodyEncrypted).not.toContain("orçamento");
    const inbox = await listInbox(ctx, demo.tenantId);
    const conv = inbox.conversations.find((c) => c.lastMessage === "Oi, quero um orçamento")!;
    expect(conv).toMatchObject({ waitingReply: true, windowOpen: true, fep: { state: "REPLY_TO_UNLOCK" } });
  });

  it("joins the agent's consecutive short replies into ONE WhatsApp message", async () => {
    const conv = (await listInbox(ctx, demo.tenantId)).conversations.find((c) => c.lastMessage === "Oi, quero um orçamento")!;
    const ids: string[] = [];
    for (const text of ["Oi!", "Tudo bem?", "O valor é R$ 100"]) ids.push((await sendInboxReply(ctx, owner(), conv.id, { text })).intentId);
    for (const id of ids) await optimizeIntent(ctx, { tenantId: demo.tenantId, intentId: id });
    const group = (await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: ids[0]! } })).groupKey;
    const realNow = ctx.now;
    ctx.now = () => new Date(realNow.call(ctx).getTime() + 60_000);
    try {
      await flushGroup(ctx, { tenantId: demo.tenantId, groupKey: group });
    } finally {
      ctx.now = realNow;
    }
    const attempts = await ctx.db.messageAttempt.findMany({ where: { tenantId: demo.tenantId, coveredIntentIds: { hasSome: ids } } });
    expect(attempts).toHaveLength(1);
    expect((attempts[0]!.payload as { text: string }).text).toBe("Oi!\nTudo bem?\nO valor é R$ 100");
    const detail = await getInboxConversation(ctx, demo.tenantId, conv.id);
    expect(detail.savings).toEqual({ repliesTyped: 3, messagesSent: 0, joined: 2, pending: 1 }); // dispatch not run here
    expect(detail.messages.filter((m) => m.direction === "OUT").map((m) => m.text)).toEqual(["Oi!", "Tudo bem?", "O valor é R$ 100"]);
    // The list shows the real delivery state of the message that went out, and nothing unread.
    const item = (await listInbox(ctx, demo.tenantId)).conversations.find((c) => c.id === conv.id)!;
    const primary = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: attempts[0]!.intentId } });
    expect(item).toMatchObject({ unread: 0, lastDirection: "OUT", lastStatus: primary.status });
  });

  it("refuses free text once the 24 h window closed (only an approved template, which is paid)", async () => {
    const conv = (await listInbox(ctx, demo.tenantId)).conversations.find((c) => c.lastMessage === "O valor é R$ 100")!;
    await ctx.db.customerServiceWindow.update({ where: { conversationId: conv.id }, data: { expiresAt: new Date(ctx.now().getTime() - 1000) } });
    await expect(sendInboxReply(ctx, owner(), conv.id, { text: "ainda está aí?" })).rejects.toMatchObject({ httpStatus: 409 });
    const tpl = await ctx.db.template.findFirstOrThrow({ where: { tenantId: demo.tenantId, status: "APPROVED", declaredCategory: "UTILITY" } });
    const r = await sendInboxReply(ctx, owner(), conv.id, { template: { name: tpl.name, language: tpl.language }, data: {} });
    expect(r.intentId).toBeTruthy();
  });
});
