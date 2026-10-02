import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant } from "@wco/database";
import { Role } from "@wco/domain";
import { TEST_APP_SECRET, migrateTestDatabase, statusWebhook, truncateAll, useTestEnv } from "@wco/testing";
import { computeSignature } from "@wco/whatsapp";
import {
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
    expect(rows.every((c) => !c.phoneEncrypted.includes("5511988880003"))).toBe(true);
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
