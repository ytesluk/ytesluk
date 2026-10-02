"use client";

import { Card, ErrorBox, Kpi, Loading, PageHeader, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { int, pct } from "@/lib/format";

interface Ops {
  window: string;
  queues: Array<{ queue: string; waiting: number; delayed: number; active: number; failed: number; completed: number }>;
  throughputPerMinute: number;
  errorRate: number;
  metaApiLatencyMs: number | null;
  attempts: Record<string, number>;
  webhooks: Record<string, number>;
}

const QUEUE: Record<string, string> = {
  "wco-optimize": "Otimização",
  "wco-flush": "Flush de buffer",
  "wco-dispatch": "Envio (provedor)",
  "wco-webhook": "Processamento de webhooks",
  "wco-mock-emit": "Webhooks simulados (MOCK)",
  "wco-maintenance": "Manutenção (rollup, alertas, retenção)",
  "wco-dead-letter": "Dead-letter queue",
};

export default function ObservabilityPage() {
  const { data, error, loading } = useApi<Ops>("observability", { refreshMs: 10_000 });
  return (
    <>
      <PageHeader title="Observabilidade" description="Filas, throughput, taxa de erro e latência da API do provedor. Métricas Prometheus completas em /api/v1/metrics (API) e :9100/metrics (worker)." />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Throughput" value={`${data.throughputPerMinute.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/min`} hint={data.window} />
            <Kpi label="Taxa de erro de envio" value={pct(data.errorRate * 100, 2)} hint={data.window} />
            <Kpi label="Latência do provedor (média)" value={data.metaApiLatencyMs !== null ? `${int(data.metaApiLatencyMs)} ms` : "—"} />
            <Kpi label="Webhooks processados" value={int(data.webhooks.PROCESSED ?? 0)} hint={`${int(data.webhooks.FAILED ?? 0)} com falha · ${int(data.webhooks.DEAD ?? 0)} na DLQ`} />
          </div>
          <Card title="Filas (BullMQ)" subtitle="Atualiza a cada 10 s" padded={false}>
            <Table
              rows={data.queues}
              rowKey={(q) => q.queue}
              columns={[
                { key: "q", header: "Fila", render: (q) => <span>{QUEUE[q.queue] ?? q.queue} <code className="ml-1 text-[11px] text-muted">{q.queue}</code></span> },
                { key: "w", header: "Aguardando", align: "right", render: (q) => int(q.waiting) },
                { key: "d", header: "Agendadas", align: "right", render: (q) => int(q.delayed) },
                { key: "a", header: "Ativas", align: "right", render: (q) => int(q.active) },
                { key: "f", header: "Falhas", align: "right", render: (q) => <span className={q.failed ? "text-critical" : undefined}>{int(q.failed)}</span> },
                { key: "c", header: "Concluídas (retidas)", align: "right", render: (q) => int(q.completed) },
              ]}
            />
          </Card>
          <Card title="Tentativas de envio por status" subtitle={data.window} padded={false}>
            <Table
              rows={Object.entries(data.attempts)}
              rowKey={([k]) => k}
              columns={[
                { key: "s", header: "Status", render: ([k]) => k },
                { key: "n", header: "Tentativas", align: "right", render: ([, v]) => int(v) },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
