"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

interface Retention {
  retentionDays: number;
  auditRetentionDays: number;
  rawWebhookRetentionDays: number;
  payloadRetentionDays: number;
}

function useOp() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [out, setOut] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      setOut(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, out, run };
}

export default function PrivacyPage() {
  const { data, error, loading, reload } = useApi<Retention>("privacy/retention");
  const [r, setR] = useState<Retention | null>(null);
  useEffect(() => setR(data), [data]);
  const save = useOp();
  const exp = useOp();
  const del = useOp();
  const consent = useOp();
  const [phone, setPhone] = useState("");
  const [confirm, setConfirm] = useState("");
  const [c, setC] = useState({ customer: "", type: "OPT_OUT", scope: "MARKETING" });

  const download = (obj: unknown) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "export-titular.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader title="Privacidade (LGPD)" description="Retenção, exportação e eliminação de dados do titular, consentimento e opt-out. Telefones são armazenados criptografados e identificados por hash; logs nunca contêm o número completo nem o conteúdo das mensagens." />
      <div className="space-y-6">
        {error ? <ErrorBox error={error} /> : null}
        {loading && !r ? <Loading /> : null}
        {r ? (
          <Card title="Retenção de dados" subtitle="Aplicada diariamente pelo worker (job de retenção)">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label="Dados de mensagens (dias)">
                <Select value={r.retentionDays} onChange={(e) => setR({ ...r, retentionDays: Number(e.target.value) })}>
                  {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
              <Field label="Conteúdo/payload (dias)"><Input value={r.payloadRetentionDays} onChange={(e) => setR({ ...r, payloadRetentionDays: Number(e.target.value) })} /></Field>
              <Field label="Webhooks brutos (dias)"><Input value={r.rawWebhookRetentionDays} onChange={(e) => setR({ ...r, rawWebhookRetentionDays: Number(e.target.value) })} /></Field>
              <Field label="Auditoria (dias)"><Input value={r.auditRetentionDays} onChange={(e) => setR({ ...r, auditRetentionDays: Number(e.target.value) })} /></Field>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" loading={save.busy} onClick={() => save.run(() => api("privacy/retention", { method: "PUT", body: r }).then(reload))}>Salvar retenção</Button>
              {save.out ? <span className="text-xs text-good">Salvo e auditado.</span> : null}
            </div>
            {save.error ? <div className="mt-3"><ErrorBox error={save.error} /></div> : null}
          </Card>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Direitos do titular" subtitle="Exportação (acesso/portabilidade) e eliminação">
            <div className="space-y-3">
              <Field label="Telefone do titular (E.164)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5511999999999" /></Field>
              <div className="flex flex-wrap gap-2">
                <Button loading={exp.busy} disabled={phone.length < 8} onClick={() => exp.run(() => api("privacy/export", { body: { customer: phone } }).then((o) => { download(o); return o; }))}>
                  Exportar dados (JSON)
                </Button>
              </div>
              {exp.out ? <Notice tone="good">Exportação gerada e baixada.</Notice> : null}
              {exp.error ? <ErrorBox error={exp.error} /> : null}
              <div className="border-t border-line pt-3">
                <Field label='Para eliminar, digite "ELIMINAR"'><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
                <Button className="mt-2" variant="danger" loading={del.busy} disabled={confirm !== "ELIMINAR" || phone.length < 8} onClick={() => del.run(() => api("privacy/delete", { body: { customer: phone } }))}>
                  Eliminar dados do titular
                </Button>
                {del.out ? <div className="mt-2"><Notice tone="good">Dados pessoais eliminados (telefone, conteúdo e payloads). Registros agregados e de auditoria permanecem sem identificação.</Notice></div> : null}
                {del.error ? <div className="mt-2"><ErrorBox error={del.error} /></div> : null}
              </div>
            </div>
          </Card>
          <Card title="Consentimento e opt-out" subtitle="Opt-out total bloqueia qualquer envio; opt-out de marketing bloqueia apenas Marketing">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Telefone"><Input value={c.customer} onChange={(e) => setC({ ...c, customer: e.target.value })} /></Field>
              <Field label="Tipo">
                <Select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}>
                  <option value="OPT_IN">Opt-in</option>
                  <option value="OPT_OUT">Opt-out</option>
                </Select>
              </Field>
              <Field label="Escopo">
                <Select value={c.scope} onChange={(e) => setC({ ...c, scope: e.target.value })}>
                  <option value="ALL">Todas as mensagens</option>
                  <option value="MARKETING">Somente marketing</option>
                </Select>
              </Field>
            </div>
            <Button className="mt-3" loading={consent.busy} disabled={c.customer.length < 8} onClick={() => consent.run(() => api("privacy/consent", { body: { ...c, source: "dashboard" } }))}>
              Registrar
            </Button>
            {consent.out ? <div className="mt-3"><Notice tone="good">Consentimento registrado com data, origem e escopo.</Notice></div> : null}
            {consent.error ? <div className="mt-3"><ErrorBox error={consent.error} /></div> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
