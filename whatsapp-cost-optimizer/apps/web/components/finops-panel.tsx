"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Table } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { int, money } from "@/lib/format";
import type { FinOpsSummary } from "@/lib/types";

const STATUS_BADGE: Record<string, { label: string; tone: "good" | "warning" | "critical" | "neutral" }> = {
  DISPATCH: { label: "Enviado", tone: "good" },
  DEFERRED: { label: "Adiado (131049)", tone: "warning" },
  SUPPRESSED: { label: "Suprimido (131026)", tone: "critical" },
};

export function FinOpsPanel({ query }: { query: string }) {
  const [rev, setRev] = useState(0);
  const { data, error, loading } = useApi<FinOpsSummary>(`finops/summary?${query}&_r=${rev}`);

  const [groupKey, setGroupKey] = useState("order_updates");
  const [metaTemplateName, setMetaTemplateName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [priority, setPriority] = useState("1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);

  const addVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metaTemplateName.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await api("templates/mirrors", {
        body: {
          groupKey: groupKey.trim(),
          metaTemplateName: metaTemplateName.trim(),
          language: language.trim() || "pt_BR",
          category: "UTILITY",
          status: "APPROVED",
          priority: Math.max(1, Number(priority) || 1),
        },
      });
      setMetaTemplateName("");
      setRev((r) => r + 1);
    } catch (err) {
      setFormError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusy(false);
    }
  };

  const removeVariant = async (id: string) => {
    setBusy(true);
    try {
      await api(`templates/mirrors/${id}`, { method: "DELETE" });
      setRev((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  const usd = (v: number) => money(v, "USD", 4);

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h3 className="font-display text-[19px] font-semibold tracking-tight text-ink">Motor FinOps em Tempo Real (Ledger & Mirror Pool)</h3>
        <p className="text-sm text-ink-2">Decisões gravadas no FinOpsSavingsLedger, supressões globais (131026/131049), franquia mensal e failover de templates Utility.</p>
      </div>

      {error ? <ErrorBox error={error} /> : null}

      {data ? (
        <>
          <Card padded={false}>
            <div className="grid grid-cols-1 divide-y divide-dashed divide-[var(--rule)] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
              <div className="px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Economia Ledger (USD)</p>
                <p className="figure mt-1.5 text-2xl font-semibold text-ink">
                  <span className="marker">{usd(data.totals.totalSavingsUsd)}</span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  Meta {usd(data.totals.metaTariffSavingsUsd)} · BSP {usd(data.totals.avoidedBspFeeUsd)}
                </p>
              </div>

              <div className="px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Decisões FinOps</p>
                <p className="figure mt-1.5 text-2xl font-semibold text-ink">{int(data.totals.decisions)}</p>
                <p className="mt-1 text-xs text-muted">
                  {int(data.byStatus.DISPATCH ?? 0)} enviadas · {int(data.byStatus.DEFERRED ?? 0)} adiadas · {int(data.byStatus.SUPPRESSED ?? 0)} suprimidas
                </p>
              </div>

              <div className="px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Cache Global Ativo</p>
                <p className="figure mt-1.5 text-2xl font-semibold text-ink">{int(data.suppressions.activeTotal)}</p>
                <p className="mt-1 text-xs text-muted">
                  131026 inválidos: {int(data.suppressions.invalidRecipient131026)} · 131049 cap: {int(data.suppressions.marketingFrequencyCap131049)}
                </p>
              </div>

              <div className="px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Franquia Grátis (Mês)</p>
                {data.quotas.length ? (
                  <>
                    <p className="figure mt-1.5 text-2xl font-semibold text-ink">
                      {int(data.quotas[0]!.freeUsedCount)} / {int(data.quotas[0]!.freeLimit)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Restam {int(data.quotas[0]!.remaining)} conversas ({data.quotas[0]!.yearMonth})
                    </p>
                  </>
                ) : (
                  <>
                    <p className="figure mt-1.5 text-2xl font-semibold text-ink">0 / 1.000</p>
                    <p className="mt-1 text-xs text-muted">Nenhuma conversa contabilizada no mês</p>
                  </>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Estratégias FinOps aplicadas" subtitle="Contagem de acionamentos e economia acumulada por regra" padded={false}>
              <Table
                dense
                rows={data.strategies}
                rowKey={(r) => r.strategy}
                columns={[
                  { key: "s", header: "Estratégia", render: (r) => <code className="text-xs">{r.strategy}</code> },
                  { key: "c", header: "Acionamentos", align: "right", render: (r) => int(r.count) },
                  { key: "u", header: "Economia (USD)", align: "right", render: (r) => usd(r.savingsUsd) },
                ]}
              />
            </Card>

            <Card
              title="Pool de Templates Espelho (Mirror Failover)"
              subtitle="Quando a Meta reclassifica um template para MARKETING, o roteador assume automaticamente o próximo UTILITY aprovado do grupo"
            >
              <form onSubmit={addVariant} className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                <div className="sm:col-span-3">
                  <Field label="Grupo">
                    <Input value={groupKey} onChange={(e) => setGroupKey(e.target.value)} placeholder="order_updates" />
                  </Field>
                </div>
                <div className="sm:col-span-4">
                  <Field label="Template Meta">
                    <Input value={metaTemplateName} onChange={(e) => setMetaTemplateName(e.target.value)} placeholder="pedido_status_v2" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Idioma">
                    <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option value="pt_BR">pt_BR</option>
                      <option value="en_US">en_US</option>
                      <option value="es">es</option>
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="Prio">
                    <Input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
                  </Field>
                </div>
                <div className="flex items-end sm:col-span-2">
                  <Button type="submit" disabled={busy || !metaTemplateName.trim()}>
                    Adicionar
                  </Button>
                </div>
              </form>

              {formError ? <ErrorBox error={formError} /> : null}

              <Table
                dense
                rows={data.mirrorVariants}
                rowKey={(r) => r.id}
                columns={[
                  { key: "g", header: "Grupo", render: (r) => <code className="text-xs">{r.groupKey}</code> },
                  { key: "t", header: "Template", render: (r) => <span className="text-xs font-medium text-ink">{r.metaTemplateName}</span> },
                  {
                    key: "c",
                    header: "Categoria Meta",
                    render: (r) => <Badge tone={r.category === "UTILITY" ? "good" : "warning"}>{r.category}</Badge>,
                  },
                  { key: "p", header: "Prio", align: "right", render: (r) => r.priority },
                  {
                    key: "a",
                    header: "",
                    align: "right",
                    render: (r) => (
                      <button type="button" onClick={() => removeVariant(r.id)} className="text-xs text-muted underline hover:text-critical">
                        Remover
                      </button>
                    ),
                  },
                ]}
              />
            </Card>
          </div>

          <Card title="Últimas decisões do FinOps Ledger" subtitle="Auditoria sem armazenamento de texto da mensagem" padded={false}>
            <Table
              dense
              rows={data.recent}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "st",
                  header: "Status",
                  render: (r) => {
                    const b = STATUS_BADGE[r.status] ?? { label: r.status, tone: "neutral" as const };
                    return <Badge tone={b.tone}>{b.label}</Badge>;
                  },
                },
                { key: "m", header: "Modo", render: (r) => <code className="text-xs">{r.deliveryMode}</code> },
                { key: "tpl", header: "Template", render: (r) => <span className="text-xs text-ink-2">{r.selectedTemplateName ?? "—"}</span> },
                { key: "b", header: "Baseline", align: "right", render: (r) => usd(r.baselineTotalCostUsd) },
                { key: "f", header: "Final", align: "right", render: (r) => usd(r.finalTotalCostUsd) },
                { key: "e", header: "Economia", align: "right", render: (r) => usd(r.totalSavingsUsd) },
                { key: "s", header: "Estratégias", render: (r) => <span className="font-mono text-[11px] text-muted">{r.strategies.join(", ") || "—"}</span> },
              ]}
            />
          </Card>
        </>
      ) : loading ? (
        <p className="text-xs text-muted">Carregando métricas do motor FinOps…</p>
      ) : null}
    </div>
  );
}
