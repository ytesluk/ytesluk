"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { dateTime, money, pct } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any -- analyzer output is rendered read-only */
interface Template {
  id: string;
  name: string;
  language: string;
  declaredCategory: string;
  metaCategory: string | null;
  previousCategory: string | null;
  status: string;
  components: Array<{ type: string; text?: string }>;
  updatedAt: string;
}

function NewTemplate({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ name: "", language: "pt_BR", declaredCategory: "UTILITY", body: "", bodyParams: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("templates", { body: { ...f, bodyParams: f.bodyParams.split(",").map((s) => s.trim()).filter(Boolean), status: "DRAFT" } });
      setF({ name: "", language: "pt_BR", declaredCategory: "UTILITY", body: "", bodyParams: "" });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Registrar template" subtitle="Registro local para análise de custo. A aprovação e a categoria final são da Meta (sincronizadas via webhook message_template_status_update / template_category_update).">
      <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="order_status_update" /></Field>
        <Field label="Idioma"><Input value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} /></Field>
        <Field label="Categoria declarada">
          <Select value={f.declaredCategory} onChange={(e) => setF({ ...f, declaredCategory: e.target.value })}>
            <option>UTILITY</option>
            <option>MARKETING</option>
            <option>AUTHENTICATION</option>
          </Select>
        </Field>
        <Field label="Parâmetros (separados por vírgula)"><Input value={f.bodyParams} onChange={(e) => setF({ ...f, bodyParams: e.target.value })} placeholder="orderId,status" /></Field>
        <Field label="Corpo" className="md:col-span-3"><Textarea rows={2} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Seu pedido {{orderId}} está {{status}}." /></Field>
        <div className="flex items-end"><Button type="submit" variant="primary" loading={busy} className="w-full">Salvar rascunho</Button></div>
      </form>
      {error ? <div className="mt-3"><ErrorBox error={error} title="Template rejeitado" /></div> : null}
    </Card>
  );
}

function Analysis({ id }: { id: string }) {
  const [res, setRes] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setRes(await api("templates/cost-analysis", { body: { templateId: id, monthlyVolume: 10000 } }));
    } finally {
      setBusy(false);
    }
  };
  const assistant = async () => setAi(await api(`templates/${id}/assistant`, { method: "POST", body: {} }));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button className="h-7" onClick={run} loading={busy}>Analisar custo</Button>
        <Button variant="ghost" className="h-7" onClick={assistant}>Assistente (IA)</Button>
      </div>
      {res ? (
        <div className="rounded-lg border border-line p-2 text-xs">
          <p>
            Categoria provável: <Badge tone="info">{res.analysis.category}</Badge> ({pct(res.analysis.classificationConfidence * 100, 0)}) · custo estimado 10 mil/mês: {money(res.estimatedMonthlyCost, "BRL")}
          </p>
          {res.alerts?.map((a: string) => (
            <p key={a} className="mt-1 text-serious">{a}</p>
          ))}
          <p className="mt-1 text-muted">{res.disclaimer}</p>
        </div>
      ) : null}
      {ai ? <p className="text-xs text-ink-2">{ai.message ?? JSON.stringify(ai)}</p> : null}
    </div>
  );
}

export default function TemplatesPage() {
  const { data, error, loading, reload } = useApi<Template[]>("templates");
  return (
    <>
      <PageHeader title="Templates" description="Categoria declarada × categoria atribuída pela Meta, e o impacto de custo. O WCO nunca sugere alterar o texto para mudar a categoria, nem converte Marketing em Utility." />
      <div className="space-y-6">
        <Notice>A categoria final é determinada pela Meta. Mudanças de categoria pela Meta geram alerta e passam a valer para o custo a partir da data informada no webhook.</Notice>
        <NewTemplate onSaved={reload} />
        {error ? <ErrorBox error={error} /> : null}
        {loading && !data ? <Loading /> : null}
        {data ? (
          <Card title="Templates" padded={false}>
            <Table
              rows={data}
              rowKey={(t) => t.id}
              columns={[
                { key: "n", header: "Nome", render: (t) => <code className="text-xs">{t.name}</code> },
                { key: "l", header: "Idioma", render: (t) => <span className="text-xs">{t.language}</span> },
                { key: "s", header: "Status", render: (t) => <Badge tone={t.status === "APPROVED" ? "good" : t.status === "REJECTED" ? "critical" : "neutral"}>{t.status}</Badge> },
                { key: "d", header: "Declarada", render: (t) => <span className="text-xs">{t.declaredCategory}</span> },
                {
                  key: "m",
                  header: "Meta",
                  render: (t) => (
                    <span className="text-xs">
                      {t.metaCategory ?? "—"}
                      {t.metaCategory && t.metaCategory !== t.declaredCategory ? <span className="ml-1"><Badge tone="warning">divergente</Badge></span> : null}
                      {t.previousCategory ? <span className="ml-1 text-muted">(antes {t.previousCategory})</span> : null}
                    </span>
                  ),
                },
                { key: "b", header: "Corpo", render: (t) => <span className="line-clamp-2 max-w-md text-xs text-ink-2">{t.components.find((c) => c.type === "BODY")?.text ?? "—"}</span> },
                { key: "u", header: "Atualizado", render: (t) => <span className="text-xs">{dateTime(t.updatedAt)}</span> },
                { key: "a", header: "", render: (t) => <Analysis id={t.id} /> },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
