"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, ErrorBox, Loading, Notice, PageHeader } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

/**
 * "Enviar mensagens": for companies without a system of their own (or that send through a paid
 * platform today). They pick an approved template, fill its variables, paste the numbers and send.
 * Each number becomes an intent, so every saving of the WCO applies on its own.
 */

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  declaredCategory: string;
  metaCategory: string | null;
  consolidationParam: string | null;
  body: string | null;
  components: Array<{ type: string; text?: string; params?: string[] }>;
}

interface BulkResult {
  accepted: number;
  duplicates: number;
  failed: Array<{ line: number; error: string }>;
}

/** The company's own text: Meta approves it first, the WCO sends it on approval. */
interface DraftResult {
  template: { status: string; category: string };
  customers: number;
  sent: number;
  invalidLines: number[];
}

interface Pending {
  id: string;
  text: string | null;
  templateStatus: string | null;
  customers: number;
  createdAt: string;
}

const MAX = 1000;

/** What each kind of template is for, in the company's words (the category Meta assigned decides the price). */
const KIND: Record<string, { label: string; hint: string }> = {
  UTILITY: { label: "Aviso", hint: "pedidos, agenda, pagamentos" },
  MARKETING: { label: "Promoção", hint: "ofertas e campanhas · custa mais" },
};
const kindOf = (t: Template) => t.metaCategory ?? t.declaredCategory;

/** Friendly names for the variables most templates use; anything else is shown as it is. */
const FIELD: Record<string, string> = {
  orderId: "Número do pedido",
  statusLabel: "Situação do pedido",
  status: "Situação",
  amount: "Valor",
  tracking: "Código de rastreio",
  date: "Data",
  time: "Horário",
  product: "Produto",
  offer: "Oferta",
  items: "Itens",
  merchant: "Loja",
  event: "O que aconteceu",
  name: "Nome",
  first_name: "Nome",
  updates: "Novidades",
  atualizacoes: "Novidades",
};
const fieldName = (p: string) => FIELD[p] ?? (/^\d+$/.test(p) ? `Espaço ${p}` : p.replace(/_/g, " "));
const bodyOf = (t: Template) => t.body ?? t.components.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";

/** "(11) 98888-7777" → "+5511988887777"; numbers already with + stay as they are. */
function toPhone(line: string): string | null {
  const raw = line.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : "";
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
  return "";
}

function paramsOf(t: Template): string[] {
  const body = t.components.find((c) => c.type?.toUpperCase() === "BODY");
  if (body?.params?.length) return body.params;
  return [...new Set([...(t.body ?? body?.text ?? "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]!))];
}

function Preview({ text, values }: { text: string; values: Record<string, string> }) {
  const parts = text.split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g);
  return (
    <div className="rounded-2xl bg-surface-2 p-4">
      <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#d9fdd3] px-3 py-2 text-[13px] leading-snug text-[#111b21]">
        {parts.map((p, i) => {
          const m = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(p);
          if (!m) return <span key={i}>{p}</span>;
          const v = values[m[1]!];
          return (
            <span key={i} className={v ? "rounded bg-[#fff3a3] px-0.5" : "rounded bg-[#ffd7d3] px-0.5"}>
              {v || fieldName(m[1]!)}
            </span>
          );
        })}
      </p>
    </div>
  );
}

export default function SendPage() {
  const templates = useApi<Template[]>("templates");
  const onboarding = useApi<{ steps: Record<string, string> }>("onboarding");
  // Verification codes are never sent to a list, and combined messages (joining) are the WCO's own.
  const approved = useMemo(() => (templates.data ?? []).filter((t) => t.status === "APPROVED" && !t.consolidationParam && !t.name.startsWith("wco_juntar_") && kindOf(t) in KIND), [templates.data]);
  const pending = useApi<Pending[]>("messages/pending", { refreshMs: 20_000 });
  const [mode, setMode] = useState<"write" | "approved">("write");
  const [draftText, setDraftText] = useState("");
  const [drafted, setDrafted] = useState<DraftResult | null>(null);
  const [chosen, setChosen] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [numbers, setNumbers] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const template = approved.find((t) => t.id === chosen) ?? null;
  const params = template ? paramsOf(template) : [];
  const lines = numbers.split(/[\n,;]+/).map(toPhone).filter((p): p is string => p !== null);
  const valid = lines.filter(Boolean);
  const invalid = lines.length - valid.length;
  const missing = params.filter((p) => !values[p]?.trim());
  const connected = onboarding.data ? onboarding.data.steps.PHONE_NUMBER === "DONE" : true;
  const draftOk = !!draftText.trim() && !/\{\{|\}\}/.test(draftText);
  const ready = (mode === "write" ? draftOk : !!template && missing.length === 0) && valid.length > 0 && valid.length <= MAX && consent && connected;

  const send = async () => {
    if (mode === "write") {
      setBusy(true);
      setError(null);
      setResult(null);
      setDrafted(null);
      try {
        const r = await api<DraftResult>("messages/draft", { body: { text: draftText.trim(), customers: valid, consent: { optIn: true, source: "painel" } } });
        setDrafted(r);
        setDraftText("");
        setNumbers("");
        setConsent(false);
        pending.reload();
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!template) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setDrafted(null);
    try {
      const data = Object.fromEntries(params.map((p) => [p, values[p]!.trim()]));
      const r = await api<BulkResult>("messages/bulk", { body: { template: { name: template.name, language: template.language }, data, customers: valid, consent: { optIn: true, source: "painel" } } });
      setResult(r);
      if (r.accepted > 0) {
        setNumbers("");
        setConsent(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Enviar mensagens" description="Mande avisos e campanhas para os seus clientes pelo WCO. Ele escolhe sozinho o jeito mais barato de entregar cada mensagem." />

      <div className="max-w-3xl space-y-6">
        <Card title="Como funciona">
          <ol className="space-y-2 text-sm leading-relaxed text-ink-2">
            <li>
              <strong className="text-ink">1. Escreva a mensagem</strong>, ou use uma que a Meta já aprovou.
            </li>
            <li>
              <strong className="text-ink">2. Cole os números</strong> dos clientes, um por linha.
            </li>
            <li>
              <strong className="text-ink">3. O WCO envia</strong> pelo número da sua empresa: se o cliente conversou com você nas últimas 24 horas, a mensagem pode ir como conversa, que é grátis; números que não recebem WhatsApp são pulados. A economia aparece na Visão geral.
            </li>
          </ol>
        </Card>

        {!connected ? (
          <Notice tone="warning">
            Primeiro, <Link href="/admin/providers" className="font-medium text-ink underline underline-offset-2">conecte o WhatsApp da empresa</Link>.
          </Notice>
        ) : null}

        <Card title="Nova mensagem">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-line p-0.5 text-sm" role="tablist" aria-label="Como montar a mensagem">
              {(
                [
                  ["write", "Escrever uma mensagem"],
                  ["approved", "Usar uma já aprovada"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => {
                    setMode(id);
                    setResult(null);
                    setDrafted(null);
                  }}
                  className={`rounded-full px-4 py-1.5 font-medium transition ${mode === id ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "write" ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="send-draft" className="block text-sm font-medium text-ink">
                    1. Escreva a mensagem
                  </label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    A Meta aprova todo texto novo antes do envio (costuma levar de minutos a algumas horas). O WCO envia sozinho assim que ela aprovar. Textos com cara de promoção são cobrados como marketing, que é mais caro.
                  </p>
                  <textarea
                    id="send-draft"
                    rows={4}
                    maxLength={1024}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder="Ex.: Olá! Sua encomenda já pode ser retirada na loja do centro, de segunda a sábado, das 9h às 18h."
                    className="mt-2 w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-[var(--accent)]"
                  />
                  {/\{\{|\}\}/.test(draftText) ? <p className="mt-1 text-xs text-serious">Tire as chaves {"{{ }}"}: escreva o texto como o cliente vai ler.</p> : null}
                </div>
                {draftText.trim() ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Como o cliente vai receber</p>
                    <div className="mt-2">
                      <Preview text={draftText.trim()} values={{}} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
              {templates.data && approved.length === 0 ? (
                <Notice>Você ainda não tem mensagens aprovadas. Escreva uma em “Escrever uma mensagem”: depois que a Meta aprovar, ela aparece aqui para usar de novo.</Notice>
              ) : null}
              {templates.error ? <ErrorBox error={templates.error} /> : null}
              {templates.loading && !templates.data ? <Loading /> : null}
              {approved.length ? (
              <div>
                <p id="send-template" className="text-sm font-medium text-ink">
                  1. Escolha a mensagem
                </p>
                <p className="mt-0.5 text-xs text-muted">Estes são os textos que a Meta já aprovou para a sua empresa. Os espaços em destaque você preenche no próximo passo.</p>
                <div role="radiogroup" aria-labelledby="send-template" className="mt-3 space-y-4">
                  {Object.entries(KIND).map(([kind, k]) => {
                    const list = approved.filter((t) => kindOf(t) === kind);
                    if (!list.length) return null;
                    return (
                      <div key={kind}>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">
                          {k.label === "Aviso" ? "Avisos" : "Promoções"} <span className="normal-case tracking-normal">· {k.hint}</span>
                        </p>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {list.map((t) => {
                            const on = t.id === chosen;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                aria-label={`${k.label}: ${bodyOf(t)} (${t.name})`}
                                onClick={() => {
                                  setChosen(t.id);
                                  setValues({});
                                  setResult(null);
                                }}
                                className={`rounded-xl border p-3 text-left transition ${on ? "border-[var(--accent)] bg-surface ring-2 ring-[var(--accent)]/25" : "border-line bg-surface hover:border-[var(--accent)]"}`}
                              >
                                <span className="block text-[13px] leading-snug text-ink">
                                  {bodyOf(t)
                                    .split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g)
                                    .map((part, i) => {
                                      const m = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(part);
                                      return m ? (
                                        <span key={i} className="rounded bg-[#fff3a3] px-0.5 text-[#111b21]">
                                          {fieldName(m[1]!)}
                                        </span>
                                      ) : (
                                        <span key={i}>{part}</span>
                                      );
                                    })}
                                </span>
                                <span className="mt-1.5 block font-mono text-[10.5px] text-muted">{t.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              ) : null}
              {template ? (
                <div className="space-y-3">
                  {params.length ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {params.map((p) => (
                        <div key={p}>
                          <label htmlFor={`param-${p}`} className="block text-xs font-medium text-ink-2">
                            {fieldName(p)}
                          </label>
                          <input
                            id={`param-${p}`}
                            value={values[p] ?? ""}
                            onChange={(e) => setValues({ ...values, [p]: e.target.value })}
                            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[var(--accent)]"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Como o cliente vai receber</p>
                    <div className="mt-2">
                      <Preview text={bodyOf(template)} values={values} />
                    </div>
                    {params.length ? <p className="mt-2 text-xs text-muted">O mesmo texto vai para todos os números desta lista.</p> : null}
                  </div>
                </div>
              ) : null}
              </>
            )}

              <div>
                <label htmlFor="send-numbers" className="block text-sm font-medium text-ink">
                  2. Para quem
                </label>
                <p className="mt-0.5 text-xs text-muted">Um número por linha. Pode colar uma coluna do Excel. Números do Brasil sem o +55 também valem.</p>
                <textarea
                  id="send-numbers"
                  rows={6}
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                  placeholder={"(11) 98888-7777\n11 97777-6666\n+55 21 99999-0000"}
                  className="mt-2 w-full rounded-xl border border-line bg-surface px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-[var(--accent)]"
                />
                <p className="mt-1 text-xs text-ink-2">
                  {valid.length} número{valid.length === 1 ? "" : "s"} válido{valid.length === 1 ? "" : "s"}
                  {invalid ? <span className="text-serious"> · {invalid} linha{invalid > 1 ? "s" : ""} não parece{invalid > 1 ? "m" : ""} número</span> : null}
                  {valid.length > MAX ? <span className="text-serious"> · no máximo {MAX} por envio</span> : null}
                </p>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-ink-2">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>Essas pessoas autorizaram receber mensagens da minha empresa pelo WhatsApp.</span>
              </label>

              {error ? <ErrorBox error={error} title="O envio não foi feito" /> : null}
              {result ? (
                <div className="space-y-2">
                  {result.accepted ? (
                    <Notice tone="good">
                      <strong>{result.accepted} mensage{result.accepted === 1 ? "m" : "ns"} a caminho.</strong> Acompanhe a economia na{" "}
                      <Link href="/" className="font-medium underline underline-offset-2">Visão geral</Link>.
                      {result.duplicates ? ` ${result.duplicates} número${result.duplicates > 1 ? "s" : ""} repetido${result.duplicates > 1 ? "s" : ""} foi${result.duplicates > 1 ? "ram" : ""} enviado${result.duplicates > 1 ? "s" : ""} uma vez só.` : ""}
                    </Notice>
                  ) : null}
                  {result.failed.length ? (
                    <Notice tone="warning">
                      {result.failed.length} não {result.failed.length > 1 ? "foram enviadas" : "foi enviada"}:{" "}
                      {result.failed
                        .slice(0, 5)
                        .map((f) => `linha ${f.line} (${f.error})`)
                        .join("; ")}
                      {result.failed.length > 5 ? "…" : ""}
                    </Notice>
                  ) : null}
                </div>
              ) : null}

              {drafted ? (
                drafted.sent ? (
                  <Notice tone="good">
                    <strong>A Meta aprovou e {drafted.sent} mensage{drafted.sent === 1 ? "m foi enviada" : "ns foram enviadas"}.</strong> Acompanhe a economia na{" "}
                    <Link href="/" className="font-medium underline underline-offset-2">Visão geral</Link>.
                  </Notice>
                ) : drafted.template.status === "REJECTED" ? (
                  <Notice tone="warning">A Meta não aprovou este texto. Ajuste e tente de novo.</Notice>
                ) : (
                  <Notice tone="good">
                    <strong>Enviada para a Meta aprovar.</strong> Assim que ela aprovar, o WCO envia sozinho para {drafted.customers} cliente{drafted.customers === 1 ? "" : "s"}.
                  </Notice>
                )
              ) : null}

              <Button variant="primary" onClick={() => void send()} loading={busy} disabled={!ready}>
                {mode === "write"
                  ? valid.length
                    ? `Pedir aprovação e enviar para ${valid.length} cliente${valid.length === 1 ? "" : "s"}`
                    : "Pedir aprovação e enviar"
                  : valid.length
                    ? `Enviar para ${valid.length} cliente${valid.length === 1 ? "" : "s"}`
                    : "Enviar"}
              </Button>
          </div>
        </Card>

        {pending.data?.length ? (
          <Card title="Esperando aprovação da Meta" subtitle="Saem sozinhas assim que a Meta aprovar. Se ela recusar, nada é enviado e você recebe um alerta.">
            <ul className="divide-y divide-dashed divide-[var(--rule)]">
              {pending.data.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <span className="line-clamp-2 text-ink-2">{p.text ?? "—"}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {p.customers} cliente{p.customers === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
