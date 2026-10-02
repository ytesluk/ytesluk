"use client";

import { useState } from "react";
import { Card, ErrorBox, Input, Loading, PageHeader, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";

interface AuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  requestId: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const { data, error, loading } = useApi<AuditRow[]>(`audit?limit=200${entityType ? `&entityType=${encodeURIComponent(entityType)}` : ""}`);
  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Criação, alteração, envio, cancelamento, otimização, mudança de preço e de política, importações, integrações e erros — com ator, entidade e request-id. Dados pessoais aparecem mascarados."
        actions={<Input aria-label="Tipo de entidade" placeholder="tipo de entidade (ex.: OptimizationPolicy)" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-72" />}
      />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <Card padded={false}>
          <Table
            dense
            rows={data}
            rowKey={(r) => r.id}
            empty="Nenhum registro."
            columns={[
              { key: "t", header: "Quando", render: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.createdAt)}</span> },
              { key: "a", header: "Ação", render: (r) => <code className="text-xs">{r.action}</code> },
              { key: "who", header: "Ator", render: (r) => <span className="text-xs">{r.actorType}{r.actorId ? ` · ${r.actorId.slice(-8)}` : ""}</span> },
              { key: "e", header: "Entidade", render: (r) => <span className="text-xs">{r.entityType ?? "—"}{r.entityId ? ` · ${r.entityId.slice(-8)}` : ""}</span> },
              { key: "d", header: "Dados", render: (r) => <span className="break-all font-mono text-[11px] text-ink-2">{r.data ? JSON.stringify(r.data).slice(0, 240) : ""}</span> },
              { key: "rid", header: "Request", render: (r) => <span className="font-mono text-[11px] text-muted">{r.requestId?.slice(0, 8) ?? ""}</span> },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
