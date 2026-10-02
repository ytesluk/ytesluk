"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ConfidenceBadge, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, StatusBadge, Table, Textarea } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { STATUS_LABEL, dateTime, money, reason } from "@/lib/format";
import type { IntentRow } from "@/lib/types";

interface Page {
  items: IntentRow[];
  nextCursor: string | null;
}

const EXAMPLES: Record<string, { eventType: string; entityId: string; data: string; extra?: Record<string, unknown> }> = {
  "order.status": { eventType: "order.status", entityId: "ORD-1001", data: '{"orderId":"ORD-1001","status":"SHIPPED","statusLabel":"enviado","tracking":"BR123"}' },
  "payment.approved": { eventType: "payment.approved", entityId: "ORD-1001", data: '{"orderId":"ORD-1001","amount":"R$ 199,90"}' },
  "authentication.otp": { eventType: "authentication.otp", entityId: "login-42", data: '{"code":"481516"}' },
  "marketing.campaign": { eventType: "marketing.campaign", entityId: "black-friday", data: '{"offer":"10% na primeira compra"}' },
};

function NewIntent({ onCreated }: { onCreated: () => void }) {
  const [example, setExample] = useState("order.status");
  const [customer, setCustomer] = useState("+5511999990000");
  const [entityId, setEntityId] = useState(EXAMPLES["order.status"]!.entityId);
  const [data, setData] = useState(EXAMPLES["order.status"]!.data);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const e = EXAMPLES[example]!;
    setEntityId(e.entityId);
    setData(e.data);
  }, [example]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ intentId: string; status: string; idempotent: boolean }>("messages/intents", {
        body: { customer, eventType: EXAMPLES[example]!.eventType, entityId, data: JSON.parse(data), consent: { optIn: true, source: "dashboard-test" } },
      });
      setResult(`${r.idempotent ? "Intent já existente (idempotente)" : "Intent criada"}: ${r.intentId} · ${r.status}`);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Enviar evento de teste" subtitle="Cria uma MessageIntent como faria o sistema de origem (POST /api/v1/messages/intents). Em MOCK nenhuma mensagem real é enviada.">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Tipo de evento">
          <Select value={example} onChange={(e) => setExample(e.target.value)}>
            {Object.keys(EXAMPLES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cliente (E.164)">
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </Field>
        <Field label="Entidade (pedido, login…)">
          <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            Enviar evento
          </Button>
        </div>
        <Field label="Dados (JSON)" className="md:col-span-4">
          <Textarea rows={2} value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </form>
      {result ? (
        <div className="mt-3">
          <Notice tone="good">{result}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorBox error={error} title="Evento rejeitado" />
        </div>
      ) : null}
    </Card>
  );
}

export default function MessagesPage() {
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [items, setItems] = useState<IntentRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const qs = new URLSearchParams({ limit: "50", ...(status ? { status } : {}), ...(eventType ? { eventType } : {}) }).toString();
  const { data, error, loading, reload } = useApi<Page>(`messages?${qs}`);

  useEffect(() => {
    if (data) {
      setItems(data.items);
      setCursor(data.nextCursor);
    }
  }, [data]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    const p = await api<Page>(`messages?${qs}&cursor=${cursor}`);
    setItems((x) => [...x, ...p.items]);
    setCursor(p.nextCursor);
    setMore(false);
  };

  return (
    <>
      <PageHeader title="Mensagens" description="Cada evento recebido, a decisão do WCO e o custo estimado e realizado. Clique em uma linha para a auditoria completa." />
      <div className="space-y-6">
        <NewIntent onCreated={reload} />
        <Card
          title="Intents"
          padded={false}
          actions={
            <div className="flex flex-wrap gap-2">
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
                <option value="">Todos os status</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Input aria-label="Tipo de evento" placeholder="tipo de evento" value={eventType} onChange={(e) => setEventType(e.target.value)} className="w-44" />
              <Button onClick={reload}>Atualizar</Button>
            </div>
          }
        >
          {error ? (
            <div className="p-5">
              <ErrorBox error={error} />
            </div>
          ) : null}
          {loading && !items.length ? <Loading /> : null}
          <Table
            rows={items}
            rowKey={(r) => r.id}
            empty="Nenhuma mensagem com esses filtros."
            columns={[
              { key: "t", header: "Recebida", render: (r) => <span className="whitespace-nowrap text-xs text-ink-2">{dateTime(r.requestedAt)}</span> },
              {
                key: "e",
                header: "Evento",
                render: (r) => (
                  <Link href={`/messages/${r.id}`} className="hover:underline">
                    <code className="text-xs">{r.eventType}</code>
                    {r.entityId ? <span className="ml-1 text-xs text-muted">· {r.entityId}</span> : null}
                  </Link>
                ),
              },
              { key: "c", header: "Cliente", render: (r) => <span className="font-mono text-xs">{r.customer}</span> },
              { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} /> },
              { key: "d", header: "Decisão", render: (r) => <span className="text-xs text-ink-2">{r.decisionAction ? `${r.decisionAction} — ${reason((r.decisionReason ?? "").split(",")[0] ?? "")}` : "—"}</span> },
              { key: "cat", header: "Categoria", render: (r) => <span className="text-xs">{r.category ?? "—"}</span> },
              { key: "est", header: "Estimado", align: "right", render: (r) => money(r.estimatedCost, r.currency ?? "BRL", 4) },
              { key: "real", header: "Realizado", align: "right", render: (r) => (r.realizedCost !== null ? money(r.realizedCost, r.currency ?? "BRL", 4) : "—") },
              { key: "conf", header: "", render: (r) => <ConfidenceBadge value={r.realizedConfidence} /> },
            ]}
          />
          {cursor ? (
            <div className="border-t border-line p-3 text-center">
              <Button onClick={loadMore} loading={more}>
                Carregar mais
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
