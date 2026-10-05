/**
 * pnpm teste-numero --to +5541999999999 [--template hello_world] [--lang en_US] [--comparar]
 *
 * Real test with the Meta test number (or any connected number): sends a small, known scenario
 * through the WCO API to YOUR WhatsApp and shows what the WCO decided and what Meta reported.
 *
 *   A. 4 status updates of the same order within seconds  → expected: 1 message (the latest)
 *   B. the same payment notice sent twice (integration retry) → expected: 1 message
 *   C. an urgent notice (mustSendImmediately)              → expected: 1 message, right away
 *   Without the WCO these 7 events would be 7 messages; with it, 3.
 *   --comparar also runs the same 7 events with optimization switched off (7 messages) first.
 *
 * Credentials: API_KEY (Admin › Tenant e acesso › chaves de API) or WCO_EMAIL + WCO_PASSWORD.
 * API_URL defaults to http://localhost:4000. The template must exist and be APPROVED on the WABA and
 * be imported (Admin › Templates › Sincronizar com a Meta); hello_world has no variables.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    template: { type: "string", default: "hello_world" },
    lang: { type: "string", default: "en_US" },
    comparar: { type: "boolean", default: false },
    timeout: { type: "string", default: "180" },
  },
});
const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TIMEOUT_MS = Number(values.timeout) * 1000;
const FINAL = new Set(["SENT", "DELIVERED", "READ", "FAILED", "SUPERSEDED", "DEDUPLICATED", "CONSOLIDATED", "BLOCKED", "CANCELLED"]);
const DELIVERED = new Set(["SENT", "DELIVERED", "READ"]);
const LABEL: Record<string, string> = {
  SENT: "enviada",
  DELIVERED: "entregue",
  READ: "lida",
  FAILED: "falhou",
  SUPERSEDED: "substituída pela mais recente (não enviada)",
  DEDUPLICATED: "reenvio bloqueado (não enviada)",
  CONSOLIDATED: "consolidada",
  BLOCKED: "bloqueada pela política",
  CANCELLED: "cancelada",
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- generic JSON
let auth: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${API}/api/v1/${path}`, {
    method,
    headers: { ...auth, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

function fail(message: string): never {
  console.error(`\n✘ ${message}\n`);
  process.exit(1);
}

async function authenticate() {
  if (process.env.API_KEY) {
    auth = { "x-api-key": process.env.API_KEY };
    return;
  }
  if (process.env.WCO_EMAIL && process.env.WCO_PASSWORD) {
    const r = await call("POST", "auth/login", { email: process.env.WCO_EMAIL, password: process.env.WCO_PASSWORD });
    if (r.status !== 200) fail(`Login recusado (${r.status}). Confira WCO_EMAIL e WCO_PASSWORD.`);
    auth = { authorization: `Bearer ${r.body.token}` };
    return;
  }
  fail("Informe API_KEY=... (Admin › Tenant e acesso) ou WCO_EMAIL=... WCO_PASSWORD=...");
}

async function preflight(to: string) {
  const health = await call("GET", "health").catch(() => fail(`API fora do ar em ${API}.`));
  if (health.body.mockWhatsApp) fail("A API está em modo MOCK (MOCK_WHATSAPP=true): nada chegaria ao seu celular. Veja docs/SETUP-META.md › Número de teste.");
  const onboarding = await call("GET", "onboarding");
  // OPERATOR keys cannot read onboarding; the intents call below reports a missing number anyway.
  if (onboarding.status === 200 && onboarding.body.steps?.PHONE_NUMBER !== "DONE") fail("Nenhum número conectado. Use Admin › Conectar WhatsApp › Conexão manual.");
  const templates = await call("GET", "templates");
  const t = (templates.body as unknown as Json[]).find((x) => x.name === values.template && x.language === values.lang);
  if (!t) fail(`Template ${values.template} (${values.lang}) não está no WCO. Em Admin › Templates clique em "Sincronizar com a Meta".`);
  if (t.status !== "APPROVED") fail(`Template ${values.template} está ${t.status} na Meta; só templates APPROVED podem ser enviados.`);
  console.log(`API ${API} · número conectado · template ${values.template} (${values.lang}, categoria ${t.metaCategory ?? t.declaredCategory}) · destino ${to.replace(/\d(?=\d{4})/g, "•")}`);
}

/** The 7 events of the scenario. `control` switches every optimization off (what happens without the WCO). */
function scenario(to: string, run: string, control: boolean) {
  const base = { customer: to, template: { name: values.template, language: values.lang }, consent: { optIn: true, source: "teste-numero" } };
  const off = control ? { mustSendImmediately: true, optimization: { allowDeduplication: false, allowAggregation: false, allowSupersession: false } } : {};
  const order = `PED-${run}`;
  const pay = { orderId: `PAG-${run}`, amount: "R$ 120,00" };
  return [
    ...["CRIADO", "PAGO", "SEPARADO", "ENVIADO"].map((status) => ({ step: "A", label: `pedido ${order}: ${status}`, body: { ...base, ...off, eventType: "order.status", entityId: order, data: { orderId: order, status } } })),
    ...[1, 2].map((n) => ({ step: "B", label: `pagamento ${pay.orderId} aprovado (envio ${n})`, body: { ...base, ...off, eventType: "payment.approved", entityId: pay.orderId, data: pay } })),
    { step: "C", label: "aviso urgente", body: { ...base, ...off, eventType: "security.notice", entityId: `SEG-${run}`, mustSendImmediately: true, data: { notice: "novo acesso" } } },
  ];
}

/** `pricing` as reported by Meta in the latest status webhook of the message, if any arrived. */
function pricingOf(audit: Json): Json | null {
  const deliveries = ((audit.attempts as Json[] | undefined) ?? []).flatMap((x) => (x.deliveries as Json[] | undefined) ?? []);
  return [...deliveries].reverse().find((d) => d.pricingBillable !== null && d.pricingBillable !== undefined) ?? null;
}

async function runScenario(to: string, control: boolean) {
  const run = randomUUID().slice(0, 6).toUpperCase();
  console.log(`\n=== ${control ? "Sem otimização (como seria sem o WCO)" : "Com o WCO"} — rodada ${run} ===`);
  const sent: Array<{ step: string; label: string; id: string }> = [];
  for (const e of scenario(to, run, control)) {
    const r = await call("POST", "messages/intents", { ...e.body, idempotencyKey: `${run}-${sent.length}` });
    if (r.status >= 300) fail(`Evento recusado (${r.status}): ${r.body.error?.message ?? JSON.stringify(r.body)}`);
    sent.push({ step: e.step, label: e.label, id: r.body.intentId });
    await new Promise((ok) => setTimeout(ok, 700));
  }
  console.log(`${sent.length} eventos enviados ao WCO. Aguardando decisões e o retorno da Meta (até ${values.timeout} s; atualizações de pedido esperam até 60 s por novidades)…`);

  const end = Date.now() + TIMEOUT_MS;
  let audits: Json[] = [];
  let settledAt: number | null = null;
  while (Date.now() < end) {
    audits = await Promise.all(sent.map((s) => call("GET", `messages/${s.id}`).then((r) => r.body)));
    const decided = audits.every((a) => FINAL.has(a.intent?.status));
    // After the decisions, give Meta's status webhooks (with `pricing`) a little time to arrive.
    const confirmed = audits.every((a) => !DELIVERED.has(a.intent?.status) || pricingOf(a));
    if (decided) settledAt ??= Date.now();
    if (decided && (confirmed || Date.now() - settledAt! > 30_000)) break;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  let messages = 0;
  sent.forEach((s, i) => {
    const a = audits[i]?.intent ?? {};
    const status = String(a.status ?? "?");
    if (DELIVERED.has(status)) messages++;
    const p = pricingOf(audits[i]!);
    const cost = p
      ? ` · Meta: ${p.pricingBillable ? "cobrável" : "não cobrável"} (${p.pricingCategory ?? "?"}, ${p.pricingType ?? "?"})${a.realizedCost !== null && a.realizedCost !== undefined ? ` · ${a.realizedCost} pelo rate card` : ""}`
      : DELIVERED.has(status)
        ? " · sem webhook de status da Meta ainda (confira a URL do webhook)"
        : "";
    console.log(`  ${s.step} ${s.label.padEnd(40)} → ${LABEL[status] ?? status}${cost}`);
  });
  const pending = audits.filter((a) => !FINAL.has(a.intent?.status)).length;
  if (pending) console.log(`  ! ${pending} evento(s) ainda sem decisão final — veja Mensagens no painel.`);
  for (const a of audits.filter((x) => x.intent?.status === "FAILED")) {
    const attempt = (a.attempts as Json[] | undefined)?.at(-1);
    console.log(`  ! falha na Meta: ${attempt?.errorCode ?? "?"} ${attempt?.errorMessage ?? "veja o detalhe da mensagem no painel"}`);
  }
  console.log(`Resultado: ${sent.length} eventos → ${messages} mensagem(ns) no seu WhatsApp.`);
  return messages;
}

async function main() {
  const to = values.to;
  if (!to || !/^\+\d{10,15}$/.test(to)) fail("Use --to com o seu número no formato +5541999999999 (cadastrado como destinatário do número de teste).");
  await authenticate();
  await preflight(to);
  const control = values.comparar ? await runScenario(to, true) : null;
  const optimized = await runScenario(to, false);
  console.log("\nConfira no celular. Esperado: 3 mensagens com o WCO" + (control !== null ? ` e 7 sem otimização (recebidas: ${control} sem, ${optimized} com).` : "."));
  console.log("Cada decisão tem o motivo em Mensagens › (abrir a mensagem) no painel.\n");
}

void main();
