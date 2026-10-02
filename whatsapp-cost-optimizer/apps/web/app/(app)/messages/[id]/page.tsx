"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, ConfidenceBadge, ErrorBox, KeyValue, Loading, PageHeader, StatusBadge, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { STATUS_LABEL, dateTime, money, reason } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any -- audit payload is a wide, read-only document */
type Audit = {
  intent: any;
  decisions: any[];
  costs: any[];
  attempts: any[];
  savings: any[];
  events: any[];
  consolidatedInto: any | null;
  policies: any[];
  why: {
    whySent: string[] | null;
    whyDelayed: string[] | null;
    whyConsolidated: string[] | null;
    whyFree: string[] | null;
    whyCharged: string[] | null;
    whyCategory: string[] | null;
    pricingPolicy: string | null;
    rateCard: string | null;
    tier: string | null;
  };
};

const COST_KIND: Record<string, string> = { BASELINE: "Sem WCO (contrafactual)", OPTIMIZED: "Decisão do WCO", REALIZED: "Confirmado pela Meta", SIMULATED: "Simulado" };

function Why({ title, items }: { title: string; items: string[] | null | undefined }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-ink-2">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink">
        {items.map((i, k) => (
          <li key={k}>{reason(i)}</li>
        ))}
      </ul>
    </div>
  );
}

export default function MessageAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useApi<Audit>(`messages/${id}`);
  const i = data?.intent;
  const c = i?.currency ?? "BRL";

  return (
    <>
      <Link href="/messages" className="mb-3 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Mensagens
      </Link>
      <PageHeader
        title="Auditoria da mensagem"
        description={i ? <span className="font-mono text-xs">{i.id}</span> : null}
        actions={i ? <StatusBadge status={i.status} label={STATUS_LABEL[i.status]} /> : null}
      />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && i ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title="Por quê?" subtitle="Explicação da decisão, do preço e da categoria" className="xl:col-span-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Why title="Por que foi enviada" items={data.why.whySent} />
                <Why title="Por que foi atrasada / agendada" items={data.why.whyDelayed} />
                <Why title="Por que foi consolidada / substituída" items={data.why.whyConsolidated} />
                <Why title="Por que foi gratuita" items={data.why.whyFree} />
                <Why title="Por que foi cobrada" items={data.why.whyCharged} />
                <Why title="Por que esta categoria" items={data.why.whyCategory} />
              </div>
              <div className="mt-5">
                <KeyValue
                  items={[
                    ["Política de preço", data.why.pricingPolicy ?? "—"],
                    ["Rate card", data.why.rateCard ?? "—"],
                    ["Tier", data.why.tier ?? "—"],
                    ["Mercado (destinatário)", i.market ?? "—"],
                  ]}
                />
              </div>
              <p className="mt-3 text-[11px] text-muted">A categoria final de cada template é determinada pela Meta.</p>
            </Card>
            <Card title="Custo">
              <KeyValue
                cols={1}
                items={[
                  ["Sem WCO (estimado)", money(i.baselineCost, c, 4)],
                  ["Estimado pelo WCO", money(i.estimatedCost, c, 4)],
                  ["Realizado", i.realizedCost !== null ? money(i.realizedCost, c, 4) : "—"],
                  ["Confiança", <ConfidenceBadge key="c" value={i.realizedConfidence} />],
                ]}
              />
              {data.savings.length ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-ink-2">Economia registrada</p>
                  {data.savings.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink-2">
                        {s.kind} · {s.mechanism}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular">{money(s.savings, s.currency, 4)}</span>
                        <ConfidenceBadge value={s.confidence} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          </div>

          <Card title="Intent">
            <KeyValue
              items={[
                ["Evento", <code key="e">{i.eventType}</code>],
                ["Entidade", i.businessEntityId ?? "—"],
                ["Cliente", <span key="c" className="font-mono">{i.customer?.phoneMasked ?? "—"}</span>],
                ["Prioridade", i.priority],
                ["Categoria", i.category ?? "—"],
                ["Tipo", i.messageKind],
                ["Template", i.templateName ?? "—"],
                ["Idempotency key", <span key="k" className="font-mono text-xs">{i.idempotencyKey ?? "—"}</span>],
                ["Ocorrido em", dateTime(i.occurredAt)],
                ["Recebido em", dateTime(i.requestedAt)],
                ["Não antes de", dateTime(i.earliestSendAt)],
                ["Prazo máximo", dateTime(i.deadlineAt)],
                ["Agendado para", dateTime(i.scheduledFor)],
                ["Enviado / entregue", `${dateTime(i.sentAt)} / ${dateTime(i.deliveredAt)}`],
                ["Substituída por", i.supersededById ? <Link key="s" className="underline" href={`/messages/${i.supersededById}`}>{i.supersededById.slice(-8)}</Link> : "—"],
                ["Duplicata de", i.duplicateOfId ? <Link key="d" className="underline" href={`/messages/${i.duplicateOfId}`}>{i.duplicateOfId.slice(-8)}</Link> : "—"],
                ["Consolidada em", i.consolidatedIntoId ? <Link key="c2" className="underline" href={`/messages/${i.consolidatedIntoId}`}>{i.consolidatedIntoId.slice(-8)}</Link> : "—"],
                ["Payload", i.payloadPurgedAt ? `removido em ${dateTime(i.payloadPurgedAt)} (retenção)` : "retido"],
              ]}
            />
          </Card>

          <Card title="Decisões de otimização" padded={false}>
            <Table
              rows={data.decisions}
              rowKey={(d) => d.id}
              columns={[
                { key: "t", header: "Quando", render: (d) => <span className="text-xs">{dateTime(d.createdAt)}</span> },
                { key: "a", header: "Ação", render: (d) => <Badge tone="info">{d.action}</Badge> },
                { key: "r", header: "Motivos", render: (d) => <span className="text-xs">{(d.reasons as string[]).map(reason).join(" · ")}</span> },
                { key: "s", header: "Enviar em", render: (d) => <span className="text-xs">{dateTime(d.sendAt)}</span> },
                { key: "e", header: "Economia estimada", align: "right", render: (d) => money(d.estimatedSavings, d.currency, 4) },
                { key: "v", header: "Regras", render: (d) => <span className="font-mono text-[11px] text-muted">{d.rulesetVersion}</span> },
              ]}
            />
          </Card>

          <Card title="Decisões de custo" subtitle="Cada avaliação registra a política e o rate card usados (histórico nunca é recalculado)" padded={false}>
            <Table
              rows={data.costs}
              rowKey={(d) => d.id}
              columns={[
                { key: "k", header: "Tipo", render: (d) => COST_KIND[d.kind] ?? d.kind },
                { key: "s", header: "Status", render: (d) => <Badge tone={d.pricingStatus === "PAID" ? "neutral" : d.pricingStatus === "UNKNOWN" ? "warning" : "good"}>{d.pricingStatus}</Badge> },
                { key: "r", header: "Motivo", render: (d) => <span className="text-xs">{reason(d.freeReason ?? d.decisionReason ?? "")}</span> },
                { key: "p", header: "Política", render: (d) => <span className="font-mono text-[11px]">{d.policyVersion ?? "—"}</span> },
                { key: "t", header: "Tier", render: (d) => <span className="text-xs">{d.tier ?? "—"}</span> },
                { key: "v", header: "Custo", align: "right", render: (d) => money(d.estimatedCost, d.currency, 4) },
                { key: "c", header: "", render: (d) => <ConfidenceBadge value={d.confidence} /> },
              ]}
            />
          </Card>

          <Card title="Tentativas de envio e status da Meta" padded={false}>
            <Table
              rows={data.attempts.flatMap((a) => [{ ...a, _row: "attempt" }, ...a.deliveries.map((d: any) => ({ ...d, _row: "delivery" }))])}
              rowKey={(r) => r.id}
              columns={[
                { key: "w", header: "Quando", render: (r) => <span className="text-xs">{dateTime(r._row === "attempt" ? r.requestedAt : r.occurredAt)}</span> },
                { key: "x", header: "Evento", render: (r) => (r._row === "attempt" ? <span className="text-sm">Tentativa #{r.attemptNumber} via {r.provider}</span> : <span className="pl-4 text-xs text-ink-2">webhook: {r.status}</span>) },
                { key: "id", header: "ID Meta", render: (r) => <span className="font-mono text-[11px] text-muted">{r.providerMessageId ?? "—"}</span> },
                {
                  key: "p",
                  header: "Pricing (Meta)",
                  render: (r) =>
                    r._row === "delivery" && (r.pricingType || r.pricingBillable !== null) ? (
                      <span className="text-xs">
                        {r.pricingCategory ?? "—"} · {r.pricingType ?? "—"} · {r.pricingBillable ? "cobrável" : "não cobrável"}
                      </span>
                    ) : r._row === "attempt" && r.errorMessage ? (
                      <span className="text-xs text-critical">{r.errorCode}: {r.errorMessage}</span>
                    ) : (
                      "—"
                    ),
                },
                { key: "c", header: "Cobre intents", align: "right", render: (r) => (r._row === "attempt" ? r.coveredIntentIds.length : "") },
              ]}
            />
          </Card>

          <Card title="Linha do tempo" padded={false}>
            <Table
              dense
              rows={data.events}
              rowKey={(e) => e.id}
              columns={[
                { key: "t", header: "Quando", render: (e) => <span className="whitespace-nowrap text-xs">{dateTime(e.occurredAt)}</span> },
                { key: "y", header: "Evento", render: (e) => <code className="text-xs">{e.type}</code> },
                { key: "d", header: "Dados", render: (e) => <span className="break-all font-mono text-[11px] text-ink-2">{e.data ? JSON.stringify(e.data) : ""}</span> },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
