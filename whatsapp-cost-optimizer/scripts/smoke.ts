/**
 * pnpm smoke — end-to-end check against a RUNNING deployment (docker compose, staging, …), MOCK mode.
 *
 *   API_URL=http://localhost:4000 API_KEY=wco_demo_loja_dev_only_0000000000000000 pnpm smoke
 *
 * Exercises the public API only: health, auth, idempotency, deduplication, supersession (four order
 * updates → one message), OTP never delayed, webhook signature rejection and Meta-confirmed costs.
 * MOCK mode simulates delivery failures (MOCK_DELIVERY_RATE, default 0.97): a message that was sent but
 * FAILED still proves the decision path; the cost check is skipped (not failed) in that case.
 * Exits non-zero when any check fails.
 */
import { randomUUID } from "node:crypto";

const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const KEY = process.env.API_KEY ?? "wco_demo_loja_dev_only_0000000000000000";
const TIMEOUT_S = Number(process.env.SMOKE_TIMEOUT_S ?? 150);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- generic JSON
let failures = 0;
const DISPATCHED = ["SENT", "DELIVERED", "READ", "FAILED"];

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "x-api-key": KEY, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function until<T>(fn: () => Promise<T | null>, label: string): Promise<T | null> {
  const end = Date.now() + TIMEOUT_S * 1000;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`  (timeout waiting for ${label})`);
  return null;
}

const audit = async (id: string) => (await call("GET", `/api/v1/messages/${id}`)).body;
const intent = (b: Json) => call("POST", "/api/v1/messages/intents", { consent: { optIn: true, source: "smoke" }, ...b });

const health = await call("GET", "/api/v1/health");
check("health", health.status === 200 && health.body.status === "ok", JSON.stringify(health.body.checks));
check("authentication required", (await fetch(`${API}/api/v1/messages`)).status === 401);

const run = randomUUID().slice(0, 8);
const idem = `smoke-${run}`;
const first = await intent({ customer: "+5511955510001", eventType: "payment.approved", entityId: `PAY-${run}`, data: { orderId: `PAY-${run}`, amount: "R$ 10,00" }, idempotencyKey: idem });
const replay = await intent({ customer: "+5511955510001", eventType: "payment.approved", entityId: `PAY-${run}`, data: { orderId: `PAY-${run}`, amount: "R$ 10,00" }, idempotencyKey: idem });
check("idempotent replay", first.status === 202 && replay.status === 200 && replay.body.intentId === first.body.intentId);
const dup = await intent({ customer: "+5511955510001", eventType: "payment.approved", entityId: `PAY-${run}`, data: { orderId: `PAY-${run}`, amount: "R$ 10,00" } });

const otp = await intent({ customer: "+5511955510002", eventType: "authentication.otp", entityId: `login-${run}`, data: { code: "123456" } });

const order = `ORD-${run}`;
const ids: string[] = [];
for (const [i, status] of ["CREATED", "PAID", "PACKED", "SHIPPED"].entries()) {
  const r = await intent({ customer: "+5511955510003", eventType: "order.status", entityId: order, data: { orderId: order, status, statusLabel: status.toLowerCase() }, occurredAt: new Date(Date.now() + i).toISOString() });
  ids.push(r.body.intentId as string);
}

const otpDone = await until(async () => {
  const a = await audit(otp.body.intentId);
  return DISPATCHED.includes(a.intent?.status) ? a : null;
}, "OTP dispatch");
check("OTP sent immediately", !!otpDone && otpDone.decisions[0]?.action === "SEND_NOW", otpDone ? `${otpDone.intent.status}, decision ${otpDone.decisions[0]?.action}` : "");

// Identical events: exactly one is sent and the other is DEDUPLICATED (which one depends on the order in
// which concurrent workers optimize them — both carry the same content).
const pair = await until(async () => {
  const st = [(await audit(first.body.intentId)).intent?.status, (await audit(dup.body.intentId)).intent?.status] as string[];
  return st.includes("DEDUPLICATED") && st.some((s) => DISPATCHED.includes(s)) ? st : null;
}, "duplicate decision");
check("duplicate event → a single message", !!pair, pair?.join(",") ?? "");

const flow = await until(async () => {
  const rows = await Promise.all(ids.map(audit));
  const st = rows.map((r) => r.intent?.status as string);
  // The delivery status and the Meta-confirmed cost are written by the same webhook job, a few ms apart.
  const done = rows.some((r) => (["DELIVERED", "READ"].includes(r.intent?.status) && r.intent?.realizedConfidence === "REALIZED") || r.intent?.status === "FAILED");
  return st.filter((s) => s === "SUPERSEDED").length === 3 && done ? rows : null;
}, "order flow");
check("four order updates → one message (3 superseded)", !!flow, flow ? flow.map((r) => r.intent.status).join(",") : "");
if (flow) {
  const sent = flow.find((r) => r.intent.status !== "SUPERSEDED")!;
  if (sent.intent.status === "FAILED") console.log("– cost confirmation skipped: the mock simulated a delivery failure (Meta does not charge failed messages)");
  else check("cost confirmed by Meta-shaped webhook (REALIZED)", sent.intent.realizedConfidence === "REALIZED", `realized ${sent.intent.realizedCost} ${sent.intent.currency}`);
  check("audit records pricing policy and rate card", !!sent.why?.pricingPolicy && !!sent.why?.rateCard, `${sent.why?.pricingPolicy} · ${sent.why?.rateCard}`);
}

const bad = await fetch(`${API}/api/v1/webhooks/meta`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" }, body: "{}" });
check("webhook with invalid signature rejected", bad.status === 401);

const savings = await call("GET", "/api/v1/savings");
check("savings endpoint (META/BSP/infra separated)", savings.status === 403 || (savings.status === 200 && "costs" in savings.body), `HTTP ${savings.status}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
