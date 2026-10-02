"use client";

import { useState } from "react";
import { Badge, Button, Card, DemoBadge, ErrorBox, Field, Input, Loading, Notice, PageHeader, Table, Textarea } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { dateTime, int, money } from "@/lib/format";

interface Pricing {
  policies: Array<{
    id: string;
    name: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
    status: string;
    sourceUrl: string;
    sourceCheckedAt: string;
    sourceHash: string;
    notes: string | null;
    sources: Array<{ id: string; url: string; excerpt: string }>;
    rules: Array<{ market: string; category: string; billable: boolean; freeEligibility: string[]; freeQuota: number | null; freeQuotaScope: string | null; tiered: boolean; requiresCustomerServiceWindow: boolean; customerServiceWindowHours: number; freeEntryPointWindowHours: number }>;
  }>;
  rateCards: Array<{ id: string; name: string; currency: string; effectiveFrom: string; effectiveUntil: string | null; status: string; isDemo: boolean; sourceUrl: string; sourceDocument: string; checksum: string; importedAt: string; rows: Array<{ market: string; category: string; tierStart: number; tierEnd: number | null; unitRate: string }> }>;
  disclaimer: string;
}

interface ImportResult {
  ok: boolean;
  format: string;
  rows: number;
  tiers: number;
  checksum: string;
  issues: Array<{ row?: number; message: string }>;
  currency: string | null;
  saved: boolean;
  id?: string;
}

function ImportCard({ onSaved }: { onSaved: () => void }) {
  const [content, setContent] = useState("");
  const [tiers, setTiers] = useState("");
  const [meta, setMeta] = useState({ name: "", currency: "BRL", effectiveFrom: "", sourceUrl: "", sourceDocument: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { content, dryRun };
      if (tiers.trim()) body.tiersContent = tiers;
      for (const [k, v] of Object.entries(meta)) if (v.trim()) body[k] = v.trim();
      const r = await api<ImportResult>("pricing/import", { body });
      setResult(r);
      if (r.saved) onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };
  const file = (setter: (v: string) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setter(await f.text());
  };
  return (
    <Card title="Importar rate card" subtitle="CSV (formato longo ou largo) ou JSON, a partir dos arquivos oficiais da Meta. Não existe API de preços: a importação é administrativa e versionada.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Rate card (CSV/JSON)">
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={file(setContent)} className="mb-2 block text-xs text-ink-2" aria-label="Arquivo do rate card" />
            <Textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder={"market,currency,category,tier_start,tier_end,unit_rate\nBR,BRL,UTILITY,1,10000,0.0400"} />
          </Field>
          <Field label="Tiers de volume (CSV longo, opcional)">
            <input type="file" accept=".csv,text/csv" onChange={file(setTiers)} className="mb-2 block text-xs text-ink-2" aria-label="Arquivo de tiers" />
            <Textarea rows={3} value={tiers} onChange={(e) => setTiers(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome"><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="Meta BRL 2026-10" /></Field>
            <Field label="Moeda"><Input value={meta.currency} onChange={(e) => setMeta({ ...meta, currency: e.target.value.toUpperCase() })} /></Field>
            <Field label="Vigente a partir de"><Input type="date" value={meta.effectiveFrom} onChange={(e) => setMeta({ ...meta, effectiveFrom: e.target.value })} /></Field>
            <Field label="Documento de origem"><Input value={meta.sourceDocument} onChange={(e) => setMeta({ ...meta, sourceDocument: e.target.value })} placeholder="Rate card CSV (BRL)" /></Field>
            <Field label="URL da fonte oficial" className="col-span-2"><Input value={meta.sourceUrl} onChange={(e) => setMeta({ ...meta, sourceUrl: e.target.value })} placeholder="https://developers.facebook.com/…" /></Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run(true)} loading={busy} disabled={!content.trim()}>Validar (dry run)</Button>
            <Button variant="primary" onClick={() => run(false)} loading={busy} disabled={!content.trim()}>Importar</Button>
          </div>
          {error ? <ErrorBox error={error} title="Importação rejeitada" /> : null}
          {result ? (
            <Notice tone={result.ok ? "good" : "warning"}>
              <p>
                {result.ok ? (result.saved ? "Rate card importado." : "Arquivo válido (nada foi salvo).") : "Arquivo com problemas — nada foi salvo."} Formato {result.format}, {int(result.rows)} linhas, {int(result.tiers)} faixas, moeda {result.currency ?? "—"}.
              </p>
              <p className="mt-1 font-mono text-[11px]">sha256 {result.checksum}</p>
              {result.issues.length ? (
                <ul className="mt-2 list-disc pl-4 text-xs">
                  {result.issues.slice(0, 20).map((i, k) => (
                    <li key={k}>{i.row !== undefined ? `linha ${i.row}: ` : ""}{i.message}</li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default function PricingPage() {
  const { data, error, loading, reload } = useApi<Pricing>("pricing");
  const [open, setOpen] = useState<string | null>(null);
  const retire = async (id: string) => {
    await api(`pricing/rate-cards/${id}`, { method: "PATCH", body: { status: "RETIRED" } });
    reload();
  };
  return (
    <>
      <PageHeader title="Preços" description="Políticas de preço versionadas (regras da Meta por data de vigência) e rate cards importados. Mudar uma política nunca recalcula faturas ou economias passadas." />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <Notice tone="warning">{data.disclaimer}</Notice>
          <Card title="Políticas de preço" subtitle="Cada regra cita a fonte oficial consultada; conflitos entre fontes estão em docs/KNOWN-CONFLICTS.md" padded={false}>
            <ul>
              {data.policies.map((p) => (
                <li key={p.id} className="border-b border-line px-5 py-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-semibold">{p.id}</code>
                    <Badge tone={p.status === "ACTIVE" ? "good" : p.status === "UNVERIFIED" ? "warning" : "neutral"}>{p.status === "UNVERIFIED" ? "NÃO VERIFICADA (só what-if)" : p.status}</Badge>
                    <span className="text-xs text-ink-2">
                      {p.effectiveFrom} → {p.effectiveUntil ?? "em vigor"}
                    </span>
                    <Button variant="ghost" className="ml-auto h-7" onClick={() => setOpen(open === p.id ? null : p.id)}>
                      {open === p.id ? "Ocultar regras" : "Ver regras e fontes"}
                    </Button>
                  </div>
                  <p className="mt-1 text-sm text-ink">{p.name}</p>
                  {p.notes ? <p className="mt-1 text-xs text-ink-2">{p.notes}</p> : null}
                  {open === p.id ? (
                    <div className="mt-3 space-y-3">
                      <Table
                        dense
                        rows={p.rules}
                        rowKey={(r) => `${r.market}-${r.category}`}
                        columns={[
                          { key: "m", header: "Mercado", render: (r) => r.market },
                          { key: "c", header: "Categoria", render: (r) => r.category },
                          { key: "b", header: "Cobrável", render: (r) => (r.billable ? "sim" : "não") },
                          { key: "f", header: "Gratuidade", render: (r) => r.freeEligibility.join(", ") || "—" },
                          { key: "q", header: "Cota grátis", render: (r) => (r.freeQuota ? `${int(r.freeQuota)} / ${r.freeQuotaScope}` : "—") },
                          { key: "t", header: "Tiers", render: (r) => (r.tiered ? "sim" : "não") },
                          { key: "w", header: "Exige CSW", render: (r) => (r.requiresCustomerServiceWindow ? `sim (${r.customerServiceWindowHours}h)` : "não") },
                          { key: "e", header: "FEP", render: (r) => `${r.freeEntryPointWindowHours}h` },
                        ]}
                      />
                      <div className="space-y-2">
                        {p.sources.map((s) => (
                          <blockquote key={s.id} className="border-l-2 border-line pl-3 text-xs text-ink-2">
                            <span className="font-mono text-[11px] text-muted">{s.id}</span> “{s.excerpt}”{" "}
                            <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                              fonte
                            </a>
                          </blockquote>
                        ))}
                        <p className="font-mono text-[11px] text-muted">
                          verificado em {dateTime(p.sourceCheckedAt)} · sha256 {p.sourceHash.slice(0, 16)}…
                        </p>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Rate cards" padded={false}>
            <ul>
              {data.rateCards.map((c) => (
                <li key={c.id} className="border-b border-line px-5 py-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.isDemo ? <DemoBadge /> : null}
                    <Badge tone={c.status === "ACTIVE" ? "good" : "neutral"}>{c.status}</Badge>
                    <span className="text-xs text-ink-2">
                      {c.currency} · {c.effectiveFrom} → {c.effectiveUntil ?? "em vigor"} · {int(c.rows.length)} linhas
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Button variant="ghost" className="h-7" onClick={() => setOpen(open === c.id ? null : c.id)}>
                        {open === c.id ? "Ocultar" : "Ver tarifas"}
                      </Button>
                      {c.status === "ACTIVE" ? (
                        <Button variant="danger" className="h-7" onClick={() => retire(c.id)}>
                          Aposentar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {c.sourceDocument} · importado em {dateTime(c.importedAt)} · sha256 {c.checksum.slice(0, 16)}…
                  </p>
                  {open === c.id ? (
                    <div className="mt-3 max-h-96 overflow-y-auto">
                      <Table
                        dense
                        rows={c.rows}
                        rowKey={(r) => `${r.market}-${r.category}-${r.tierStart}`}
                        columns={[
                          { key: "m", header: "Mercado", render: (r) => r.market },
                          { key: "c", header: "Categoria", render: (r) => r.category },
                          { key: "t", header: "Faixa", render: (r) => `${int(r.tierStart)}–${r.tierEnd ? int(r.tierEnd) : "∞"}` },
                          { key: "r", header: "Tarifa", align: "right", render: (r) => money(r.unitRate, c.currency, 4) },
                        ]}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
          <ImportCard onSaved={reload} />
        </div>
      ) : null}
    </>
  );
}
