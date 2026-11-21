"use client";

import { CheckCircle2, Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader } from "@/components/ui";
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
                      ? "Os envios da sua empresa já passam pelo WCO."
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

        </div>
      ) : null}
    </>
  );
}
