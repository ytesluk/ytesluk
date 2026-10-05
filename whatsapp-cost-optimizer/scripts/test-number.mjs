/**
 * node scripts/test-number.mjs --to +5541999999999 [--template hello_world] [--lang en_US] [--comparar]
 * (also `pnpm teste-numero …`). Plain Node (>= 18), no dependencies: runs in a Codespace without
 * `pnpm install`.
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
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const FINAL = new Set(["SENT", "DELIVERED", "READ", "FAILED", "SUPERSEDED", "DEDUPLICATED", "CONSOLIDATED", "BLOCKED", "CANCELLED"]);
const DELIVERED = new Set(["SENT", "DELIVERED", "READ"]);
const LABEL = {
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
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export class TestError extends Error {}

/** Minimal API client. `auth` is a header object (x-api-key or authorization). */
export function client(api, auth = {}) {
  const base = api.replace(/\/$/, "");
  return async function call(method, path, body) {
    const res = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: { ...auth, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  };
}

/** `pricing` as reported by Meta in the latest status webhook of the message, if any arrived. */
function pricingOf(audit) {
  const deliveries = (audit.attempts ?? []).flatMap((x) => x.deliveries ?? []);
  return [...deliveries].reverse().find((d) => d.pricingBillable !== null && d.pricingBillable !== undefined) ?? null;
}

async function preflight(call, opts, log) {
  const health = await call("GET", "health").catch(() => {
    throw new TestError(`API fora do ar em ${opts.api}.`);
  });
  if (health.body.mockWhatsApp) throw new TestError("A API está em modo MOCK (MOCK_WHATSAPP=true): nada chegaria ao seu celular.");
  const onboarding = await call("GET", "onboarding");
  // OPERATOR keys cannot read onboarding; the intents call reports a missing number anyway.
  if (onboarding.status === 200 && onboarding.body.steps?.PHONE_NUMBER !== "DONE") throw new TestError("Nenhum número conectado (Admin › Conectar WhatsApp › Conexão manual).");
  const templates = await call("GET", "templates");
  const t = (Array.isArray(templates.body) ? templates.body : []).find((x) => x.name === opts.template && x.language === opts.lang);
  if (!t) throw new TestError(`Template ${opts.template} (${opts.lang}) não está no WCO. Em Admin › Templates clique em "Sincronizar com a Meta".`);
  if (t.status !== "APPROVED") throw new TestError(`Template ${opts.template} está ${t.status} na Meta; só templates APPROVED podem ser enviados.`);
  log(`API ${opts.api} · número conectado · template ${opts.template} (${opts.lang}, categoria ${t.metaCategory ?? t.declaredCategory}) · destino ${opts.to.replace(/\d(?=\d{4})/g, "•")}`);
}

/** The 7 events of the scenario. `control` switches every optimization off (what happens without the WCO). */
function scenario(opts, run, control) {
  const base = { customer: opts.to, template: { name: opts.template, language: opts.lang }, consent: { optIn: true, source: "teste-numero" } };
  const off = control ? { mustSendImmediately: true, optimization: { allowDeduplication: false, allowAggregation: false, allowSupersession: false } } : {};
  const order = `PED-${run}`;
  const pay = { orderId: `PAG-${run}`, amount: "R$ 120,00" };
  return [
    ...["CRIADO", "PAGO", "SEPARADO", "ENVIADO"].map((status) => ({ step: "A", label: `pedido ${order}: ${status}`, body: { ...base, ...off, eventType: "order.status", entityId: order, data: { orderId: order, status } } })),
    ...[1, 2].map((n) => ({ step: "B", label: `pagamento ${pay.orderId} aprovado (envio ${n})`, body: { ...base, ...off, eventType: "payment.approved", entityId: pay.orderId, data: pay } })),
    { step: "C", label: "aviso urgente", body: { ...base, ...off, eventType: "security.notice", entityId: `SEG-${run}`, mustSendImmediately: true, data: { notice: "novo acesso" } } },
  ];
}

async function runScenario(call, opts, control, log) {
  const run = randomUUID().slice(0, 6).toUpperCase();
  log(`\n=== ${control ? "Sem otimização (como seria sem o WCO)" : "Com o WCO"} — rodada ${run} ===`);
  const sent = [];
  for (const e of scenario(opts, run, control)) {
    const r = await call("POST", "messages/intents", { ...e.body, idempotencyKey: `${run}-${sent.length}` });
    if (r.status >= 300) throw new TestError(`Evento recusado (${r.status}): ${r.body.error?.message ?? JSON.stringify(r.body)}`);
    sent.push({ step: e.step, label: e.label, id: r.body.intentId });
    await sleep(700);
  }
  log(`${sent.length} eventos enviados ao WCO. Aguardando decisões e o retorno da Meta (até ${opts.timeoutS} s; atualizações de pedido esperam até 60 s por novidades)…`);

  const end = Date.now() + opts.timeoutS * 1000;
  let audits = [];
  let settledAt = null;
  while (Date.now() < end) {
    audits = await Promise.all(sent.map((s) => call("GET", `messages/${s.id}`).then((r) => r.body)));
    const decided = audits.every((a) => FINAL.has(a.intent?.status));
    // After the decisions, give Meta's status webhooks (with `pricing`) a little time to arrive.
    const confirmed = audits.every((a) => !DELIVERED.has(a.intent?.status) || pricingOf(a));
    if (decided) settledAt ??= Date.now();
    if (decided && (confirmed || Date.now() - settledAt > 30_000)) break;
    await sleep(3000);
  }
  let messages = 0;
  let webhooks = 0;
  sent.forEach((s, i) => {
    const a = audits[i]?.intent ?? {};
    const status = String(a.status ?? "?");
    if (DELIVERED.has(status)) messages++;
    const p = pricingOf(audits[i] ?? {});
    if (p) webhooks++;
    const realized = a.realizedCost !== null && a.realizedCost !== undefined ? ` · ${a.realizedCost} pelo rate card` : "";
    const cost = p
      ? ` · Meta: ${p.pricingBillable ? "cobrável" : "não cobrável"} (${p.pricingCategory ?? "?"}, ${p.pricingType ?? "?"})${realized}`
      : DELIVERED.has(status)
        ? " · sem webhook de status da Meta ainda"
        : "";
    log(`  ${s.step} ${s.label.padEnd(40)} → ${LABEL[status] ?? status}${cost}`);
  });
  const pending = audits.filter((a) => !FINAL.has(a.intent?.status)).length;
  if (pending) log(`  ! ${pending} evento(s) ainda sem decisão final — veja Mensagens no painel.`);
  for (const a of audits.filter((x) => x.intent?.status === "FAILED")) {
    const attempt = (a.attempts ?? []).at(-1);
    log(`  ! falha na Meta: ${attempt?.errorCode ?? "?"} ${attempt?.errorMessage ?? "veja o detalhe da mensagem no painel"}`);
  }
  log(`Resultado: ${sent.length} eventos → ${messages} mensagem(ns) no seu WhatsApp.`);
  return { events: sent.length, messages, webhooks, failed: audits.filter((x) => x.intent?.status === "FAILED").length };
}

/** Runs the scenario (and the control first, with `compare`). Throws TestError with a readable message. */
export async function runTestNumber(opts, log = console.log) {
  if (!opts.to || !/^\+\d{10,15}$/.test(opts.to)) throw new TestError("Use o seu número no formato +5541999999999 (cadastrado como destinatário do número de teste).");
  const call = client(opts.api, opts.auth);
  await preflight(call, opts, log);
  const control = opts.compare ? await runScenario(call, opts, true, log) : null;
  const optimized = await runScenario(call, opts, false, log);
  log("\nConfira no celular. Esperado: 3 mensagens com o WCO" + (control ? ` e 7 sem otimização (recebidas: ${control.messages} sem, ${optimized.messages} com).` : "."));
  if (optimized.messages > 0 && optimized.webhooks === 0) {
    log("! Nenhum webhook de status chegou: a Meta não está alcançando a API (porta pública? webhook configurado? META_APP_SECRET correto?).");
  }
  log("Cada decisão tem o motivo em Mensagens › (abrir a mensagem) no painel.\n");
  return { control, optimized };
}

async function authFromEnv(api) {
  if (process.env.API_KEY) return { "x-api-key": process.env.API_KEY };
  if (process.env.WCO_EMAIL && process.env.WCO_PASSWORD) {
    const r = await client(api)("POST", "auth/login", { email: process.env.WCO_EMAIL, password: process.env.WCO_PASSWORD });
    if (r.status !== 200) throw new TestError(`Login recusado (${r.status}). Confira WCO_EMAIL e WCO_PASSWORD.`);
    return { authorization: `Bearer ${r.body.token}` };
  }
  throw new TestError("Informe API_KEY=... (Admin › Tenant e acesso) ou WCO_EMAIL=... WCO_PASSWORD=...");
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const { values } = parseArgs({
    options: {
      to: { type: "string" },
      template: { type: "string", default: "hello_world" },
      lang: { type: "string", default: "en_US" },
      comparar: { type: "boolean", default: false },
      timeout: { type: "string", default: "180" },
    },
  });
  const api = process.env.API_URL ?? "http://localhost:4000";
  try {
    await runTestNumber({ api, auth: await authFromEnv(api), to: values.to, template: values.template, lang: values.lang, compare: values.comparar, timeoutS: Number(values.timeout) });
  } catch (e) {
    console.error(`\n✘ ${e instanceof TestError ? e.message : e}\n`);
    process.exit(1);
  }
}
