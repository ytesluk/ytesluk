import { randomUUID } from "node:crypto";
import type { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_APP_SECRET, TEST_VERIFY_TOKEN, migrateTestDatabase, truncateAll, useTestEnv, waitFor } from "@wco/testing";
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
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
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
        return st.every((s) => FINAL.has(s) && s !== "SENT") ? rows.map((r) => r.body.intent) : null;
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
    const wait = new Date(detail.intent.scheduledFor).getTime() - new Date(detail.intent.createdAt).getTime();
    expect(wait).toBeLessThan(2_000);
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
