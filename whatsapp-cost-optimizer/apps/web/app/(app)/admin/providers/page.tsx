"use client";

import { ArrowRight, CheckCircle2, Code2, Copy, KeyRound, Plug, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader } from "@/components/ui";
import { useApiBase } from "@/components/shell";
import { ApiError, api, useApi } from "@/lib/api";

interface Status {
  mode: "MOCK" | "MANUAL" | "EMBEDDED_SIGNUP";
  appMode: string;
  graphApiVersion: string | null;
  commercialOnboarding: { allowed: boolean; missing: string[] };
  steps: Record<string, "DONE" | "PENDING" | "BLOCKED">;
  embeddedSignup: { appId: string; configId: string; graphApiVersion: string } | null;
  pricingDemoOnly: boolean;
  notes: string[];
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(ok);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Step 2: the company's system sends its notices through the WCO (that is where the savings happen).
 * The owner creates a key here and hands it to whoever maintains the system; the key is shown once.
 */
function ConnectSystem() {
  const keys = useApi<ApiKey[]>("api-keys");
  const base = useApiBase() || "https://<endereço do WCO>";
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const active = (keys.data ?? []).filter((k) => !k.revokedAt);
  const used = active.some((k) => k.lastUsedAt);
  const ownerOnly = keys.error?.status === 403;

  const create = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await api<{ key: string }>("api-keys", { body: { name: "Sistema da empresa", role: "OPERATOR" } });
      setKey(r.key);
      keys.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      /* the key stays on screen to copy by hand */
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-4">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${used ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"}`} aria-hidden>
          {used ? <CheckCircle2 className="size-5" /> : <KeyRound className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[20px] font-semibold tracking-tight text-ink">
            {used ? "Seu sistema já envia pelo WCO" : active.length ? "Chave criada, falta o seu sistema usar" : "Conecte o seu sistema"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">
            Para a economia acontecer, os avisos automáticos da sua empresa (pedidos, entregas, agenda, cobranças) precisam sair pelo WCO. Gere uma chave e entregue para quem cuida do sistema da sua empresa. É feito uma vez só.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4 border-t border-dashed border-rule pt-5">
        {ownerOnly ? (
          <p className="text-sm text-ink-2">Só o dono da conta pode gerar a chave. Peça a ele para abrir esta tela.</p>
        ) : (
          <>
            {key ? (
              <div className="rounded-xl border border-[var(--warning)] bg-surface p-4">
                <p className="text-sm font-medium text-ink">Copie a chave agora: ela não aparece de novo.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink">{key}</code>
                  <Button type="button" onClick={() => void copy()} className="h-9">
                    <Copy className="size-3.5" aria-hidden /> {copied ? "Copiada" : "Copiar"}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={active.length ? "secondary" : "primary"} onClick={() => void create()} loading={busy}>
                {active.length ? "Gerar outra chave" : "Gerar chave"}
              </Button>
              {active.length ? (
                <span className="text-xs text-muted">
                  {active.length} chave{active.length > 1 ? "s" : ""} ativa{active.length > 1 ? "s" : ""}
                  {used ? " · em uso" : " · ainda não usada"}
                </span>
              ) : null}
            </div>
            {error ? <ErrorBox error={error} title="A chave não foi criada" /> : null}
          </>
        )}

        <details className="group rounded-xl bg-surface-2/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            Instruções para o técnico
            <span className="text-lg leading-none text-muted transition group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed text-ink-2">
            <p>
              Em vez de enviar o aviso direto para a Meta, o sistema envia para o WCO, com a chave no cabeçalho <code className="text-xs text-ink">X-API-Key</code>. O WCO decide o melhor jeito de enviar e repassa à Meta pelo mesmo número.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface p-3 text-xs leading-relaxed text-ink">{`POST ${base}/api/v1/messages/intents
X-API-Key: <a chave>
Content-Type: application/json

{
  "customer": "+5511999999999",
  "eventType": "order.status",
  "entityId": "PED-4521",
  "data": { "orderId": "4521", "statusLabel": "pedido enviado" },
  "consent": { "optIn": true }
}`}</pre>
            <p>
              <strong className="text-ink">customer</strong>: telefone do cliente · <strong className="text-ink">eventType</strong>: tipo do aviso · <strong className="text-ink">entityId</strong>: número do pedido (é o que permite juntar e atualizar avisos do mesmo pedido).
            </p>
            <p>
              Para o que é urgente, como código de verificação, use <code className="text-xs text-ink">/api/v1/messages/send</code>, que sai na hora. A documentação completa fica no link <strong className="text-ink">API</strong>, no topo da tela.
            </p>
          </div>
        </details>
      </div>
    </Card>
  );
}

/**
 * After the number is connected: how will the company's notices leave? Through its own system (a key)
 * or from the WCO itself ("Enviar mensagens", for companies without a system or on a paid platform).
 */
function HowYouSend() {
  const keys = useApi<ApiKey[]>("api-keys");
  const [picked, setWay] = useState<"system" | "panel" | null>(null);
  // A company that already has a key has chosen its own system: open on that step.
  const way = picked ?? ((keys.data ?? []).some((k) => !k.revokedAt) ? "system" : null);
  const option = (id: "system" | "panel", Icon: typeof Code2, title: string, text: string) => (
    <button
      type="button"
      aria-pressed={way === id}
      onClick={() => setWay(id)}
      className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition ${way === id ? "border-[var(--accent)] bg-surface ring-2 ring-[var(--accent)]/25" : "border-line bg-surface hover:border-[var(--accent)]"}`}
    >
      <Icon className="size-5 text-accent" aria-hidden />
      <span className="font-medium text-ink">{title}</span>
      <span className="text-sm leading-relaxed text-ink-2">{text}</span>
    </button>
  );
  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-[20px] font-semibold tracking-tight text-ink">Como a sua empresa manda os avisos?</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">A economia acontece nas mensagens que saem pelo WCO. Escolha o seu caso.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {option("system", Code2, "Tenho um sistema próprio", "A loja virtual ou o sistema da empresa manda os avisos sozinho. Basta ligar ele ao WCO com uma chave.")}
        {option("panel", Send, "Uso uma plataforma ou não tenho sistema", "Você manda os avisos e as campanhas por aqui mesmo, no WCO, em vez da plataforma que paga hoje.")}
      </div>
      {way === "system" ? <ConnectSystem /> : null}
      {way === "panel" ? (
        <Card>
          <p className="text-sm leading-relaxed text-ink-2">
            Em <strong className="text-ink">Enviar mensagens</strong> você escolhe um modelo aprovado, cola os números dos clientes e envia. O WCO entrega cada mensagem do jeito mais barato.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Se você só conversa pelo app WhatsApp Business no celular, essas mensagens já são grátis e continuam assim. O WCO ajuda quando você precisa mandar avisos ou campanhas para muitos clientes.
          </p>
          <Link href="/send" className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink hover:opacity-90">
            Ir para Enviar mensagens <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>
      ) : null}
    </div>
  );
}

/** A collapsed block: what most companies never need stays one click away instead of on the page. */
function More({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-lg leading-none text-muted transition group-open:rotate-45" aria-hidden>
          +
        </span>
      </summary>
      <div className="space-y-4 border-t border-dashed border-rule px-5 py-5">{children}</div>
    </details>
  );
}

export default function ProvidersPage() {
  const { data, error, loading, reload } = useApi<Status>("onboarding");
  const mock = useAction();
  const manual = useAction();
  const [m, setM] = useState({ businessName: "", wabaId: "", phoneNumberId: "", accessToken: "", timezone: "America/Sao_Paulo", currency: "BRL" });
  const [welcome, setWelcome] = useState(false);
  useEffect(() => setWelcome(new URLSearchParams(window.location.search).has("welcome")), []);

  const connected = data ? data.steps.WABA === "DONE" && data.steps.PHONE_NUMBER === "DONE" : false;
  const ready = data?.steps.READY === "DONE";
  const test = data?.mode === "MOCK";

  return (
    <>
      <PageHeader title="Conectar WhatsApp" description="Ligue o número oficial da sua empresa ao WCO. Leva poucos minutos e o número continua sendo seu." />
      {welcome ? (
        <div className="mb-6">
          <Notice tone="good">Conta criada. Próximo passo: conecte o WhatsApp da sua empresa.</Notice>
        </div>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="max-w-3xl space-y-4">
          <More title="Conecte agora">
            <div>
              <p className="text-sm font-medium text-ink">Com os dados da sua conta na Meta</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Para quem já tem a conta configurada: o ID da conta, o ID do número e um token de acesso. O token é validado na Meta e guardado criptografado.
              </p>
              <form
                autoComplete="off"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void manual.run(() => api("onboarding/manual", { body: m }).then(reload), "WhatsApp conectado.");
                }}
                className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                <Field label="Nome da empresa"><Input autoComplete="organization" value={m.businessName} onChange={(x) => setM({ ...m, businessName: x.target.value })} required /></Field>
                <Field label="ID da conta (WABA ID)"><Input name="waba-id" autoComplete="off" value={m.wabaId} onChange={(x) => setM({ ...m, wabaId: x.target.value })} required /></Field>
                <Field label="ID do número (Phone Number ID)"><Input name="phone-number-id" autoComplete="off" value={m.phoneNumberId} onChange={(x) => setM({ ...m, phoneNumberId: x.target.value })} required /></Field>
                <Field label="Token de acesso"><Input type="password" name="meta-access-token" autoComplete="new-password" value={m.accessToken} onChange={(x) => setM({ ...m, accessToken: x.target.value })} required /></Field>
                <Field label="Fuso horário"><Input value={m.timezone} onChange={(x) => setM({ ...m, timezone: x.target.value })} /></Field>
                <div className="flex items-end">
                  <Button type="submit" variant="primary" loading={manual.busy}>Conectar</Button>
                </div>
              </form>
              {manual.done ? <div className="mt-3"><Notice tone="good">{manual.done}</Notice></div> : null}
              {manual.error ? <div className="mt-3"><ErrorBox error={manual.error} title="Conexão recusada" /></div> : null}
            </div>

            <div className="border-t border-dashed border-rule pt-4">
              <p className="text-sm font-medium text-ink">Conta de teste</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">Simula o WhatsApp para você conhecer o sistema. Nenhuma mensagem de verdade é enviada.</p>
              <div className="mt-3">
                <Button onClick={() => mock.run(() => api("onboarding/mock", { method: "POST", body: {} }).then(reload), "Conta de teste conectada.")} loading={mock.busy}>
                  Usar conta de teste
                </Button>
              </div>
              {mock.done ? <div className="mt-3"><Notice tone="good">{mock.done}</Notice></div> : null}
              {mock.error ? <div className="mt-3"><ErrorBox error={mock.error} /></div> : null}
            </div>
          </More>

          <Card>
            <div className="flex items-start gap-4">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${connected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"}`} aria-hidden>
                {connected ? <CheckCircle2 className="size-5" /> : <Plug className="size-5" />}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[20px] font-semibold tracking-tight text-ink">
                  {connected ? (ready ? "WhatsApp conectado" : "Quase pronto") : "WhatsApp ainda não conectado"}
                  {connected && test ? (
                    <span className="ml-2 align-middle">
                      <Badge tone="warning">conta de teste</Badge>
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">
                  {connected
                    ? ready
                      ? "O número da sua empresa está ligado ao WCO."
                      : "O número está ligado. Faltam alguns ajustes para começar a enviar."
                    : data.embeddedSignup
                      ? "Clique no botão abaixo, entre com a conta do Facebook da empresa e escolha o número."
                      : "Conecte o número da sua empresa em “Conecte agora”, logo acima."}
                </p>
              </div>
            </div>

            {data.embeddedSignup && (!connected || test) ? (
              <div className="mt-5 border-t border-dashed border-rule pt-5">
                {/* Full page load (not <Link>): the route's own CSP, which allows Meta's SDK, applies only to a fresh document. */}
                <a href="/admin/providers/embedded-signup" className="inline-flex h-11 items-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink hover:opacity-90">
                  Conectar com o Facebook
                </a>
              </div>
            ) : null}
          </Card>

          {connected ? <HowYouSend /> : null}
        </div>
      ) : null}
    </>
  );
}
