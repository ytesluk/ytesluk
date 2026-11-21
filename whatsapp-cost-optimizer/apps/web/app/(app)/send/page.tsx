"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Select } from "@/components/ui";
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
  body: string | null;
  components: Array<{ type: string; text?: string; params?: string[] }>;
}

interface BulkResult {
  accepted: number;
  duplicates: number;
  failed: Array<{ line: number; error: string }>;
}

const MAX = 1000;

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
              {v || `{{${m[1]}}}`}
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
  const approved = useMemo(() => (templates.data ?? []).filter((t) => t.status === "APPROVED" && !t.name.startsWith("wco_juntar_")), [templates.data]);
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
  const ready = !!template && valid.length > 0 && valid.length <= MAX && missing.length === 0 && consent && connected;

  const send = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    setResult(null);
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
              <strong className="text-ink">1. Escolha a mensagem.</strong> Só aparecem modelos já aprovados pela Meta para a sua empresa.
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
          {templates.error ? <ErrorBox error={templates.error} /> : null}
          {templates.loading && !templates.data ? <Loading /> : null}
          {templates.data && approved.length === 0 ? (
            <Notice>
              Você ainda não tem modelos aprovados. Crie no Gerenciador do WhatsApp da Meta: quando forem aprovados, aparecem aqui sozinhos.
            </Notice>
          ) : null}

          {approved.length ? (
            <div className="space-y-6">
              <div>
                <label htmlFor="send-template" className="block text-sm font-medium text-ink">
                  1. Mensagem
                </label>
                <Select
                  id="send-template"
                  value={chosen}
                  onChange={(e) => {
                    setChosen(e.target.value);
                    setValues({});
                    setResult(null);
                  }}
                >
                  <option value="">Escolha um modelo aprovado</option>
                  {approved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>

              {template ? (
                <div className="space-y-3">
                  {params.length ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {params.map((p) => (
                        <div key={p}>
                          <label htmlFor={`param-${p}`} className="block text-xs font-medium text-ink-2">
                            Preencha <code className="text-ink">{`{{${p}}}`}</code>
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
                      <Preview text={template.body ?? template.components.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? ""} values={values} />
                    </div>
                    {params.length ? <p className="mt-2 text-xs text-muted">O mesmo texto vai para todos os números desta lista.</p> : null}
                  </div>
                </div>
              ) : null}

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

              <Button variant="primary" onClick={() => void send()} loading={busy} disabled={!ready}>
                {valid.length ? `Enviar para ${valid.length} cliente${valid.length === 1 ? "" : "s"}` : "Enviar"}
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
