"use client";

import { useState } from "react";
import { Badge, Card, ErrorBox, Loading, Notice, PageHeader, Select, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";

interface WebhookEvent {
  id: string;
  provider: string;
  field: string | null;
  status: string;
  attempts: number;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  signatureValid: boolean;
  rawPurgedAt: string | null;
}

const TONE: Record<string, "good" | "info" | "warning" | "critical" | "neutral"> = { PROCESSED: "good", RECEIVED: "info", PROCESSING: "info", FAILED: "warning", DEAD: "critical", IGNORED: "neutral" };

export default function WebhooksPage() {
  const [status, setStatus] = useState("");
  const { data, error, loading } = useApi<WebhookEvent[]>(`webhooks/events?limit=200${status ? `&status=${status}` : ""}`, { refreshMs: 15_000 });
  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Recebimento da Meta: assinatura X-Hub-Signature-256 validada → evento bruto persistido → ACK 200 → fila → processamento idempotente, com retentativas e dead-letter queue (DEAD)."
        actions={
          <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">Todos</option>
            {Object.keys(TONE).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
      <div className="space-y-6">
        <Notice>Endpoint: <code>POST /api/v1/webhooks/meta</code> (verificação: <code>GET</code> com hub.challenge). Payloads brutos são removidos conforme a retenção configurada em Privacidade.</Notice>
        {error ? <ErrorBox error={error} /> : null}
        {loading && !data ? <Loading /> : null}
        {data ? (
          <Card padded={false}>
            <Table
              rows={data}
              rowKey={(w) => w.id}
              empty="Nenhum webhook recebido."
              columns={[
                { key: "r", header: "Recebido", render: (w) => <span className="whitespace-nowrap text-xs">{dateTime(w.receivedAt)}</span> },
                { key: "f", header: "Campo", render: (w) => <code className="text-xs">{w.field ?? "—"}</code> },
                { key: "s", header: "Status", render: (w) => <Badge tone={TONE[w.status] ?? "neutral"}>{w.status}</Badge> },
                { key: "a", header: "Tentativas", align: "right", render: (w) => w.attempts },
                { key: "sig", header: "Assinatura", render: (w) => (w.signatureValid ? <Badge tone="good">válida</Badge> : <Badge tone="critical">inválida</Badge>) },
                { key: "p", header: "Processado", render: (w) => <span className="text-xs">{dateTime(w.processedAt)}</span> },
                { key: "raw", header: "Payload", render: (w) => <span className="text-xs text-muted">{w.rawPurgedAt ? "removido" : "retido"}</span> },
                { key: "e", header: "Erro", render: (w) => <span className="text-xs text-critical">{w.error ?? ""}</span> },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
