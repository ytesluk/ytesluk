/**
 * node scripts/configurar-teste.mjs   — one-command setup of a real test with the Meta test number.
 * Plain Node (>= 18), no `pnpm install` needed. Meant for GitHub Codespaces (works elsewhere with --url).
 *
 * What only the person can do (their Meta account): create the app, add their phone as a recipient of
 * the test number and copy 5 values (App ID, App secret, WABA ID, Phone number ID, access token).
 * Everything else is done here:
 *   1. writes .env (MOCK_WHATSAPP=false, META_APP_ID/SECRET, a generated META_WEBHOOK_VERIFY_TOKEN);
 *   2. makes Codespaces port 4000 public (gh codespace ports visibility) and restarts the stack;
 *   3. checks that the public URL answers Meta's verification challenge;
 *   4. creates (or reuses) a WCO account, connects the WABA (validates the token with Meta, imports
 *      templates) and points the WABA's message webhooks to this Codespace (Meta webhook overrides);
 *   5. runs the 7-event scenario to your WhatsApp, without and with the WCO.
 *
 * Values can also come from the environment: WCO_META_APP_ID, WCO_META_APP_SECRET, WCO_META_WABA_ID,
 * WCO_META_PHONE_ID, WCO_META_TOKEN, WCO_TO. Options: --url <public base URL> (outside Codespaces),
 * --sem-docker (do not restart docker compose), --env-file <path> (default .env), --api <local URL>.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { client, runTestNumber, TestError } from "./test-number.mjs";

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    "sem-docker": { type: "boolean", default: false },
    "env-file": { type: "string", default: ".env" },
    api: { type: "string", default: "http://localhost:4000" },
    state: { type: "string", default: ".wco-teste.json" },
  },
});
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const say = (m = "") => console.log(m);
const step = (n, m) => console.log(`\n[${n}/7] ${m}`);
const fail = (m) => {
  throw new TestError(m);
};

// ------------------------------------------------------------------ input
/** Reads one line from the terminal in raw mode; secrets are echoed as "*" (pasting works). */
function readLine(question, secret) {
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(buf.trim());
          return;
        }
        if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length) {
            buf = buf.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        buf += ch;
        stdout.write(secret ? "*" : ch);
      }
    };
    stdin.on("data", onData);
  });
}

async function prompt(question, { secret = false, env } = {}) {
  if (env && process.env[env]) return process.env[env].trim();
  if (!stdin.isTTY) fail(`Falta ${env} (entrada não interativa).`);
  return readLine(question, secret);
}

async function readInputs() {
  say("Cole os valores do painel da Meta (developers.facebook.com › seu app › WhatsApp › API Setup):\n");
  const v = {
    appId: await prompt("  App ID (App settings › Basic): ", { env: "WCO_META_APP_ID" }),
    appSecret: await prompt("  App secret (App settings › Basic › Show): ", { secret: true, env: "WCO_META_APP_SECRET" }),
    wabaId: await prompt("  WhatsApp Business Account ID: ", { env: "WCO_META_WABA_ID" }),
    phoneId: await prompt("  Phone number ID (do número de teste): ", { env: "WCO_META_PHONE_ID" }),
    token: await prompt("  Access token (Generate access token ou token do System User): ", { secret: true, env: "WCO_META_TOKEN" }),
    to: await prompt("  Seu celular cadastrado em 'To' (ex.: +5541999999999): ", { env: "WCO_TO" }),
  };
  for (const [k, val] of Object.entries(v)) if (!val) fail(`Valor vazio: ${k}.`);
  if (!/^\+\d{10,15}$/.test(v.to)) fail("Celular no formato +5541999999999 (com + e DDI).");
  return v;
}

// ------------------------------------------------------------------ .env
function writeEnv(path, updates) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (key && key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  const missing = Object.keys(updates).filter((k) => !seen.has(k));
  if (missing.length) out.push("", "# configurado por scripts/configurar-teste.mjs", ...missing.map((k) => `${k}=${updates[k]}`));
  writeFileSync(path, out.join("\n").replace(/\n*$/, "\n"));
  chmodSync(path, 0o600);
}

function envValue(path, key) {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

// ------------------------------------------------------------------ environment
function publicBase() {
  if (args.url) return args.url.replace(/\/$/, "");
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (name && domain) return `https://${name}-4000.${domain}`;
  return fail("Fora do Codespaces: informe --url com o endereço público HTTPS da porta 4000.");
}

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  return r.status === 0;
}

async function waitFor(fn, label, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    try {
      const r = await fn();
      if (r === true) return;
      last = r || last;
    } catch (e) {
      last = String(e.message ?? e);
    }
    await sleep(3000);
  }
  fail(`${label} (último erro: ${last || "sem resposta"}).`);
}

// ------------------------------------------------------------------ main
async function main() {
  say("WCO — configurar teste com o número de teste da Meta\n");
  if (!existsSync("docker-compose.yml")) fail("Rode este comando na pasta do projeto (whatsapp-cost-optimizer).");
  say("Antes, no painel da Meta: crie o app (caso de uso WhatsApp), clique em 'Start using the API' e adicione");
  say("o seu celular em 'To' (confirme o código que chega no WhatsApp). Depois responda abaixo.\n");
  const v = await readInputs();
  const base = publicBase();
  const callbackUrl = `${base}/api/v1/webhooks/meta`;

  step(1, `Gravando ${args["env-file"]} (modo real, App ID e App secret; o token não vai para o arquivo)`);
  const verifyToken = envValue(args["env-file"], "META_WEBHOOK_VERIFY_TOKEN") || randomBytes(18).toString("base64url");
  writeEnv(args["env-file"], {
    MOCK_WHATSAPP: "false",
    META_APP_ID: v.appId,
    META_APP_SECRET: v.appSecret,
    META_WEBHOOK_VERIFY_TOKEN: verifyToken,
    META_GRAPH_API_VERSION: envValue(args["env-file"], "META_GRAPH_API_VERSION") || "v26.0",
  });

  step(2, "Deixando a porta 4000 pública e reiniciando o sistema");
  if (process.env.CODESPACE_NAME) {
    if (!run("gh", ["codespace", "ports", "visibility", "4000:public", "-c", process.env.CODESPACE_NAME])) {
      say("  ! Não consegui mudar sozinho. Na aba Portas: botão direito na 4000 › Visibilidade da porta › Pública");
      say("    (o assistente espera até 3 minutos por isso no passo 3).");
    }
  }
  if (!args["sem-docker"]) {
    const files = process.env.CODESPACE_NAME ? ["-f", "docker-compose.yml", "-f", "infra/docker/compose.host-network.yml"] : [];
    if (!run("docker", ["compose", ...files, "up", "-d", "--build"])) fail("docker compose falhou (veja a saída acima).");
  }
  const local = client(args.api);
  await waitFor(async () => {
    const h = await local("GET", "health");
    if (h.status !== 200) return `HTTP ${h.status}`;
    return h.body.mockWhatsApp === false ? true : "ainda em modo MOCK (o .env não foi lido?)";
  }, "A API não subiu em modo real", 8 * 60_000);
  say("  API no ar em modo real.");

  step(3, `Conferindo se a Meta alcança ${base}`);
  await waitFor(async () => {
    const res = await fetch(`${callbackUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=wco-ok`, { redirect: "manual" });
    if (res.status === 200 && (await res.text()) === "wco-ok") return true;
    return res.status === 302 || res.status === 401 ? "a porta 4000 ainda está privada" : `HTTP ${res.status}`;
  }, "O endereço público não respondeu ao teste de verificação do webhook", 3 * 60_000);
  say("  Endereço público respondendo ao desafio de verificação, como a Meta vai fazer.");

  step(4, "Criando (ou reutilizando) a conta de teste no WCO");
  let state = existsSync(args.state) ? JSON.parse(readFileSync(args.state, "utf8")) : null;
  let token;
  if (state) {
    const r = await local("POST", "auth/login", { email: state.email, password: state.password });
    if (r.status === 200) token = r.body.token;
  }
  if (!token) {
    state = { email: `teste-${randomBytes(4).toString("hex")}@example.com`, password: randomBytes(12).toString("base64url") };
    const r = await local("POST", "auth/signup", { companyName: "Teste WCO", name: "Teste", email: state.email, password: state.password, acceptTerms: true, timezone: "America/Sao_Paulo" });
    if (r.status !== 201) fail(`Não consegui criar a conta (${r.status}): ${r.body.error?.message ?? ""}`);
    token = r.body.token;
    writeFileSync(args.state, JSON.stringify(state, null, 2));
    chmodSync(args.state, 0o600);
  }
  const api = client(args.api, { authorization: `Bearer ${token}` });

  step(5, "Conectando a conta do WhatsApp (o token é validado na Meta e guardado criptografado)");
  const conn = await api("POST", "onboarding/manual", { businessName: "Teste WCO", wabaId: v.wabaId, phoneNumberId: v.phoneId, accessToken: v.token, timezone: "America/Sao_Paulo" });
  if (conn.status !== 200) fail(`A Meta recusou a conexão (${conn.status}): ${conn.body.error?.message ?? JSON.stringify(conn.body)}${conn.body.error?.providerCode === 190 ? " — token inválido ou expirado: gere outro." : ""}`);
  const tpl = conn.body.templates ?? {};
  say(tpl.error ? `  ! ${tpl.error}` : `  Conectado. Templates importados: ${tpl.synced ?? 0} (${tpl.approved ?? 0} aprovados).`);

  step(6, "Apontando os webhooks de mensagens da conta para este Codespace");
  const ov = await api("POST", "onboarding/webhook-override", { callbackUrl });
  if (ov.status !== 200) fail(`A Meta não aceitou o webhook (${ov.status}): ${ov.body.error?.message ?? JSON.stringify(ov.body)}`);
  say(`  Webhook: ${callbackUrl}`);

  step(7, "Teste real: 7 eventos sem otimização e com o WCO para o seu WhatsApp");
  const result = await runTestNumber({ api: args.api, auth: { authorization: `Bearer ${token}` }, to: v.to, template: "hello_world", lang: "en_US", compare: true, timeoutS: 180 });

  const dash = process.env.CODESPACE_NAME ? `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : "o painel (porta 3000)";
  say("—".repeat(60));
  say(`Painel: ${dash}  ·  login ${state.email}  ·  senha ${state.password}  (salvos em ${args.state})`);
  say("Veja Mensagens (o motivo de cada decisão) e Visão geral.");
  if (result.optimized.webhooks === 0) {
    say("! Os status da Meta não chegaram. Configure também no painel da Meta › WhatsApp › Configuration:");
    say(`  Callback URL ${callbackUrl} · Verify token ${verifyToken} · assine o campo 'messages'.`);
  }
  if (process.env.CODESPACE_NAME) say(`Ao terminar: gh codespace ports visibility 4000:private -c ${process.env.CODESPACE_NAME}`);
}

main().catch((e) => {
  console.error(`\n✘ ${e instanceof TestError ? e.message : (e?.stack ?? e)}\n`);
  process.exit(1);
});
