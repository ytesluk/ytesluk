"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

interface Policy {
  id: string;
  eventType: string;
  maxDelaySeconds: number;
  debounceSeconds: number;
  allowAggregation: boolean;
  allowSupersession: boolean;
  allowDeduplication: boolean;
  dedupWindowSeconds: number;
  priority: string;
  requiresImmediateDelivery: boolean;
  supersessionGroup: string | null;
  consolidationTemplate: string | null;
  defaultTemplate: string | null;
  defaultLanguage: string;
  category: string | null;
  allowFreeFormInWindow: boolean;
  maxConsolidatedItems: number;
  enabled: boolean;
}

interface Data {
  policies: Policy[];
  ruleSets: Array<{ id: string; name: string; rules: unknown; active: boolean; updatedAt: string }>;
}

const seconds = (s: number) => (s === 0 ? "—" : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const yes = (b: boolean) => (b ? <Badge tone="good">sim</Badge> : <span className="text-xs text-muted">não</span>);

function Editor({ initial, onSaved, onCancel }: { initial: Policy; onSaved: () => void; onCancel: () => void }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id: _id, ...body } = p;
      void _id;
      await api("optimization/policies", { body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };
  const n = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  const b = (k: keyof Policy) => (e: React.ChangeEvent<HTMLSelectElement>) => setP({ ...p, [k]: e.target.value === "true" });
  const t = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value || null });
  return (
    <Card title={`Editar política: ${p.eventType}`} subtitle="OTP, autenticação, fraude, segurança, mensagens críticas e mustSendImmediately nunca são atrasados, independentemente desta configuração.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Tipo de evento"><Input value={p.eventType} onChange={(e) => setP({ ...p, eventType: e.target.value })} /></Field>
        <Field label="Atraso máximo (s)"><Input value={p.maxDelaySeconds} onChange={n("maxDelaySeconds")} inputMode="numeric" /></Field>
        <Field label="Debounce (s)"><Input value={p.debounceSeconds} onChange={n("debounceSeconds")} inputMode="numeric" /></Field>
        <Field label="Janela de deduplicação (s)"><Input value={p.dedupWindowSeconds} onChange={n("dedupWindowSeconds")} inputMode="numeric" /></Field>
        <Field label="Deduplicação"><Select value={String(p.allowDeduplication)} onChange={b("allowDeduplication")}><option value="true">sim</option><option value="false">não</option></Select></Field>
        <Field label="Supersession"><Select value={String(p.allowSupersession)} onChange={b("allowSupersession")}><option value="true">sim</option><option value="false">não</option></Select></Field>
        <Field label="Consolidação"><Select value={String(p.allowAggregation)} onChange={b("allowAggregation")}><option value="true">sim</option><option value="false">não</option></Select></Field>
        <Field label="Entrega imediata obrigatória"><Select value={String(p.requiresImmediateDelivery)} onChange={b("requiresImmediateDelivery")}><option value="true">sim</option><option value="false">não</option></Select></Field>
        <Field label="Grupo de supersession"><Input value={p.supersessionGroup ?? ""} onChange={t("supersessionGroup")} /></Field>
        <Field label="Template de consolidação" hint="Precisa estar aprovado pela Meta"><Input value={p.consolidationTemplate ?? ""} onChange={t("consolidationTemplate")} /></Field>
        <Field label="Template padrão"><Input value={p.defaultTemplate ?? ""} onChange={t("defaultTemplate")} /></Field>
        <Field label="Categoria declarada">
          <Select value={p.category ?? ""} onChange={(e) => setP({ ...p, category: e.target.value || null })}>
            <option value="">(do template)</option>
            <option>MARKETING</option>
            <option>UTILITY</option>
            <option>AUTHENTICATION</option>
            <option>SERVICE</option>
          </Select>
        </Field>
        <Field label="Prioridade">
          <Select value={p.priority} onChange={(e) => setP({ ...p, priority: e.target.value })}>
            {["LOW", "NORMAL", "HIGH", "CRITICAL"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label="Mensagem livre na janela" hint="Só Utility; nunca converte Marketing"><Select value={String(p.allowFreeFormInWindow)} onChange={b("allowFreeFormInWindow")}><option value="true">sim</option><option value="false">não</option></Select></Field>
        <Field label="Máx. itens consolidados"><Input value={p.maxConsolidatedItems} onChange={n("maxConsolidatedItems")} inputMode="numeric" /></Field>
        <Field label="Ativa"><Select value={String(p.enabled)} onChange={b("enabled")}><option value="true">sim</option><option value="false">não</option></Select></Field>
      </div>
      {error ? <div className="mt-3"><ErrorBox error={error} title="Política rejeitada" /></div> : null}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save} loading={busy}>Salvar (auditado)</Button>
        <Button onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function RuleSetEditor({ initial, onSaved }: { initial: unknown; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [ok, setOk] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await api("optimization/rules", { method: "PUT", body: JSON.parse(text) });
      setOk(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Regras declarativas (PolicyEngine)" subtitle="A primeira regra que casa decide. Invariantes de segurança (opt-out, OTP, críticas) são aplicadas antes e não podem ser desligadas.">
      <Textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error ? <div className="mt-3"><ErrorBox error={error} title="Conjunto de regras inválido" /></div> : null}
      {ok ? <div className="mt-3"><Notice tone="good">Regras salvas e auditadas.</Notice></div> : null}
      <div className="mt-3">
        <Button onClick={save} loading={busy}>Validar e salvar</Button>
      </div>
    </Card>
  );
}

export default function PoliciesPage() {
  const { data, error, loading, reload } = useApi<Data>("optimization/policies");
  const [editing, setEditing] = useState<Policy | null>(null);
  const blank: Policy = { id: "", eventType: "", maxDelaySeconds: 60, debounceSeconds: 30, allowAggregation: false, allowSupersession: false, allowDeduplication: true, dedupWindowSeconds: 86400, priority: "NORMAL", requiresImmediateDelivery: false, supersessionGroup: null, consolidationTemplate: null, defaultTemplate: null, defaultLanguage: "pt_BR", category: null, allowFreeFormInWindow: false, maxConsolidatedItems: 10, enabled: true };
  return (
    <>
      <PageHeader title="Políticas de otimização" description="Quanto cada tipo de evento pode esperar e quais técnicas podem ser aplicadas. Toda alteração é registrada na auditoria." actions={<Button onClick={() => setEditing(blank)}>Nova política</Button>} />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      <div className="space-y-6">
        {editing ? (
          <Editor
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        ) : null}
        {data ? (
          <>
            <Card title="Por tipo de evento" padded={false}>
              <Table
                rows={data.policies}
                rowKey={(p) => p.id}
                columns={[
                  { key: "e", header: "Evento", render: (p) => <code className="text-xs">{p.eventType}</code> },
                  { key: "c", header: "Categoria", render: (p) => <span className="text-xs">{p.category ?? "—"}</span> },
                  { key: "pr", header: "Prioridade", render: (p) => <span className="text-xs">{p.priority}</span> },
                  { key: "m", header: "Atraso máx.", align: "right", render: (p) => seconds(p.maxDelaySeconds) },
                  { key: "db", header: "Debounce", align: "right", render: (p) => seconds(p.debounceSeconds) },
                  { key: "d", header: "Dedup", render: (p) => yes(p.allowDeduplication) },
                  { key: "s", header: "Supersession", render: (p) => yes(p.allowSupersession) },
                  { key: "a", header: "Consolidação", render: (p) => yes(p.allowAggregation) },
                  { key: "i", header: "Imediata", render: (p) => yes(p.requiresImmediateDelivery) },
                  { key: "t", header: "Template", render: (p) => <span className="text-xs">{p.defaultTemplate ?? "—"}</span> },
                  { key: "x", header: "", render: (p) => <Button variant="ghost" className="h-7" onClick={() => setEditing(p)}>Editar</Button> },
                ]}
              />
            </Card>
            {data.ruleSets[0] ? <RuleSetEditor initial={data.ruleSets[0].rules} onSaved={reload} /> : null}
          </>
        ) : null}
      </div>
    </>
  );
}
