import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@wco/domain";
import { TEST_APP_SECRET, migrateTestDatabase, statusWebhook, truncateAll, useTestEnv } from "@wco/testing";
import { buildInboundPayload, computeSignature, type MockWhatsAppProvider } from "@wco/whatsapp";
import {
  QUEUE,
  assertSafeWebhookUrl,
  createAppContext,
  createIntent,
  deleteCustomerData,
  deliverOutboundWebhook,
  dispatchAttempt,
  expireFollowUps,
  exportCustomerData,
  flushGroup,
  getIntentAudit,
  ingestWebhook,
  listOutboundWebhooks,
  optimizeIntent,
  payloadForTenant,
  processWebhook,
  recordConsent,
  routingSummary,
  seedAll,
  signOutbound,
  splitTemplate,
  summary,
  updateTenant,
  upsertOptimizationPolicy,
  upsertOutboundWebhook,
  type Actor,
  type AppContext,
  type OutboundWebhookJob,
} from "./index";

/**
 * Integration tests (PostgreSQL + Redis) of the cost-routing features: template → free-form inside
 * the window, deferred follow-up, free entry point priority, inbound-first, mirror webhooks,
 * BSP_MARKUP_AVOIDED and the per-tenant deliverability cache.
 */
let ctx: AppContext;
let demo: Actor;
let acme: Actor;
let received: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
let respondWith = 200;
let server: Server;
let hookUrl: string;

const WABA = "mock-waba-acme";
const PN = "mock-pn-acme-1";
const mock = () => ctx.provider(null) as MockWhatsAppProvider;

beforeAll(async () => {
  useTestEnv();
  migrateTestDatabase();
  ctx = createAppContext({ service: "test", subscribe: false });
  await truncateAll(ctx.db);
  await ctx.redis.flushdb();
  const s = await seedAll(ctx, { demoHistory: false });
  demo = { type: "SYSTEM", id: null, tenantId: s.demoTenantId, role: Role.OWNER };
  acme = { type: "SYSTEM", id: null, tenantId: s.acmeTenantId, role: Role.OWNER };
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body });
      res.writeHead(respondWith).end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((ok) => server?.close(ok));
  await ctx?.close();
});

async function metaPost(payload: Record<string, unknown>) {
  const raw = Buffer.from(JSON.stringify(payload));
  const r = await ingestWebhook(ctx, { rawBody: raw, signature: computeSignature(raw, TEST_APP_SECRET) });
  await processWebhook(ctx, { webhookEventId: r.id! }, { finalAttempt: true });
  return r.id!;
}

const customerWrites = (from: string, text: string, viaAd = false, waba = WABA, pn = PN) =>
  metaPost(buildInboundPayload({ wabaId: waba, phoneNumberId: pn, from, text, timestamp: ctx.now(), referral: viaAd ? { sourceType: "ad", sourceId: "ad-9" } : undefined }));

/** createIntent + the optimization job, inline. */
async function decideFor(actor: Actor, body: Record<string, unknown>) {
  const r = await createIntent(ctx, actor, { consent: { optIn: true, source: "test" }, ...body });
  await optimizeIntent(ctx, { tenantId: actor.tenantId, intentId: r.intentId });
  return ctx.db.messageIntent.findUniqueOrThrow({ where: { id: r.intentId } });
}

/** The dispatch job, inline. */
async function dispatch(tenantId: string, intentId: string) {
  const attempt = await ctx.db.messageAttempt.findFirstOrThrow({ where: { tenantId, coveredIntentIds: { has: intentId } } });
  // Tests send to the same number back to back; production keeps Meta's 6 s spacing per (number, customer).
  const pairKeys = await ctx.redis.keys("wco:pair:*");
  if (pairKeys.length) await ctx.redis.del(...pairKeys);
  await dispatchAttempt(ctx, { tenantId, attemptId: attempt.id }, { finalAttempt: true });
  return ctx.db.messageAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
}

const metaStatus = (wamid: string, to: string, status: "delivered" | "failed", extra: Partial<Parameters<typeof statusWebhook>[0]> = {}, waba = WABA, pn = PN) =>
  metaPost(statusWebhook({ wabaId: waba, phoneNumberId: pn, providerMessageId: wamid, recipientWaId: to, status, ...extra }));

const campaignPolicy = (over: Record<string, unknown> = {}) =>
  upsertOptimizationPolicy(ctx, acme, { eventType: "marketing.campaign", maxDelaySeconds: 86_400, defaultTemplate: "weekly_offer", category: "MARKETING", priority: "LOW", dedupWindowSeconds: 604_800, ...over });

const savingsOf = (intentId: string) => ctx.db.savingsRecord.findMany({ where: { intentId }, orderBy: { kind: "asc" } });

describe("Module 1 — template content as a free-form message inside the customer service window", () => {
  it("sends a MARKETING template as a service message while the window is open, and records the template price avoided", async () => {
    await campaignPolicy({ allowMarketingFreeFormInWindow: true });
    await customerWrites("5511930000001", "Oi, vocês têm promoção?");
    const intent = await decideFor(acme, { customer: "+5511930000001", eventType: "marketing.campaign", data: { offer: "10% off em tênis" } });
    expect(intent).toMatchObject({ messageKind: "NON_TEMPLATE", category: "SERVICE", contentCategory: "MARKETING", templateName: "weekly_offer", decisionAction: "SEND_NOW" });
    expect(intent.decisionReason).toContain("template_to_freeform_csw");
    expect(Number(intent.baselineCost)).toBeGreaterThan(0); // the marketing template it would have been
    expect(Number(intent.estimatedCost)).toBe(0); // inside the month's free service messages

    const before = mock().sent.length;
    const attempt = await dispatch(acme.tenantId, intent.id);
    expect(attempt).toMatchObject({ status: "SENT", messageKind: "NON_TEMPLATE", category: "SERVICE" });
    // Rendered from the approved template: same wording, parameters filled in.
    expect(mock().sent.slice(before)).toEqual([expect.objectContaining({ type: "text", body: { text: "Oferta da semana: 10% off em tênis. Aproveite!".length } })]);

    await metaStatus(attempt.providerMessageId!, "5511930000001", "delivered", { pricing: { billable: false, pricing_model: "PMP", category: "service", type: "free_customer_service" } });
    const lines = await savingsOf(intent.id);
    expect(lines).toEqual([expect.objectContaining({ kind: "META", mechanism: "TEMPLATE_TO_FREEFORM_CSW", confidence: "REALIZED" })]);
    expect(lines[0]!.savings.toString()).toBe(intent.baselineCost!.toString());
    const s = await summary(ctx, acme.tenantId, {} as never);
    expect(s.savings.routing.TEMPLATE_TO_FREEFORM_CSW).toMatchObject({ kind: "META", messages: 1 });
    const audit = await getIntentAudit(ctx, acme.tenantId, intent.id);
    expect(audit.why.whyCategory![0]).toContain("conteúdo do template weekly_offer");
  });

  it("renders quick-reply buttons as an interactive message", async () => {
    await ctx.db.template.create({
      data: {
        tenantId: acme.tenantId,
        name: "offer_buttons",
        language: "pt_BR",
        declaredCategory: "MARKETING",
        metaCategory: "MARKETING",
        status: "APPROVED",
        components: [
          { type: "HEADER", format: "TEXT", text: "Só hoje" },
          { type: "BODY", text: "{{offer}} para você.", params: ["offer"], parameterFormat: "NAMED" },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero" }, { type: "QUICK_REPLY", text: "Agora não" }] },
        ],
      },
    });
    ctx.tenants.invalidate(acme.tenantId);
    await customerWrites("5511930000002", "Oi");
    const intent = await decideFor(acme, { customer: "+5511930000002", eventType: "marketing.campaign", template: { name: "offer_buttons" }, data: { offer: "Frete grátis" } });
    expect(intent.messageKind).toBe("NON_TEMPLATE");
    const before = mock().sent.length;
    await dispatch(acme.tenantId, intent.id);
    expect(mock().sent.slice(before)).toEqual([expect.objectContaining({ type: "interactive", body: { interactive: "buttons", body: "Frete grátis para você.".length, buttons: 2 } })]);
  });

  it("falls back to the approved template when the window closed before dispatch", async () => {
    await customerWrites("5511930000003", "Oi");
    const intent = await decideFor(acme, { customer: "+5511930000003", eventType: "marketing.campaign", data: { offer: "Leve 3 pague 2" } });
    expect(intent.messageKind).toBe("NON_TEMPLATE");
    // The customer's last message is now 25 h old.
    const conv = await ctx.db.conversation.findFirstOrThrow({ where: { tenantId: acme.tenantId, customerId: intent.customerId } });
    const old = new Date(ctx.now().getTime() - 25 * 3_600_000);
    await ctx.db.customerServiceWindow.update({ where: { conversationId: conv.id }, data: { lastInboundMessageAt: old, expiresAt: new Date(old.getTime() + 24 * 3_600_000) } });
    await ctx.db.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: old } });
    const before = mock().sent.length;
    const attempt = await dispatch(acme.tenantId, intent.id);
    expect(attempt).toMatchObject({ status: "SENT", messageKind: "TEMPLATE", category: "MARKETING", templateName: "weekly_offer" });
    expect(mock().sent.slice(before)).toEqual([expect.objectContaining({ type: "template" })]);
    const after = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after).toMatchObject({ messageKind: "TEMPLATE", category: "MARKETING", contentCategory: null });
    expect(after.decisionReason).toContain("template_fallback");
  });

  it("still honors a marketing opt-out that arrives before dispatch", async () => {
    await customerWrites("5511930000004", "Oi");
    const intent = await decideFor(acme, { customer: "+5511930000004", eventType: "marketing.campaign", data: { offer: "Cupom" } });
    expect(intent.messageKind).toBe("NON_TEMPLATE");
    await recordConsent(ctx, acme, { customer: "+5511930000004", type: "OPT_OUT", scope: "MARKETING" });
    const before = mock().sent.length;
    const attempt = await dispatch(acme.tenantId, intent.id);
    expect(attempt.status).toBe("CANCELLED");
    expect(mock().sent.length).toBe(before);
  });

  it("does nothing of the sort unless the policy opts in", async () => {
    await campaignPolicy({ allowMarketingFreeFormInWindow: false });
    await customerWrites("5511930000005", "Oi");
    const intent = await decideFor(acme, { customer: "+5511930000005", eventType: "marketing.campaign", data: { offer: "Sem opt-in de política" } });
    expect(intent).toMatchObject({ messageKind: "TEMPLATE", category: "MARKETING", contentCategory: null });
  });
});

describe("Module 2 — deferred follow-up and the compliance splitter", () => {
  const order = (customer: string, followUp: Record<string, unknown>) =>
    decideFor(acme, { customer, eventType: "payment.approved", entityId: `PAG-${customer.slice(-4)}`, mustSendImmediately: true, data: { orderId: customer.slice(-4), amount: "R$ 120,00" }, followUp });

  it("sends the offer only after the customer replies, as a service message with marketing consent", async () => {
    const first = await order("+5511931000001", { text: "Obrigado pela compra! Use o cupom VOLTA10 na próxima.", validHours: 48 });
    expect(first).toMatchObject({ messageKind: "TEMPLATE", category: "UTILITY" });
    await dispatch(acme.tenantId, first.id);
    const waiting = await ctx.db.deferredFollowUp.findUniqueOrThrow({ where: { intentId: first.id } });
    expect(waiting).toMatchObject({ status: "PENDING", contentCategory: "MARKETING", followUpIntentId: null });
    expect(waiting.deferredFreeFormPayload).not.toContain("VOLTA10"); // encrypted at rest
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, eventType: "followup.deferred" } })).toBe(0);

    await customerWrites("5511931000001", "Recebi, obrigado!");
    const sent = await ctx.db.deferredFollowUp.findUniqueOrThrow({ where: { intentId: first.id } });
    expect(sent.status).toBe("SENT");
    await optimizeIntent(ctx, { tenantId: acme.tenantId, intentId: sent.followUpIntentId! });
    const followUp = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: sent.followUpIntentId! } });
    expect(followUp).toMatchObject({ eventType: "followup.deferred", messageKind: "NON_TEMPLATE", category: "SERVICE", contentCategory: "MARKETING", decisionAction: "SEND_NOW" });
    expect(followUp.decisionReason).toContain("utility_split_deferred");
    const attempt = await dispatch(acme.tenantId, followUp.id);
    await metaStatus(attempt.providerMessageId!, "5511931000001", "delivered", { pricing: { billable: false, pricing_model: "PMP", category: "service", type: "free_customer_service" } });
    // Baseline = the marketing template the offer would otherwise have needed.
    expect(await savingsOf(followUp.id)).toEqual([expect.objectContaining({ kind: "META", mechanism: "UTILITY_SPLIT_DEFERRED" })]);
    // A second customer message does not send it again.
    await customerWrites("5511931000001", "Até mais");
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, eventType: "followup.deferred", customerId: followUp.customerId } })).toBe(1);
    expect((await getIntentAudit(ctx, acme.tenantId, first.id)).followUp).toMatchObject({ status: "SENT", followUpIntentId: followUp.id });
  });

  it("drops the follow-up for a customer who opted out of marketing, and for an opt-out reply", async () => {
    const a = await order("+5511931000002", { text: "Cupom A" });
    await dispatch(acme.tenantId, a.id);
    await recordConsent(ctx, acme, { customer: "+5511931000002", type: "OPT_OUT", scope: "MARKETING" });
    await customerWrites("5511931000002", "ok");
    expect((await ctx.db.deferredFollowUp.findUniqueOrThrow({ where: { intentId: a.id } })).status).toBe("CANCELLED");

    const b = await order("+5511931000003", { text: "Cupom B" });
    await dispatch(acme.tenantId, b.id);
    await customerWrites("5511931000003", "SAIR");
    const row = await ctx.db.deferredFollowUp.findUniqueOrThrow({ where: { intentId: b.id } });
    expect(row).toMatchObject({ status: "PENDING", followUpIntentId: null });
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, eventType: "followup.deferred", customerId: b.customerId } })).toBe(0);
  });

  it("never sends it if the customer does not write: it expires and its text is erased", async () => {
    const c = await order("+5511931000004", { text: "Cupom C", validHours: 1 });
    await dispatch(acme.tenantId, c.id);
    const realNow = ctx.now;
    ctx.now = () => new Date(realNow.call(ctx).getTime() + 2 * 3_600_000);
    try {
      expect(await expireFollowUps(ctx)).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.now = realNow;
    }
    expect(await ctx.db.deferredFollowUp.findUniqueOrThrow({ where: { intentId: c.id } })).toMatchObject({ status: "EXPIRED", deferredFreeFormPayload: null });
    await expect(createIntent(ctx, acme, { customer: "+5511931000004", eventType: "support.reply", text: "oi", followUp: { text: "x" } })).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("splitter (advisory): separates the promotional sentence from a transactional text", async () => {
    const r = await splitTemplate(ctx, acme.tenantId, { body: "Seu pedido {{1}} foi enviado. Aproveite 10% de desconto com o cupom VOLTA10!" });
    expect(r).toMatchObject({ transactional: "Seu pedido {{1}} foi enviado.", promotional: "Aproveite 10% de desconto com o cupom VOLTA10!", looksUtility: true, rewriter: "rules", disclaimer: "Final category is determined by Meta." });
    expect(r.howToSend).toContain("followUp");
  });
});

describe("Module 3 — free entry point priority and inbound-first", () => {
  it("brings an already scheduled marketing message forward when a free entry point window opens", async () => {
    const later = new Date(ctx.now().getTime() + 80 * 3_600_000);
    const scheduled = await decideFor(acme, { customer: "+5511932000001", eventType: "marketing.campaign", preferredSendAt: later.toISOString(), data: { offer: "Agendada" } });
    // It waits in the buffer for its time: paid then (no window is open).
    expect(scheduled.status).toBe("DELAYED");
    expect(scheduled.scheduledFor!.getTime()).toBe(later.getTime());
    expect(Number(scheduled.estimatedCost)).toBeGreaterThan(0);

    // The customer arrives through an ad and the business answers: the reply opens the free window.
    await customerWrites("5511932000001", "Vi o anúncio", true);
    const reply = await decideFor(acme, { customer: "+5511932000001", eventType: "support.reply", text: "Olá! Como posso ajudar?", entityId: "chat" });
    await dispatch(acme.tenantId, reply.id);

    const moved = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: scheduled.id } });
    expect(moved.decisionReason).toContain("fep_priority");
    expect(moved.scheduledFor!.getTime()).toBeLessThan(ctx.now().getTime() + 1000);
    expect(await flushGroup(ctx, { tenantId: acme.tenantId, groupKey: moved.groupKey })).toMatchObject({ messages: 1 });

    const sent = await dispatch(acme.tenantId, scheduled.id);
    expect(sent).toMatchObject({ status: "SENT", messageKind: "TEMPLATE", freeReason: "free_entry_point_window" });
    await metaStatus(sent.providerMessageId!, "5511932000001", "delivered", { pricing: { billable: false, pricing_model: "PMP", category: "referral_conversion", type: "free_entry_point" } });
    expect(await savingsOf(scheduled.id)).toEqual([expect.objectContaining({ kind: "META", mechanism: "FEP_PRIORITY", confidence: "REALIZED" })]);
  });

  it("inbound-first: asks the tenant's other channels to invite the customer, then sends the content free-form when they write", async () => {
    // Without an EVENTS endpoint the grace is not applied (nobody would be told to invite the customer).
    await campaignPolicy({ allowMarketingFreeFormInWindow: true, inboundFirstGraceMinutes: 30 });
    const direct = await decideFor(acme, { customer: "+5511932000002", eventType: "marketing.campaign", data: { offer: "Sem endpoint" } });
    expect(direct.decisionAction).toBe("SEND_NOW");

    await upsertOutboundWebhook(ctx, acme, { kind: "EVENTS", url: `${hookUrl}/events`, secret: "events-secret-0123456789" });
    const held = await decideFor(acme, { customer: "+5511932000003", eventType: "marketing.campaign", data: { offer: "Convite" } });
    expect(held).toMatchObject({ status: "DELAYED", decisionAction: "DELAY", messageKind: "TEMPLATE" });
    expect(held.decisionReason).toContain("inbound_first_wait");
    expect(Math.round((held.scheduledFor!.getTime() - held.requestedAt.getTime()) / 60_000)).toBe(30);

    // The invitation goes to the tenant's endpoint — never to WhatsApp.
    const jobs = await ctx.queues[QUEUE.OUTBOUND_WEBHOOK].getJobs(["waiting"]);
    const wake = jobs.find((j) => (j.data as OutboundWebhookJob).event?.data.intentId === held.id)!;
    received = [];
    await deliverOutboundWebhook(ctx, wake.data as OutboundWebhookJob, { finalAttempt: false });
    const posted = JSON.parse(received[0]!.body) as { type: string; tenantId: string; data: Record<string, string> };
    expect(posted).toMatchObject({ type: "INBOUND_WAKEUP_REQUESTED", tenantId: acme.tenantId, data: { intentId: held.id, customer: "+5511932000003", templateName: "weekly_offer" } });
    expect(posted.data.link).toBe(`https://wa.me/551140000001?text=${encodeURIComponent(posted.data.prefilledText!)}`);
    expect(received[0]!.headers["x-wco-signature-256"]).toBe(signOutbound(received[0]!.body, "events-secret-0123456789"));
    expect(received[0]!.headers["x-wco-event"]).toBe("INBOUND_WAKEUP_REQUESTED");

    const before = mock().sent.length;
    await customerWrites("5511932000003", posted.data.prefilledText!);
    const converted = await ctx.db.messageIntent.findUniqueOrThrow({ where: { id: held.id } });
    expect(converted).toMatchObject({ messageKind: "NON_TEMPLATE", category: "SERVICE", contentCategory: "MARKETING" });
    expect(converted.decisionReason).toContain("inbound_first_converted");
    await flushGroup(ctx, { tenantId: acme.tenantId, groupKey: converted.groupKey });
    const attempt = await dispatch(acme.tenantId, held.id);
    expect(attempt).toMatchObject({ status: "SENT", messageKind: "NON_TEMPLATE" });
    expect(mock().sent.slice(before)).toEqual([expect.objectContaining({ type: "text" })]);
    const r = await routingSummary(ctx, acme.tenantId, {} as never);
    expect(r.inboundFirst).toMatchObject({ wakeUpsRequested: 1, convertedToFreeForm: 1, eventEndpoints: 1 });
    await campaignPolicy({});
  });
});

describe("Module 4 — mirror webhooks and BSP_MARKUP_AVOIDED", () => {
  it("copies the tenant's own Meta webhooks to its endpoint, signed, and only its own entries", async () => {
    const created = await upsertOutboundWebhook(ctx, acme, { kind: "MIRROR", url: `${hookUrl}/crm`, secret: "mirror-secret-0123456789", fields: ["messages"] });
    expect(created).toMatchObject({ kind: "MIRROR", hasSecret: true, fields: ["messages"] });
    expect(JSON.stringify(await listOutboundWebhooks(ctx, acme.tenantId))).not.toContain("mirror-secret");
    expect((await ctx.tenants.get(acme.tenantId)).mirrorWebhookUrls).toHaveLength(1);

    const eventId = await customerWrites("5511933000001", "Mensagem para o CRM");
    const job = (await ctx.queues[QUEUE.OUTBOUND_WEBHOOK].getJob(`mirror-${eventId}-${created.id}`))!;
    expect(JSON.stringify(job.data)).not.toContain("Mensagem para o CRM"); // the queue holds ids, not contents
    received = [];
    expect(await deliverOutboundWebhook(ctx, job.data as OutboundWebhookJob, { finalAttempt: false })).toEqual({ status: "delivered" });
    const got = received[0]!;
    expect(got.path).toBe("/crm");
    const body = JSON.parse(got.body) as { object: string; entry: Array<{ id: string; changes: Array<{ field: string; value: { messages: Array<{ text: { body: string } }> } }> }> };
    expect(body.entry).toHaveLength(1);
    expect(body.entry[0]).toMatchObject({ id: WABA, changes: [{ field: "messages" }] });
    expect(body.entry[0]!.changes[0]!.value.messages[0]!.text.body).toBe("Mensagem para o CRM");
    const signature = signOutbound(got.body, "mirror-secret-0123456789");
    expect(got.headers["x-wco-signature-256"]).toBe(signature);
    expect(got.headers["x-hub-signature-256"]).toBe(signature);

    // Another tenant's webhook is never queued for this endpoint.
    const other = await customerWrites("5511933000002", "Mensagem de outro tenant", false, "mock-waba-loja-demo", "mock-pn-loja-demo-1");
    expect(await ctx.queues[QUEUE.OUTBOUND_WEBHOOK].getJob(`mirror-${other}-${created.id}`)).toBeUndefined();
  });

  it("filters a batched payload down to the tenant's WABAs and wanted fields", () => {
    const raw = {
      object: "whatsapp_business_account",
      entry: [
        { id: "W-A", changes: [{ field: "messages", value: { a: 1 } }, { field: "account_update", value: { b: 2 } }] },
        { id: "W-B", changes: [{ field: "messages", value: { secret: "other tenant" } }] },
      ],
    };
    expect(payloadForTenant(raw, new Set(["W-A"]), [])).toEqual({ object: "whatsapp_business_account", entry: [raw.entry[0]] });
    expect(payloadForTenant(raw, new Set(["W-A"]), ["messages"])).toEqual({ object: "whatsapp_business_account", entry: [{ id: "W-A", changes: [{ field: "messages", value: { a: 1 } }] }] });
    expect(payloadForTenant(raw, new Set(["W-A"]), ["template_category_update"])).toBeNull();
    expect(payloadForTenant(raw, new Set(["W-Z"]), [])).toBeNull();
  });

  it("retries failed deliveries, alerts the tenant on the last attempt, and refuses unsafe targets in production", async () => {
    const hook = (await ctx.db.outboundWebhook.findFirstOrThrow({ where: { tenantId: acme.tenantId, kind: "MIRROR" } }));
    const eventId = await customerWrites("5511933000003", "Vai falhar");
    const job = (await ctx.queues[QUEUE.OUTBOUND_WEBHOOK].getJob(`mirror-${eventId}-${hook.id}`))!;
    respondWith = 500;
    try {
      await expect(deliverOutboundWebhook(ctx, job.data as OutboundWebhookJob, { finalAttempt: false })).rejects.toThrow("endpoint answered 500");
      expect(await ctx.db.outboundWebhook.findUniqueOrThrow({ where: { id: hook.id } })).toMatchObject({ lastStatus: 500, consecutiveFailures: 1 });
      await expect(deliverOutboundWebhook(ctx, job.data as OutboundWebhookJob, { finalAttempt: true })).rejects.toThrow();
      expect(await ctx.db.alert.count({ where: { tenantId: acme.tenantId, type: "WEBHOOK_FAILURE", dedupKey: { startsWith: `outbound-webhook:${hook.id}` } } })).toBe(1);
    } finally {
      respondWith = 200;
    }
    expect((ctx.queues[QUEUE.OUTBOUND_WEBHOOK].defaultJobOptions.backoff as { type: string }).type).toBe("exponential");
    expect(() => assertSafeWebhookUrl("http://crm.example.com/hook", { production: true })).toThrow(/HTTPS/);
    expect(() => assertSafeWebhookUrl("https://user:pw@crm.example.com/hook", { production: true })).toThrow();
    for (const bad of ["https://localhost/hook", "https://127.0.0.1/hook", "https://10.1.2.3/hook", "https://192.168.0.5/hook", "https://169.254.169.254/latest", "https://[::1]/hook"]) {
      expect(() => assertSafeWebhookUrl(bad, { production: true })).toThrow(/público/);
    }
    expect(assertSafeWebhookUrl("https://crm.example.com/hook", { production: true }).hostname).toBe("crm.example.com");
  });

  it("records the legacy BSP's fee as BSP savings on each message, apart from Meta savings", async () => {
    await updateTenant(ctx, acme, { legacyBspFeeModel: { type: "PERCENTAGE", percentOfMeta: "20", label: "BSP antigo" } });
    const intent = await decideFor(acme, { customer: "+5511933000004", eventType: "appointment.reminder", mustSendImmediately: true, data: { date: "amanhã", time: "10h" } });
    const attempt = await dispatch(acme.tenantId, intent.id);
    await metaStatus(attempt.providerMessageId!, "5511933000004", "delivered", { pricing: { billable: true, pricing_model: "PMP", category: "utility", type: "regular" } });
    const lines = await savingsOf(intent.id);
    expect(lines).toEqual([expect.objectContaining({ kind: "BSP", mechanism: "BSP_MARKUP_AVOIDED", confidence: "ESTIMATED" })]);
    expect(Number(lines[0]!.savings)).toBeCloseTo(Number(intent.baselineCost) * 0.2, 8);
    const s = await summary(ctx, acme.tenantId, {} as never);
    expect(s.savings.routing.BSP_MARKUP_AVOIDED).toMatchObject({ kind: "BSP", messages: 1 });
    expect(Number(s.savings.estimated.bsp)).toBeGreaterThanOrEqual(0);
    await updateTenant(ctx, acme, { legacyBspFeeModel: null });
  });
});

describe("Module 5 — per-tenant deliverability cache (131026 / 131049)", () => {
  it("stops calling the API for a number Meta reported as undeliverable — for that tenant only, by hash", async () => {
    const first = await decideFor(acme, { customer: "+5511934000001", eventType: "appointment.reminder", mustSendImmediately: true, data: { date: "hoje", time: "9h" } });
    const attempt = await dispatch(acme.tenantId, first.id);
    await metaStatus(attempt.providerMessageId!, "5511934000001", "failed", { errors: [{ code: 131026, title: "Message undeliverable" }] });
    const rows = await ctx.db.recipientDeliverabilityCache.findMany({ where: { tenantId: acme.tenantId } });
    expect(rows).toEqual([expect.objectContaining({ kind: "UNDELIVERABLE", errorCode: 131026, strikes: 1, phoneHash: first.customerPhoneHash })]);
    expect(JSON.stringify(rows)).not.toContain("5511934000001"); // only the hash is stored
    expect(Math.round((rows[0]!.expiresAt.getTime() - rows[0]!.lastSeenAt.getTime()) / 3_600_000)).toBe(24);

    const suppressed = await decideFor(acme, { customer: "+5511934000001", eventType: "appointment.reminder", data: { date: "amanhã", time: "9h" } });
    expect(suppressed).toMatchObject({ status: "BLOCKED", decisionAction: "BLOCK" });
    expect(suppressed.decisionReason).toContain("suppressed_invalid_recipient");
    expect(await ctx.db.messageAttempt.count({ where: { intentId: suppressed.id } })).toBe(0);
    // Only a provider call is saved: Meta does not bill undelivered messages.
    expect(await savingsOf(suppressed.id)).toEqual([expect.objectContaining({ kind: "INFRASTRUCTURE", mechanism: "INVALID_RECIPIENT_SUPPRESSED" })]);

    // OTP is never suppressed, and the other tenant knows nothing about this number.
    const otp = await decideFor(acme, { customer: "+5511934000001", eventType: "authentication.otp", data: { code: "424242" } });
    expect(otp.decisionAction).toBe("SEND_NOW");
    const otherTenant = await decideFor(demo, { customer: "+5511934000001", eventType: "appointment.reminder", data: { date: "amanhã", time: "9h" } });
    expect(otherTenant.status).not.toBe("BLOCKED");

    // A repeat failure waits longer (7 days); a message from the customer lifts it at once.
    const again = await dispatch(acme.tenantId, otp.id);
    await metaStatus(again.providerMessageId!, "5511934000001", "failed", { timestamp: Math.floor(Date.now() / 1000) + 5, errors: [{ code: 131026 }] });
    const escalated = await ctx.db.recipientDeliverabilityCache.findFirstOrThrow({ where: { tenantId: acme.tenantId, kind: "UNDELIVERABLE" } });
    expect(escalated.strikes).toBe(2);
    expect(Math.round((escalated.expiresAt.getTime() - escalated.lastSeenAt.getTime()) / 3_600_000)).toBe(168);
    await customerWrites("5511934000001", "Estou aqui");
    expect(await ctx.db.recipientDeliverabilityCache.count({ where: { tenantId: acme.tenantId, kind: "UNDELIVERABLE" } })).toBe(0);
    const ok = await decideFor(acme, { customer: "+5511934000001", eventType: "appointment.reminder", data: { date: "sexta", time: "9h" } });
    expect(ok.status).not.toBe("BLOCKED");
  });

  it("defers marketing during a 131049 cooldown, lets utility through, and clears on a delivered marketing template", async () => {
    const promo = await decideFor(acme, { customer: "+5511934000002", eventType: "marketing.campaign", mustSendImmediately: true, data: { offer: "Primeira" } });
    const attempt = await dispatch(acme.tenantId, promo.id);
    await metaStatus(attempt.providerMessageId!, "5511934000002", "failed", { errors: [{ code: 131049, title: "Marketing limit" }] });
    const cap = await ctx.db.recipientDeliverabilityCache.findFirstOrThrow({ where: { tenantId: acme.tenantId, kind: "MARKETING_FREQUENCY_CAP" } });
    expect(Math.round((cap.expiresAt.getTime() - cap.lastSeenAt.getTime()) / 3_600_000)).toBe(24); // Meta: wait at least 24 hours

    // marketing.campaign may wait up to 24 h: it goes at its deadline, just before the cooldown ends.
    const deferred = await decideFor(acme, { customer: "+5511934000002", eventType: "marketing.campaign", data: { offer: "Segunda" } });
    expect(deferred).toMatchObject({ status: "DELAYED", decisionAction: "DELAY" });
    expect(deferred.decisionReason).toContain("deferred_frequency_cap");
    expect(deferred.scheduledFor!.getTime()).toBe(Math.min(cap.expiresAt.getTime(), deferred.deadlineAt.getTime()));
    expect(deferred.scheduledFor!.getTime() - deferred.requestedAt.getTime()).toBeGreaterThan(23 * 3_600_000);
    expect(await savingsOf(deferred.id)).toEqual([expect.objectContaining({ kind: "INFRASTRUCTURE", mechanism: "FREQUENCY_CAP_DEFERRED" })]);

    const utility = await decideFor(acme, { customer: "+5511934000002", eventType: "appointment.reminder", data: { date: "hoje", time: "15h" } });
    expect(utility.decisionAction).toBe("SEND_NOW");
    const otp = await decideFor(acme, { customer: "+5511934000002", eventType: "authentication.otp", data: { code: "111222" } });
    expect(otp.decisionAction).toBe("SEND_NOW");

    const r = await routingSummary(ctx, acme.tenantId, {} as never);
    expect(r.deliverability).toMatchObject({ deferredMarketing: 1, recipientsInMarketingCooldownNow: 1 });

    // An immediate marketing message is still attempted; once Meta delivers it, the cooldown is gone.
    const urgent = await decideFor(acme, { customer: "+5511934000002", eventType: "marketing.campaign", mustSendImmediately: true, data: { offer: "Terceira" } });
    const sent = await dispatch(acme.tenantId, urgent.id);
    await metaStatus(sent.providerMessageId!, "5511934000002", "delivered", { pricing: { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" } });
    expect(await ctx.db.recipientDeliverabilityCache.count({ where: { tenantId: acme.tenantId, kind: "MARKETING_FREQUENCY_CAP" } })).toBe(0);
  });

  it("LGPD: the export lists the entries and erasure deletes them", async () => {
    const intent = await decideFor(acme, { customer: "+5511934000003", eventType: "appointment.reminder", mustSendImmediately: true, data: { date: "hoje", time: "8h" }, followUp: { text: "Oferta pendente" } });
    const attempt = await dispatch(acme.tenantId, intent.id);
    await metaStatus(attempt.providerMessageId!, "5511934000003", "failed", { errors: [{ code: 131026 }] });
    const exported = await exportCustomerData(ctx, acme, "+5511934000003");
    expect(exported.deliverability).toEqual([expect.objectContaining({ kind: "UNDELIVERABLE", errorCode: 131026, occurrences: 1 })]);
    expect(exported.followUps).toEqual([expect.objectContaining({ status: "PENDING", text: "Oferta pendente" })]);
    await deleteCustomerData(ctx, acme, "+5511934000003");
    expect(await ctx.db.recipientDeliverabilityCache.count({ where: { tenantId: acme.tenantId, phoneHash: intent.customerPhoneHash } })).toBe(0);
    expect(await ctx.db.deferredFollowUp.findUniqueOrThrow({ where: { intentId: intent.id } })).toMatchObject({ status: "CANCELLED", deferredFreeFormPayload: null });
  });
});
