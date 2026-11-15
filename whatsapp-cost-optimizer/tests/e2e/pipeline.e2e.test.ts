import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_APP_SECRET, TEST_VERIFY_TOKEN, migrateTestDatabase, statusWebhook, truncateAll, useTestEnv, waitFor } from "@wco/testing";
import { computeSignature } from "@wco/whatsapp";
import { createAppContext, seedAll, type AppContext } from "@wco/services";
import { buildApp } from "../../apps/api/src/app";
import { startWorkers } from "../../apps/worker/src/workers";

/**
 * End-to-end: real HTTP API + BullMQ workers + PostgreSQL + Redis, WhatsApp in MOCK mode
 * (signed, Meta-shaped webhooks delivered back to the API). Covers spec §41 cases 1–4, 9, 10 over
 * the public interface, plus authentication, RBAC, validation and rate limiting.
 */
const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
let ctx: AppContext;
let app: FastifyInstance;
let workers: Worker[] = [];
let demoKey: string;
let acmeKey: string;
let ownerToken: string;
let analystToken: string;
let password: string;

async function call(method: string, path: string, opts: { body?: unknown; key?: string; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.key) headers["x-api-key"] = opts.key;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions navigate arbitrary JSON
  return { status: res.status, body: json as any };
}

const intent = (body: Record<string, unknown>, key = demoKey) => call("POST", "/api/v1/messages/intents", { key, body: { consent: { optIn: true, source: "e2e" }, ...body } });
const audit = (id: string, key = demoKey) => call("GET", `/api/v1/messages/${id}`, { key });
const FINAL = new Set(["DELIVERED", "READ", "FAILED", "SUPERSEDED", "DEDUPLICATED", "CONSOLIDATED", "BLOCKED", "CANCELLED", "SENT"]);

beforeAll(async () => {
  useTestEnv({ API_PORT: String(PORT), API_INTERNAL_URL: BASE, API_PUBLIC_URL: BASE, MOCK_MAX_LATENCY_MS: "100" });
  migrateTestDatabase();
  ctx = createAppContext({ service: "e2e" });
  await truncateAll(ctx.db);
  await ctx.redis.flushdb();
  const seed = await seedAll(ctx, { demoHistory: false });
  demoKey = seed.apiKeys["loja-demo"]!;
  acmeKey = seed.apiKeys.acme!;
  password = seed.password;
  app = await buildApp(ctx, { logger: false });
  await app.listen({ port: PORT, host: "127.0.0.1" });
  workers = startWorkers(ctx);
});

afterAll(async () => {
  await Promise.allSettled(workers.map((w) => w.close()));
  await app?.close();
  await ctx?.close();
});

describe("system", () => {
  it("health checks DB and Redis", async () => {
    const r = await call("GET", "/api/v1/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
  });

  it("publishes an OpenAPI document with the spec endpoints", async () => {
    const r = await call("GET", "/api/openapi.json");
    expect(r.status).toBe(200);
    for (const p of ["/api/v1/messages/intents", "/api/v1/webhooks/meta", "/api/v1/cost/estimate", "/api/v1/savings", "/api/v1/pricing/import"]) expect(r.body.paths).toHaveProperty([p]);
  });

  it("exposes Prometheus metrics to authenticated users", async () => {
    const r = await call("GET", "/api/v1/metrics", { key: demoKey });
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain("wco_");
  });
});

describe("authentication and RBAC (spec §45)", () => {
  it("rejects missing or invalid credentials", async () => {
    expect((await call("GET", "/api/v1/messages")).status).toBe(401);
    expect((await call("GET", "/api/v1/messages", { key: "wco_invalid_key" })).status).toBe(401);
    expect((await call("GET", "/api/v1/messages", { token: "not.a.jwt" })).status).toBe(401);
    expect((await call("POST", "/api/v1/auth/login", { body: { email: "owner@loja-demo.wco.dev", password: "wrong-password" } })).status).toBe(401);
  });

  it("logs in users and enforces role permissions", async () => {
    const owner = await call("POST", "/api/v1/auth/login", { body: { email: "owner@loja-demo.wco.dev", password } });
    expect(owner.status).toBe(200);
    ownerToken = owner.body.token;
    const analyst = await call("POST", "/api/v1/auth/login", { body: { email: "analyst@loja-demo.wco.dev", password } });
    analystToken = analyst.body.token;
    const me = await call("GET", "/api/v1/auth/me", { token: ownerToken });
    expect(me.body.actor.role).toBe("OWNER");
    expect(me.body.tenant.slug).toBe("loja-demo");

    // ANALYST: analytics yes, messages no.
    expect((await call("GET", "/api/v1/analytics", { token: analystToken })).status).toBe(200);
    expect((await call("POST", "/api/v1/messages/intents", { token: analystToken, body: { customer: "+5511900000000", eventType: "x" } })).status).toBe(403);
    // OPERATOR (seed API key): messages yes, policy changes no.
    expect((await call("POST", "/api/v1/optimization/policies", { key: demoKey, body: { eventType: "order.status" } })).status).toBe(403);
  });

  it("OWNER shortens the order.status buffer for this test run (policy change is audited)", async () => {
    const r = await call("POST", "/api/v1/optimization/policies", {
      token: ownerToken,
      body: {
        eventType: "order.status",
        maxDelaySeconds: 6,
        debounceSeconds: 2,
        allowSupersession: true,
        allowAggregation: true,
        supersessionGroup: "order.status",
        consolidationTemplate: "order_update_summary",
        defaultTemplate: "order_status_update",
        category: "UTILITY",
      },
    });
    expect(r.status).toBe(200);
    const log = await call("GET", "/api/v1/audit?entityType=OptimizationPolicy", { token: ownerToken });
    expect(JSON.stringify(log.body)).toContain("policy.optimization.updated");
  });

  it("validates input with field-level errors", async () => {
    const r = await intent({ eventType: "order.status" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("optimization pipeline over HTTP (spec §41)", () => {
  it("case 2 / §63 — four updates of the same order in seconds become one message", async () => {
    const order = `ORD-${randomUUID().slice(0, 8)}`;
    const ids: string[] = [];
    for (const [i, status] of ["CREATED", "PAID", "PACKED", "SHIPPED"].entries()) {
      const r = await intent({ customer: "+5511955550001", eventType: "order.status", entityId: order, data: { orderId: order, status, statusLabel: status.toLowerCase() }, occurredAt: new Date(Date.now() + i).toISOString() });
      expect(r.status).toBe(202);
      ids.push(r.body.intentId);
    }
    const finals = await waitFor(
      async () => {
        const rows = await Promise.all(ids.map((id) => audit(id)));
        const st = rows.map((r) => r.body.intent.status as string);
        const realized = rows.some((r) => r.body.intent.realizedConfidence === "REALIZED");
        return st.every((s) => FINAL.has(s) && s !== "SENT") && realized ? rows.map((r) => r.body.intent) : null;
      },
      { timeoutMs: 45_000, label: "order flow" },
    );
    const sent = finals.filter((i) => i.status === "DELIVERED" || i.status === "READ");
    expect(sent).toHaveLength(1);
    expect(finals.filter((i) => i.status === "SUPERSEDED")).toHaveLength(3);
    expect(sent[0].data?.status ?? sent[0].payloadSummary ?? "SHIPPED").toBeTruthy();
    const detail = (await audit(sent[0].id)).body;
    expect(detail.intent.realizedConfidence).toBe("REALIZED");
    expect(detail.costs.some((c: { policyVersion: string | null }) => c.policyVersion)).toBe(true);
    const superseded = (await audit(finals.find((i) => i.status === "SUPERSEDED")!.id)).body;
    expect(superseded.savings.length).toBeGreaterThan(0);
  });

  it("case 1 — the same event twice results in a single message", async () => {
    const order = `PAY-${randomUUID().slice(0, 8)}`;
    const body = { customer: "+5511955550002", eventType: "payment.approved", entityId: order, data: { orderId: order, amount: "R$ 10,00" } };
    const a = await intent(body);
    const b = await intent(body);
    const st = await waitFor(
      async () => {
        const s = [(await audit(a.body.intentId)).body.intent.status, (await audit(b.body.intentId)).body.intent.status];
        return s.includes("DEDUPLICATED") ? s : null;
      },
      { timeoutMs: 20_000, label: "dedup" },
    );
    expect(st.filter((s: string) => s === "DEDUPLICATED")).toHaveLength(1);
  });

  it("idempotency key replay returns the same intent (200)", async () => {
    const key = `idem-${randomUUID()}`;
    const a = await intent({ customer: "+5511955550003", eventType: "payment.approved", entityId: "I-1", data: { orderId: "I-1" }, idempotencyKey: key });
    const b = await intent({ customer: "+5511955550003", eventType: "payment.approved", entityId: "I-1", data: { orderId: "I-1" }, idempotencyKey: key });
    expect(a.status).toBe(202);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ intentId: a.body.intentId, idempotent: true });
  });

  it("case 3 — OTP is sent immediately (never buffered)", async () => {
    const r = await intent({ customer: "+5511955550004", eventType: "authentication.otp", entityId: `login-${randomUUID()}`, data: { code: "481516" } });
    const detail = await waitFor(async () => {
      const d = (await audit(r.body.intentId)).body;
      return ["SENT", "DELIVERED", "READ"].includes(d.intent.status) ? d : null;
    }, { timeoutMs: 15_000, label: "otp" });
    expect(detail.decisions[0].action).toBe("SEND_NOW");
    expect(detail.decisions[0].reasons.join(",")).toMatch(/authentication_message/);
    // No buffering delay is introduced by the decision (queue latency before the decision is not a policy delay).
    const delay = new Date(detail.intent.scheduledFor).getTime() - new Date(detail.decisions[0].createdAt).getTime();
    expect(delay).toBeLessThanOrEqual(1_000);
  });

  it("case 4 — critical messages skip the buffer", async () => {
    const r = await intent({ customer: "+5511955550005", eventType: "order.status", entityId: `CRIT-${randomUUID().slice(0, 6)}`, priority: "CRITICAL", data: { orderId: "X", status: "CANCELLED" } });
    const detail = await waitFor(async () => {
      const d = (await audit(r.body.intentId)).body;
      return d.decisions.length ? d : null;
    }, { timeoutMs: 15_000, label: "critical" });
    expect(detail.decisions[0].action).toBe("SEND_NOW");
    expect(detail.decisions[0].reasons.join(",")).toMatch(/critical_message/);
  });
});

describe("tenant isolation over HTTP (spec §41 case 9)", () => {
  it("another tenant gets 404 and never sees the data", async () => {
    const r = await intent({ customer: "+5511955550006", eventType: "payment.approved", entityId: "T-1", data: { orderId: "T-1" } });
    expect((await audit(r.body.intentId, acmeKey)).status).toBe(404);
    expect((await audit(r.body.intentId, demoKey)).status).toBe(200);
    const list = await call("GET", "/api/v1/messages?limit=200", { key: acmeKey });
    expect(JSON.stringify(list.body)).not.toContain(r.body.intentId);
  });
});

describe("SaaS self-service signup over HTTP", () => {
  it("creates an account, signs in, sees an empty FREE tenant and cannot reach other tenants", async () => {
    const r = await call("POST", "/api/v1/auth/signup", { body: { companyName: "Ótica Central", name: "Bia", email: "bia@otica.test", password: "senha-forte-123", acceptTerms: true } });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ role: "OWNER", tenant: { slug: "otica-central" } });
    const token = r.body.token as string;
    expect((await call("GET", "/api/v1/auth/me", { token })).body.tenant.name).toBe("Ótica Central");
    const billing = await call("GET", "/api/v1/billing", { token });
    expect(billing.status).toBe(200);
    expect(billing.body.plan.code).toBe("FREE");
    expect(billing.body.usage.intents).toBe(0);
    expect((await call("GET", "/api/v1/messages?limit=5", { token })).body.items).toHaveLength(0);
    const other = await intent({ customer: "+5511955550007", eventType: "payment.approved", entityId: "S-1", data: { orderId: "S-1" } });
    expect((await call("GET", `/api/v1/messages/${other.body.intentId}`, { token })).status).toBe(404);
    expect((await call("POST", "/api/v1/auth/signup", { body: { companyName: "Outra", name: "X", email: "BIA@otica.test", password: "senha-forte-123", acceptTerms: true } })).status).toBe(409);
    expect((await call("POST", "/api/v1/auth/signup", { body: { companyName: "Outra", name: "X", email: "x@otica.test", password: "senha-forte-123", acceptTerms: false } })).status).toBe(400);
  });
});

describe("Meta webhooks (spec §25)", () => {
  it("answers the verification challenge only with the right token", async () => {
    const ok = await call("GET", `/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=1158201444`);
    expect(ok.status).toBe(200);
    expect(String(ok.body)).toBe("1158201444");
    expect((await call("GET", "/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status).toBe(403);
  });

  it("rejects bad signatures and acknowledges duplicates once (case 10)", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "mock-waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "unknown" }, statuses: [] } }] }] });
    const post = (sig: string) => fetch(`${BASE}/api/v1/webhooks/meta`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body });
    expect((await post("sha256=00")).status).toBe(401);
    const sig = computeSignature(body, TEST_APP_SECRET);
    const first = await (await post(sig)).json();
    const second = await (await post(sig)).json();
    expect(first).toMatchObject({ received: true, duplicate: false });
    expect(second).toMatchObject({ received: true, duplicate: true });
  });
});

describe("cost routing over HTTP (workers + mock Cloud API)", () => {
  let acmeOwner: string;
  const acmeAudit = (id: string) => audit(id, acmeKey);
  /** Waits until the simulated customer message was processed (the customer service window is open). */
  async function customerWrites(customer: string, text: string) {
    expect((await call("POST", "/api/v1/dev/simulate-inbound", { key: acmeKey, body: { customer, text } })).status).toBe(200);
    const hash = ctx.vault.hashPhone(customer);
    await waitFor(async () => (await ctx.db.customerServiceWindow.count({ where: { customerPhoneHash: hash, lastInboundMessageAt: { gt: new Date(Date.now() - 60_000) } } })) > 0, { label: "inbound processed" });
  }
  const delivered = (id: string, label: string) =>
    waitFor(
      async () => {
        const a = (await acmeAudit(id)).body;
        return (a.intent.status === "DELIVERED" || a.intent.status === "READ") && a.intent.realizedConfidence === "REALIZED" ? a : null;
      },
      { timeoutMs: 45_000, label },
    );

  it("documents the new endpoints", async () => {
    const r = await call("GET", "/api/openapi.json");
    for (const p of ["/api/v1/webhooks/outbound", "/api/v1/webhooks/outbound/{id}", "/api/v1/routing", "/api/v1/templates/split"]) expect(r.body.paths).toHaveProperty([p]);
    acmeOwner = (await call("POST", "/api/v1/auth/login", { body: { email: "owner@acme.wco.dev", password } })).body.token;
    expect(acmeOwner).toBeTruthy();
  });

  it("module 1 — a marketing template goes as a free-form service message while the customer's window is open", async () => {
    const policy = { eventType: "marketing.campaign", maxDelaySeconds: 86_400, defaultTemplate: "weekly_offer", category: "MARKETING", priority: "LOW", dedupWindowSeconds: 604_800, allowMarketingFreeFormInWindow: true };
    expect((await call("POST", "/api/v1/optimization/policies", { token: acmeOwner, body: policy })).status).toBe(200);
    await customerWrites("+5511960000001", "Tem alguma promoção?");
    const r = await intent({ customer: "+5511960000001", eventType: "marketing.campaign", data: { offer: "Tênis com 10% off" } }, acmeKey);
    expect(r.status).toBe(202);
    const a = await delivered(r.body.intentId, "template to free-form");
    expect(a.intent).toMatchObject({ messageKind: "NON_TEMPLATE", category: "SERVICE", contentCategory: "MARKETING", templateName: "weekly_offer" });
    expect(a.intent.decisionReason).toContain("template_to_freeform_csw");
    expect(a.attempts[0]).toMatchObject({ messageKind: "NON_TEMPLATE", category: "SERVICE" });
    expect(a.savings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "META", mechanism: "TEMPLATE_TO_FREEFORM_CSW" })]));
    expect(Number(a.intent.realizedCost)).toBeLessThan(Number(a.intent.baselineCost));
    const routing = (await call("GET", "/api/v1/routing", { token: acmeOwner })).body;
    expect(routing.templateToFreeForm.messages).toBeGreaterThanOrEqual(1);
    expect(routing.savings.TEMPLATE_TO_FREEFORM_CSW).toMatchObject({ kind: "META", messages: 1 });
    // Same request with no open window: the paid template, untouched.
    const cold = await intent({ customer: "+5511960000002", eventType: "marketing.campaign", data: { offer: "Tênis com 10% off" } }, acmeKey);
    const b = await delivered(cold.body.intentId, "cold template");
    expect(b.intent).toMatchObject({ messageKind: "TEMPLATE", category: "MARKETING" });
  });

  it("module 2 — the deferred offer is sent only after the customer replies", async () => {
    const first = await intent({ customer: "+5511960000003", eventType: "payment.approved", entityId: "PAG-E2E", mustSendImmediately: true, data: { orderId: "E2E", amount: "R$ 50,00" }, followUp: { text: "Use o cupom VOLTA10 na próxima compra." } }, acmeKey);
    const a = await delivered(first.body.intentId, "transactional template");
    expect(a.intent).toMatchObject({ messageKind: "TEMPLATE", category: "UTILITY" });
    expect(a.followUp).toMatchObject({ status: "PENDING" });
    const list = () => call("GET", "/api/v1/messages?eventType=followup.deferred", { key: acmeKey });
    expect((await list()).body.items).toHaveLength(0);
    await customerWrites("+5511960000003", "Obrigado!");
    const followUpId = await waitFor(async () => (await list()).body.items[0]?.id as string | undefined, { label: "follow-up created" });
    const f = await delivered(followUpId, "follow-up");
    expect(f.intent).toMatchObject({ eventType: "followup.deferred", messageKind: "NON_TEMPLATE", category: "SERVICE", contentCategory: "MARKETING" });
    expect(f.savings).toEqual(expect.arrayContaining([expect.objectContaining({ mechanism: "UTILITY_SPLIT_DEFERRED" })]));
    const split = await call("POST", "/api/v1/templates/split", { token: acmeOwner, body: { body: "Pagamento do pedido {{1}} confirmado. Aproveite 10% de desconto com o cupom VOLTA10!" } });
    expect(split.body).toMatchObject({ transactional: "Pagamento do pedido {{1}} confirmado.", looksUtility: true });
  });

  it("module 4 — the tenant's CRM receives a signed copy of its Meta webhooks", async () => {
    const got: Array<{ sig: string | undefined; body: string }> = [];
    const crm = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ sig: req.headers["x-hub-signature-256"] as string | undefined, body });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((ok) => crm.listen(0, "127.0.0.1", ok));
    try {
      const url = `http://127.0.0.1:${(crm.address() as AddressInfo).port}/meta`;
      const secret = "crm-secret-0123456789abcdef";
      const created = await call("POST", "/api/v1/webhooks/outbound", { token: acmeOwner, body: { kind: "MIRROR", url, secret, fields: ["messages"] } });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ kind: "MIRROR", hasSecret: true });
      expect((await call("POST", "/api/v1/webhooks/outbound", { key: acmeKey, body: { kind: "MIRROR", url } })).status).toBe(403); // OPERATOR key
      await customerWrites("+5511960000004", "Mensagem espelhada");
      const copy = await waitFor(async () => got.find((g) => g.body.includes("Mensagem espelhada")), { label: "mirrored webhook" });
      expect(copy.sig).toBe(`sha256=${createHmac("sha256", secret).update(copy.body).digest("hex")}`);
      expect(JSON.parse(copy.body).entry.map((e: { id: string }) => e.id)).toEqual(["mock-waba-acme"]);
      const listed = (await call("GET", "/api/v1/webhooks/outbound", { token: acmeOwner })).body;
      expect(JSON.stringify(listed)).not.toContain(secret);
      expect(listed.webhooks[0]).toMatchObject({ lastStatus: 200, consecutiveFailures: 0 });
      expect((await call("DELETE", `/api/v1/webhooks/outbound/${created.body.id}`, { token: acmeOwner })).body).toEqual({ deleted: true });
    } finally {
      await new Promise((ok) => crm.close(ok));
    }
  });

  it("module 5 — a number Meta reported as undeliverable is not attempted again, except for OTP", async () => {
    const first = await intent({ customer: "+5511960000005", eventType: "appointment.reminder", mustSendImmediately: true, data: { date: "hoje", time: "10h" } }, acmeKey);
    const a = await delivered(first.body.intentId, "first reminder");
    const failed = JSON.stringify(statusWebhook({ wabaId: "mock-waba-acme", phoneNumberId: "mock-pn-acme-1", providerMessageId: a.attempts[0].providerMessageId, recipientWaId: "5511960000005", status: "failed", timestamp: Math.floor(Date.now() / 1000) + 2, errors: [{ code: 131026, title: "Message undeliverable" }] }));
    const posted = await fetch(`${BASE}/api/v1/webhooks/meta`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": computeSignature(failed, TEST_APP_SECRET) }, body: failed });
    expect(posted.status).toBe(200);
    await waitFor(async () => (await ctx.db.recipientDeliverabilityCache.count({ where: { kind: "UNDELIVERABLE" } })) > 0, { label: "deliverability recorded" });
    const next = await intent({ customer: "+5511960000005", eventType: "appointment.reminder", data: { date: "amanhã", time: "10h" } }, acmeKey);
    const blocked = await waitFor(async () => {
      const x = (await acmeAudit(next.body.intentId)).body;
      return x.intent.status === "BLOCKED" ? x : null;
    }, { label: "suppressed" });
    expect(blocked.intent.decisionReason).toContain("suppressed_invalid_recipient");
    expect(blocked.attempts).toHaveLength(0);
    const otp = await intent({ customer: "+5511960000005", eventType: "authentication.otp", data: { code: "998877" } }, acmeKey);
    const sent = await waitFor(async () => {
      const x = (await acmeAudit(otp.body.intentId)).body;
      return FINAL.has(x.intent.status) ? x : null;
    }, { label: "otp" });
    expect(sent.intent.status).not.toBe("BLOCKED");
    expect((await call("GET", "/api/v1/routing", { token: acmeOwner })).body.deliverability).toMatchObject({ suppressedMessages: 1, recipientsUndeliverableNow: 1 });
  });
});

describe("rate limiting (spec §55)", () => {
  it("returns 429 above the per-credential limit", async () => {
    const limited = await buildApp({ ...ctx, config: { ...ctx.config, env: { ...ctx.config.env, RATE_LIMIT_PER_MINUTE: 3 } } }, { logger: false });
    const key = `rl-${randomUUID()}`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.inject({ method: "GET", url: "/api/v1/health", headers: { "x-api-key": key } })).statusCode);
    await limited.close();
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});
