"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";

interface Alert {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** Status colors always come with an icon and a text label — never color alone. */
const SEVERITY = {
  INFO: { icon: Info, label: "Informativo", color: "text-accent" },
  WARNING: { icon: AlertTriangle, label: "Atenção", color: "text-serious" },
  CRITICAL: { icon: OctagonAlert, label: "Crítico", color: "text-critical" },
} as const;

export default function AlertsPage() {
  const { data, error, loading, reload } = useApi<Alert[]>("alerts");
  const [busy, setBusy] = useState<string | null>(null);
  const ack = async (id: string) => {
    setBusy(id);
    try {
      await api(`alerts/${id}/ack`, { method: "POST", body: {} });
      reload();
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader title="Alertas" description="Custo acima do esperado, mudança de preço, falhas de webhook, categoria de template alterada pela Meta, uso alto de cota e outros eventos que pedem atenção." />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <Card padded={false}>
          {!data.length ? <Empty>Nenhum alerta. Os alertas são avaliados periodicamente pelo worker.</Empty> : null}
          <ul>
            {data.map((a) => {
              const s = SEVERITY[a.severity] ?? SEVERITY.INFO;
              return (
                <li key={a.id} className="flex items-start gap-3 border-b border-line px-5 py-4 last:border-0">
                  <s.icon className={`mt-0.5 size-4 shrink-0 ${s.color}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">{a.title}</p>
                      <Badge>{s.label}</Badge>
                      <Badge tone="info">{a.type}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{a.message}</p>
                    <p className="mt-1 text-xs text-muted">{dateTime(a.createdAt)}</p>
                  </div>
                  {a.acknowledgedAt ? (
                    <span className="flex items-center gap-1 text-xs text-good">
                      <CheckCircle2 className="size-3.5" aria-hidden /> reconhecido
                    </span>
                  ) : (
                    <Button onClick={() => ack(a.id)} loading={busy === a.id}>
                      Reconhecer
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
