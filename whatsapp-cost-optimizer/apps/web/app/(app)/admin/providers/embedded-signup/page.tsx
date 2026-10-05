"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

/**
 * Embedded Signup (Meta's official onboarding for a Tech Provider's business customers), following
 * Meta's implementation guide: the JavaScript SDK opens the flow with FB.login({ config_id,
 * response_type: "code", override_default_response_type: true, extras: { setup: {} } }); the
 * callback returns an exchangeable code (TTL ~30 s) and a WA_EMBEDDED_SIGNUP message event returns
 * the customer's WABA / phone number / business portfolio IDs. Both go straight to the API, which
 * exchanges the code, subscribes webhooks and registers the number server-to-server.
 *
 * This route has its own CSP (next.config.ts) allowing connect.facebook.net; the rest of the
 * dashboard does not load third-party scripts.
 */

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FbSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

interface Status {
  embeddedSignup: { appId: string; configId: string; graphApiVersion: string } | null;
  commercialOnboarding: { allowed: boolean; missing: string[] };
}
interface Me {
  tenant: { name: string };
}
interface SessionInfo {
  waba_id?: string;
  phone_number_id?: string;
  business_id?: string;
}
type Phase = "idle" | "flow" | "completing" | "done" | "failed";

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SESSION_INFO_WAIT_MS = 6_000;

/** Only messages from facebook.com or its subdomains are accepted (stricter than a suffix match). */
function fromFacebook(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

/** Screen names Meta reports when the customer abandons the flow (subset, for friendlier text). */
const STEP_LABEL: Record<string, string> = {
  PHONE_NUMBER_SETUP: "cadastro do número",
  PHONE_NUMBER_VERIFICATION: "verificação do número",
  WABA_SETUP: "criação da conta do WhatsApp Business",
  BUSINESS_ACCOUNT_SELECTION: "escolha do portfólio empresarial",
};

export default function EmbeddedSignupPage() {
  const status = useApi<Status>("onboarding");
  const me = useApi<Me>("auth/me");
  const cfg = status.data?.embeddedSignup ?? null;

  const [sdkReady, setSdkReady] = useState(false);
  const [pin, setPin] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ pricingSnapshot?: { rateCard: string | null; isDemo: boolean | null } } | null>(null);

  const code = useRef<string | null>(null);
  const session = useRef<SessionInfo | null>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef(false);
  const form = useRef({ pin, businessName });
  form.current = { pin, businessName };

  useEffect(() => {
    if (me.data && !businessName) setBusinessName(me.data.tenant.name);
  }, [me.data, businessName]);

  // Load and initialise the SDK once the app configuration is known.
  useEffect(() => {
    if (!cfg) return;
    const init = () => {
      window.FB?.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: true, version: cfg.graphApiVersion });
      setSdkReady(true);
    };
    if (window.FB) {
      init();
      return;
    }
    window.fbAsyncInit = init;
    if (!document.querySelector(`script[src="${SDK_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SDK_SRC;
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.onerror = () => setMessage("Não foi possível carregar o SDK da Meta (bloqueador de anúncios, rede ou CSP).");
      document.body.appendChild(s);
    }
  }, [cfg]);

  const fail = useCallback((text: string) => {
    if (waitTimer.current) clearTimeout(waitTimer.current);
    setMessage(text);
    setPhase("failed");
  }, []);

  /** Posts code + IDs as soon as both have arrived (the code expires in ~30 seconds). */
  const tryComplete = useCallback(async () => {
    if (submitted.current || !code.current || !session.current) return;
    const { waba_id, phone_number_id, business_id } = session.current;
    if (!waba_id || !phone_number_id) return fail("A Meta não devolveu o número de telefone. Conclua o fluxo escolhendo um número para a Cloud API.");
    submitted.current = true;
    if (waitTimer.current) clearTimeout(waitTimer.current);
    setPhase("completing");
    try {
      const r = await api<{ pricingSnapshot?: { rateCard: string | null; isDemo: boolean | null } }>("onboarding/embedded-signup", {
        body: {
          code: code.current,
          wabaId: waba_id,
          phoneNumberId: phone_number_id,
          ...(business_id ? { metaBusinessId: business_id } : {}),
          pin: form.current.pin,
          businessName: form.current.businessName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        },
      });
      setResult(r);
      setPhase("done");
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      setPhase("failed");
    }
  }, [fail]);

  // Session-info events from the Embedded Signup popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!fromFacebook(event.origin)) return;
      let data: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      const d = data.data ?? {};
      if (data.event === "FINISH") {
        session.current = { waba_id: d.waba_id as string, phone_number_id: d.phone_number_id as string, business_id: d.business_id as string | undefined };
        void tryComplete();
      } else if (data.event === "CANCEL") {
        if (d.error_message) fail(`A Meta informou um erro: ${String(d.error_message)}${d.error_code ? ` (código ${String(d.error_code)}, sessão ${String(d.session_id ?? "?")})` : ""}.`);
        else fail(`Fluxo interrompido${d.current_step ? ` na etapa “${STEP_LABEL[String(d.current_step)] ?? String(d.current_step)}”` : ""}. Nada foi conectado.`);
      } else if (data.event === "ERROR") {
        fail("A Meta reportou um erro no fluxo. Tente novamente.");
      } else if (typeof data.event === "string" && data.event.startsWith("FINISH")) {
        // FINISH_ONLY_WABA, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, …: no Cloud API number to register.
        fail(`Fluxo concluído sem número para a Cloud API (${data.event}). O WCO precisa de um número registrado na Cloud API.`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [tryComplete, fail]);

  const launch = () => {
    if (!cfg || !window.FB) return;
    code.current = null;
    session.current = null;
    submitted.current = false;
    setError(null);
    setMessage(null);
    setPhase("flow");
    window.FB.login(
      (response) => {
        const c = response.authResponse?.code;
        if (!c) return fail("Janela fechada antes de concluir. Nada foi conectado.");
        code.current = c;
        void tryComplete();
        if (!session.current) waitTimer.current = setTimeout(() => !submitted.current && fail("A Meta não enviou os IDs da conta (evento WA_EMBEDDED_SIGNUP). Verifique se este domínio está em “Allowed domains” do app."), SESSION_INFO_WAIT_MS);
      },
      { config_id: cfg.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
    );
  };

  const pinOk = /^\d{6}$/.test(pin);

  return (
    <>
      <PageHeader title="Conectar WhatsApp com a Meta" description="Fluxo oficial (Embedded Signup): você entra com a sua conta do Facebook, escolhe ou cria a conta do WhatsApp Business e o número, e autoriza o WCO a enviar mensagens em nome da sua empresa." />
      {status.error ? <ErrorBox error={status.error} /> : null}
      {status.loading && !status.data ? <Loading /> : null}
      {status.data && !cfg ? (
        <Card>
          <Notice tone="warning">
            Embedded Signup não está configurado neste servidor. O operador do SaaS precisa ser Tech Provider da Meta e definir META_PARTNER_TYPE, META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID e META_GRAPH_API_VERSION (docs/SETUP-META.md).
          </Notice>
          <p className="mt-3 text-sm">
            <Link href="/admin/providers" className="font-medium text-accent hover:underline">
              Voltar para Conectar WhatsApp
            </Link>
          </p>
        </Card>
      ) : null}
      {cfg ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card title="1. Antes de abrir a Meta" className="xl:col-span-2">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Nome da empresa">
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
              </Field>
              <Field label="PIN de verificação em duas etapas" hint="6 dígitos, escolhidos por você. Guarde-o: a Meta pede esse PIN se o número for registrado de novo.">
                <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="off" required />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={launch} disabled={!sdkReady || !pinOk || !businessName || phase === "flow" || phase === "completing" || phase === "done"} loading={phase === "flow" || phase === "completing"}>
                Continuar com o Facebook
              </Button>
              {!sdkReady ? <span className="text-xs text-muted">Carregando o SDK da Meta…</span> : null}
              {phase === "flow" ? <span className="text-xs text-muted">Conclua o fluxo na janela da Meta.</span> : null}
              {phase === "completing" ? <span className="text-xs text-muted">Registrando o número e inscrevendo webhooks…</span> : null}
            </div>
            <div className="mt-4 space-y-3">
              {phase === "done" ? (
                <Notice tone="good">
                  WhatsApp conectado. Último passo, feito por você na Meta: adicione uma forma de pagamento no{" "}
                  <a className="font-medium underline" href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noreferrer">
                    WhatsApp Manager
                  </a>{" "}
                  — segundo a Meta, o onboarding só fica completo depois disso.
                  {result?.pricingSnapshot?.isDemo ? " Atenção: os custos ainda usam o rate card DEMO." : ""}
                </Notice>
              ) : null}
              {message ? <Notice tone="warning">{message}</Notice> : null}
              {error ? <ErrorBox error={error} title="A conexão foi recusada" /> : null}
            </div>
          </Card>
          <Card title="O que acontece" className="xl:col-span-1">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
              <li>A Meta abre uma janela própria; o WCO não vê sua senha do Facebook.</li>
              <li>Você escolhe o portfólio, a conta do WhatsApp Business e o número.</li>
              <li>O WCO troca o código por um token da empresa (guardado criptografado), inscreve os webhooks e registra o número na Cloud API.</li>
              <li>A cobrança das mensagens continua sendo feita pela Meta, na sua forma de pagamento.</li>
            </ol>
          </Card>
        </div>
      ) : null}
    </>
  );
}
