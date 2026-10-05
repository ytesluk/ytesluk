"use client";

import { CheckCircle2, CircleDashed, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, Notice, PageHeader } from "@/components/ui";
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

const STEP: Record<string, string> = {
  META_ACCOUNT: "Conta Meta",
  BUSINESS_ACCOUNT: "Business Account",
  WABA: "WhatsApp Business Account (WABA)",
  PHONE_NUMBER: "Número de telefone",
  PERMISSIONS: "Permissões / token",
  WEBHOOK: "Webhook inscrito",
  VALIDATION: "Validação",
  PRICING_SNAPSHOT: "Política e rate card",
  READY: "Pronto",
};

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

export default function ProvidersPage() {
  const { data, error, loading, reload } = useApi<Status>("onboarding");
  const mock = useAction();
  const manual = useAction();
  const [m, setM] = useState({ businessName: "", wabaId: "", phoneNumberId: "", accessToken: "", timezone: "America/Sao_Paulo", currency: "BRL" });
  const [welcome, setWelcome] = useState(false);
  useEffect(() => setWelcome(new URLSearchParams(window.location.search).has("welcome")), []);

  return (
    <>
      <PageHeader title="Conectar WhatsApp" description="Conecte a WhatsApp Business Platform (Cloud API). As chamadas à Meta acontecem só no servidor; tokens ficam criptografados (AES-256-GCM) e nunca aparecem em logs." />
      {welcome ? (
        <div className="mb-6">
          <Notice tone="good">Conta criada. Próximo passo: conecte o WhatsApp da sua empresa. Sem credenciais da Meta, use o modo MOCK para testar o fluxo completo.</Notice>
        </div>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title="Situação" className="xl:col-span-1">
              <KeyValue
                cols={1}
                items={[
                  ["Modo", <Badge key="m" tone={data.mode === "MOCK" ? "warning" : "good"}>{data.mode}</Badge>],
                  ["Ambiente", data.appMode],
                  ["Graph API", data.graphApiVersion ?? "não configurada"],
                  ["Onboarding comercial", data.commercialOnboarding.allowed ? "permitido" : "bloqueado"],
                ]}
              />
              <ol className="mt-4 space-y-2">
                {Object.entries(data.steps).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2 text-sm">
                    {v === "DONE" ? <CheckCircle2 className="size-4 text-good" aria-hidden /> : v === "BLOCKED" ? <Lock className="size-4 text-critical" aria-hidden /> : <CircleDashed className="size-4 text-muted" aria-hidden />}
                    <span className="flex-1">{STEP[k] ?? k}</span>
                    <span className="text-xs text-muted">{v === "DONE" ? "concluído" : v === "BLOCKED" ? "bloqueado" : "pendente"}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <div className="space-y-4 xl:col-span-2">
              {!data.commercialOnboarding.allowed ? (
                <Notice tone="warning">
                  Produção sem credenciais de parceiro: o onboarding de outras empresas está bloqueado. Faltam: {data.commercialOnboarding.missing.join(", ")}.
                </Notice>
              ) : null}
              {data.pricingDemoOnly ? <Notice tone="warning">Só há rate cards DEMO. Importe o rate card oficial em Admin › Preços antes de usar custos reais.</Notice> : null}
              {data.notes.map((n) => (
                <Notice key={n}>{n}</Notice>
              ))}
            </div>
          </div>

          <Card title="1. Modo MOCK (desenvolvimento)" subtitle="Simula a Cloud API: envios, status sent/delivered/read/failed, atrasos e webhooks assinados. Nenhuma mensagem real é enviada.">
            <Button onClick={() => mock.run(() => api("onboarding/mock", { method: "POST", body: {} }).then(reload), "Conta MOCK conectada.")} loading={mock.busy}>
              Conectar conta MOCK
            </Button>
            {mock.done ? <div className="mt-3"><Notice tone="good">{mock.done}</Notice></div> : null}
            {mock.error ? <div className="mt-3"><ErrorBox error={mock.error} /></div> : null}
          </Card>

          <Card title="2. Conexão manual (sua própria WABA)" subtitle="Para a própria empresa: WABA ID, Phone Number ID e um token de System User com as permissões whatsapp_business_messaging e whatsapp_business_management. O token é validado na Meta e armazenado criptografado.">
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                void manual.run(() => api("onboarding/manual", { body: m }).then(reload), "WABA conectada e webhook inscrito.");
              }}
              className="grid grid-cols-1 gap-3 md:grid-cols-3"
            >
              <Field label="Nome da empresa"><Input value={m.businessName} onChange={(x) => setM({ ...m, businessName: x.target.value })} required /></Field>
              <Field label="WABA ID"><Input value={m.wabaId} onChange={(x) => setM({ ...m, wabaId: x.target.value })} required /></Field>
              <Field label="Phone Number ID"><Input value={m.phoneNumberId} onChange={(x) => setM({ ...m, phoneNumberId: x.target.value })} required /></Field>
              <Field label="Access token (System User)" className="md:col-span-2"><Input type="password" autoComplete="off" value={m.accessToken} onChange={(x) => setM({ ...m, accessToken: x.target.value })} required /></Field>
              <Field label="Fuso da WABA"><Input value={m.timezone} onChange={(x) => setM({ ...m, timezone: x.target.value })} /></Field>
              <div className="md:col-span-3">
                <Button type="submit" variant="primary" loading={manual.busy}>Validar e conectar</Button>
              </div>
            </form>
            {manual.done ? <div className="mt-3"><Notice tone="good">{manual.done}</Notice></div> : null}
            {manual.error ? <div className="mt-3"><ErrorBox error={manual.error} title="Conexão recusada" /></div> : null}
          </Card>

          <Card title="3. Embedded Signup (clientes do SaaS)" subtitle="Fluxo oficial da Meta para que cada cliente conecte a própria WABA. Exige app Tech Provider/Solution Partner, configuração de Embedded Signup e acesso avançado aprovado.">
            {data.embeddedSignup ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* Full page load (not <Link>): the route's own CSP, which allows Meta's SDK, applies only to a fresh document. */}
                <a href="/admin/providers/embedded-signup" className="inline-flex items-center rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                  Conectar com o Facebook
                </a>
                <span className="text-xs text-muted">
                  App {data.embeddedSignup.appId} · config {data.embeddedSignup.configId} · Graph {data.embeddedSignup.graphApiVersion}
                </span>
              </div>
            ) : (
              <Notice tone="warning">Não configurado: defina META_PARTNER_TYPE, META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID e META_GRAPH_API_VERSION (ver docs/SETUP-META.md).</Notice>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
