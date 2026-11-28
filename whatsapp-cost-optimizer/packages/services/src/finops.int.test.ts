import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@wco/domain";
import { TEST_APP_SECRET, migrateTestDatabase, statusWebhook, truncateAll, useTestEnv } from "@wco/testing";
import { buildInboundPayload, computeSignature } from "@wco/whatsapp";
import { createAppContext, createIntent, dispatchAttempt, ingestWebhook, optimizeIntent, processWebhook, seedAll, type Actor, type AppContext } from "./index";

/**
 * Integration tests (PostgreSQL + Redis) of the FinOps module wired into dispatch
 * (packages/optimization/src/finops via finops-dispatch.ts): the global deliverability cache shared
 * by tenants, the template mirror pool, two-step splits, external bridge routing and the savings ledger.
 */
let ctx: AppContext;
let demo: Actor;
let acme: Actor;

beforeAll(async () => {
  useTestEnv();
  migrateTestDatabase();
  ctx = createAppContext({ service: "test", subscribe: false });
  await truncateAll(ctx.db);
  await ctx.db.$executeRawUnsafe(`TRUNCATE "GlobalSuppression", "MirrorTemplateVariant", "MonthlyServiceQuota", "FinOpsSavingsLedger"`);
  await ctx.redis.flushdb();
  const s = await seedAll(ctx, { demoHistory: false });
  demo = { type: "SYSTEM", id: null, tenantId: s.demoTenantId, role: Role.OWNER };
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

async function decideFor(actor: Actor, body: Record<string, unknown>) {
  const r = await createIntent(ctx, actor, { consent: { optIn: true, source: "test" }, mustSendImmediately: true, ...body });
  await optimizeIntent(ctx, { tenantId: actor.tenantId, intentId: r.intentId });
  return ctx.db.messageIntent.findUniqueOrThrow({ where: { id: r.intentId } });
}

async function dispatch(tenantId: string, intentId: string) {
  const attempt = await ctx.db.messageAttempt.findFirstOrThrow({ where: { tenantId, coveredIntentIds: { has: intentId } } });
  const pairKeys = await ctx.redis.keys("wco:pair:*");
  if (pairKeys.length) await ctx.redis.del(...pairKeys);
  await dispatchAttempt(ctx, { tenantId, attemptId: attempt.id }, { finalAttempt: true });
  return ctx.db.messageAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
}

const acmeStatus = (wamid: string, to: string, status: "delivered" | "failed", extra: Partial<Parameters<typeof statusWebhook>[0]> = {}) =>
  metaPost(statusWebhook({ wabaId: "mock-waba-acme", phoneNumberId: "mock-pn-acme-1", providerMessageId: wamid, recipientWaId: to, status, ...extra }));

const ledgerOf = (intentId: string) => ctx.db.finOpsSavingsLedger.findUnique({ where: { intentId } });

describe("FinOps wired into dispatch", () => {
  it("writes a ledger entry for a template sent through the official Cloud API, without the message content", async () => {
    const intent = await decideFor(acme, { customer: "+5511950000001", eventType: "appointment.reminder", data: { date: "hoje", time: "10h" } });
    const attempt = await dispatch(acme.tenantId, intent.id);
    expect(attempt.status).toBe("SENT");
    const row = await ledgerOf(intent.id);
    expect(row).toMatchObject({ tenantId: acme.tenantId, status: "DISPATCH", transport: "DIRECT_CLOUD_API", avoidedBspFeeUsd: 0 });
    expect(JSON.stringify(row)).not.toContain("consulta");
  });

  it("a 131026 seen by one tenant holds back the other tenants' messages to that number, until the customer writes", async () => {
    const first = await decideFor(acme, { customer: "+5511950000002", eventType: "appointment.reminder", data: { date: "hoje", time: "11h" } });
    const sent = await dispatch(acme.tenantId, first.id);
    await acmeStatus(sent.providerMessageId!, "5511950000002", "failed", { errors: [{ code: 131026, title: "Message undeliverable" }] });
    expect(await ctx.db.globalSuppression.count()).toBe(1);

    // Another tenant, with no history with this number of its own.
    const other = await decideFor(demo, { customer: "+5511950000002", eventType: "appointment.reminder", data: { date: "amanhã", time: "9h" } });
    const held = await dispatch(demo.tenantId, other.id);
    expect(held).toMatchObject({ status: "CANCELLED", errorCode: "FINOPS_SUPPRESSED" });
    expect(await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ status: "BLOCKED", decisionReason: "finops:invalid_recipient_131026" });
    expect(await ledgerOf(other.id)).toMatchObject({ status: "SUPPRESSED", transport: "NONE" });

    // A verification code is never held back by it.
    const otp = await decideFor(demo, { customer: "+5511950000002", eventType: "authentication.otp", data: { code: "424242" } });
    expect((await dispatch(demo.tenantId, otp.id)).status).toBe("SENT");

    // The customer writes (to any business): the number is reachable again for everyone.
    await metaPost(buildInboundPayload({ wabaId: "mock-waba-acme", phoneNumberId: "mock-pn-acme-1", from: "5511950000002", text: "Oi", timestamp: ctx.now() }));
    expect(await ctx.db.globalSuppression.count()).toBe(0);
    const again = await decideFor(demo, { customer: "+5511950000002", eventType: "appointment.reminder", data: { date: "sexta", time: "8h" } });
    expect((await dispatch(demo.tenantId, again.id)).status).toBe("SENT");
  });

  it("sends the next approved UTILITY variant of a mirror group when Meta reclassifies the template as MARKETING", async () => {
    const reminder = await ctx.db.template.findFirstOrThrow({ where: { tenantId: acme.tenantId, name: "appointment_reminder" } });
    await ctx.db.template.create({
      data: { tenantId: acme.tenantId, wabaId: reminder.wabaId, name: "appointment_reminder_b", language: "pt_BR", declaredCategory: "UTILITY", metaCategory: "UTILITY", status: "APPROVED", components: reminder.components as never, approvedAt: new Date(), externalId: "mock-template-appointment_reminder_b" },
    });
    ctx.tenants.invalidate(acme.tenantId);
    await ctx.db.mirrorTemplateVariant.createMany({
      data: [
        { tenantId: acme.tenantId, groupKey: "lembrete", metaTemplateName: "appointment_reminder", category: "UTILITY", status: "APPROVED", priority: 1 },
        { tenantId: acme.tenantId, groupKey: "lembrete", metaTemplateName: "appointment_reminder_b", category: "UTILITY", status: "APPROVED", priority: 2 },
      ],
    });
    await metaPost({
      object: "whatsapp_business_account",
      entry: [{ id: "mock-waba-acme", changes: [{ field: "template_category_update", value: { message_template_id: 1, message_template_name: "appointment_reminder", message_template_language: "pt_BR", previous_category: "UTILITY", new_category: "MARKETING" } }] }],
    });
    expect(await ctx.db.mirrorTemplateVariant.findFirstOrThrow({ where: { metaTemplateName: "appointment_reminder" } })).toMatchObject({ category: "MARKETING" });

    const intent = await decideFor(acme, { customer: "+5511950000003", eventType: "appointment.reminder", data: { date: "hoje", time: "16h" } });
    const attempt = await dispatch(acme.tenantId, intent.id);
    expect(attempt).toMatchObject({ status: "SENT", templateName: "appointment_reminder_b", category: "UTILITY" });
    expect(await ledgerOf(intent.id)).toMatchObject({ selectedTemplateName: "appointment_reminder_b" });
    expect(JSON.parse((await ledgerOf(intent.id))!.appliedStrategiesJson)).toContain("M2_MIRROR_POOL_FAILOVER_UTILITY");
  });

  it("FINOPS_ENABLED=false turns it off", async () => {
    process.env.FINOPS_ENABLED = "false";
    try {
      const intent = await decideFor(acme, { customer: "+5511950000004", eventType: "appointment.reminder", data: { date: "hoje", time: "17h" } });
      expect((await dispatch(acme.tenantId, intent.id)).status).toBe("SENT");
      expect(await ledgerOf(intent.id)).toBeNull();
    } finally {
      delete process.env.FINOPS_ENABLED;
    }
  });

  it("isolates Mirror Pool failover by language so an en_US variant never hijacks a pt_BR dispatch", async () => {
    const reminder = await ctx.db.template.findFirstOrThrow({ where: { tenantId: acme.tenantId, name: "appointment_reminder" } });
    await ctx.db.template.create({
      data: {
        tenantId: acme.tenantId,
        wabaId: reminder.wabaId,
        name: "appointment_reminder_en",
        language: "en_US",
        declaredCategory: "UTILITY",
        metaCategory: "UTILITY",
        status: "APPROVED",
        components: reminder.components as never,
        approvedAt: new Date(),
        externalId: "mock-template-appointment_reminder_en",
      },
    });
    ctx.tenants.invalidate(acme.tenantId);

    // Higher priority (0) than appointment_reminder_b (2), but in en_US.
    await ctx.db.mirrorTemplateVariant.create({
      data: {
        tenantId: acme.tenantId,
        groupKey: "lembrete",
        metaTemplateName: "appointment_reminder_en",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        priority: 0,
      },
    });

    // Must still select pt_BR variant (appointment_reminder_b) instead of en_US.
    const ptIntent = await decideFor(acme, { customer: "+5511950000005", eventType: "appointment.reminder", data: { date: "hoje", time: "18h" } });
    const ptAttempt = await dispatch(acme.tenantId, ptIntent.id);
    expect(ptAttempt).toMatchObject({ status: "SENT", templateName: "appointment_reminder_b", category: "UTILITY" });

    // Reclassify appointment_reminder_b as well; with zero pt_BR UTILITY variants left, it must NOT cross-send en_US.
    await metaPost({
      object: "whatsapp_business_account",
      entry: [{ id: "mock-waba-acme", changes: [{ field: "template_category_update", value: { message_template_id: 2, message_template_name: "appointment_reminder_b", message_template_language: "pt_BR", previous_category: "UTILITY", new_category: "MARKETING" } }] }],
    });

    const fallbackIntent = await decideFor(acme, { customer: "+5511950000006", eventType: "appointment.reminder", data: { date: "amanhã", time: "14h" } });
    const fallbackAttempt = await dispatch(acme.tenantId, fallbackIntent.id);
    expect(fallbackAttempt).toMatchObject({ status: "SENT", templateName: "appointment_reminder" });
    const ledger = await ledgerOf(fallbackIntent.id);
    expect(ledger?.selectedTemplateName).toBe("appointment_reminder");
    expect(JSON.parse(ledger!.appliedStrategiesJson)).toEqual([]);
  });

  it("splits hybrid MARKETING + deferred promo using distinct UTILITY vs MARKETING rates (M2A)", async () => {
    const intent = await decideFor(acme, { customer: "+5511950000007", eventType: "appointment.reminder", data: { date: "amanhã", time: "15h" } });
    const queued = await ctx.db.messageAttempt.findFirstOrThrow({ where: { tenantId: acme.tenantId, coveredIntentIds: { has: intent.id } } });
    await ctx.db.messageAttempt.update({
      where: { id: queued.id },
      data: {
        category: "MARKETING",
        payload: {
          ...((queued.payload as Record<string, unknown>) ?? {}),
          deferredPromoText: "Responda para liberar 15% OFF no seu próximo atendimento!",
        },
      },
    });

    const attempt = await dispatch(acme.tenantId, intent.id);
    expect(attempt.status).toBe("SENT");

    const row = await ledgerOf(intent.id);
    expect(row).toMatchObject({
      tenantId: acme.tenantId,
      status: "DISPATCH",
      transport: "DIRECT_CLOUD_API",
      deliveryMode: "TWO_STEP_UTILITY_HOOK",
    });
    expect(row!.metaTariffSavingsUsd).toBeGreaterThan(0);
    expect(row!.totalSavingsUsd).toBeGreaterThan(0);
    expect(JSON.parse(row!.appliedStrategiesJson)).toContain("M2_TWO_STEP_UTILITY_HOOK");
  });

  it("routes cold MARKETING through EXTERNAL_HTTP_BRIDGE once with a wa.me handoff link (M6)", async () => {
    const received: Array<Record<string, unknown>> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push(JSON.parse(body || "{}"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "bridge-msg-999" }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;

    process.env.FINOPS_EXTERNAL_BRIDGE_URL = `http://127.0.0.1:${port}/send`;
    process.env.FINOPS_OFFICIAL_WABA_PHONE = "5511999990000";
    try {
      const intent = await decideFor(acme, { customer: "+5511950000008", eventType: "appointment.reminder", data: { date: "segunda", time: "9h" } });
      const queued = await ctx.db.messageAttempt.findFirstOrThrow({ where: { tenantId: acme.tenantId, coveredIntentIds: { has: intent.id } } });
      await ctx.db.messageAttempt.update({
        where: { id: queued.id },
        data: { category: "MARKETING" },
      });

      const attempt = await dispatch(acme.tenantId, intent.id);
      expect(attempt).toMatchObject({
        status: "SENT",
        providerMessageId: "bridge-msg-999",
        freeReason: "finops_external_bridge",
      });
      expect(Number(attempt.estimatedCost)).toBe(0);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ to: "+5511950000008" });
      expect(String(received[0]!.text)).toContain("https://wa.me/5511999990000");

      const row = await ledgerOf(intent.id);
      expect(row).toMatchObject({
        tenantId: acme.tenantId,
        status: "DISPATCH",
        transport: "EXTERNAL_HTTP_BRIDGE",
        deliveryMode: "EXTERNAL_BRIDGE_WITH_HANDOFF",
      });
      expect(row!.totalSavingsUsd).toBeGreaterThan(0);
      expect(JSON.parse(row!.appliedStrategiesJson)).toContain("M6_EXTERNAL_BRIDGE_WITH_OFFICIAL_HANDOFF");
    } finally {
      delete process.env.FINOPS_EXTERNAL_BRIDGE_URL;
      delete process.env.FINOPS_OFFICIAL_WABA_PHONE;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
