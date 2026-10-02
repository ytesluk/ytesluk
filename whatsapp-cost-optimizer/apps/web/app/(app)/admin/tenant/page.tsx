"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, Notice, PageHeader, Select, Table } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { dateTime, int, money } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any -- tenant document is rendered read-only */
interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function Settings({ tenant, onSaved }: { tenant: any; onSaved: () => void }) {
  const [f, setF] = useState({ name: tenant.name, requireOptIn: String(tenant.requireOptIn), usesBsp: String(tenant.usesBsp), bspType: tenant.bspFeeModel?.type ?? "NONE", bspValue: tenant.bspFeeModel?.percentOfMeta ?? tenant.bspFeeModel?.perMessage ?? tenant.bspFeeModel?.monthlyFee ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const bspFeeModel = f.bspType === "PERCENTAGE" ? { type: "PERCENTAGE", percentOfMeta: f.bspValue } : f.bspType === "FIXED_PER_MESSAGE" ? { type: "FIXED_PER_MESSAGE", perMessage: f.bspValue } : f.bspType === "MONTHLY" ? { type: "MONTHLY", monthlyFee: f.bspValue } : { type: "NONE" };
      await api("tenant", { method: "PATCH", body: { name: f.name, requireOptIn: f.requireOptIn === "true", usesBsp: f.usesBsp === "true", bspFeeModel } });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Configurações do tenant">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Exigir opt-in registrado" hint="Bloqueia templates para clientes sem opt-in">
          <Select value={f.requireOptIn} onChange={(e) => setF({ ...f, requireOptIn: e.target.value })}><option value="true">sim</option><option value="false">não</option></Select>
        </Field>
        <Field label="Opera via BSP">
          <Select value={f.usesBsp} onChange={(e) => setF({ ...f, usesBsp: e.target.value })}><option value="true">sim</option><option value="false">não (Cloud API direta)</option></Select>
        </Field>
        <Field label="Modelo de taxa do BSP">
          <Select value={f.bspType} onChange={(e) => setF({ ...f, bspType: e.target.value })}>
            <option value="NONE">Sem taxa</option>
            <option value="PERCENTAGE">% sobre a Meta</option>
            <option value="FIXED_PER_MESSAGE">Por mensagem</option>
            <option value="MONTHLY">Mensalidade</option>
          </Select>
        </Field>
        <Field label="Valor da taxa"><Input value={f.bspValue} onChange={(e) => setF({ ...f, bspValue: e.target.value })} /></Field>
      </div>
      {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
      <div className="mt-4"><Button variant="primary" onClick={save} loading={busy}>Salvar</Button></div>
    </Card>
  );
}

export default function TenantPage() {
  const tenant = useApi<any>("tenant");
  const users = useApi<User[]>("users");
  const keys = useApi<ApiKey[]>("api-keys");
  const me = useApi<{ actor: { platformAdmin?: boolean } }>("auth/me");
  const platform = useApi<any[]>(me.data?.actor.platformAdmin ? "admin/platform/tenants" : null);
  const [nu, setNu] = useState({ email: "", name: "", password: "", role: "ANALYST" });
  const [nk, setNk] = useState({ name: "", role: "OPERATOR" });
  const [created, setCreated] = useState<{ key: string; note: string } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api("users", { body: nu });
      setNu({ email: "", name: "", password: "", role: "ANALYST" });
      users.reload();
    } catch (x) {
      setErr(x instanceof ApiError ? x : new ApiError(0, String(x)));
    }
  };
  const addKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      setCreated(await api("api-keys", { body: nk }));
      setNk({ name: "", role: "OPERATOR" });
      keys.reload();
    } catch (x) {
      setErr(x instanceof ApiError ? x : new ApiError(0, String(x)));
    }
  };
  const revoke = async (id: string) => {
    await api(`api-keys/${id}`, { method: "DELETE" });
    keys.reload();
  };

  return (
    <>
      <PageHeader title="Tenant e acesso" description="Usuários (OWNER, ADMIN, ANALYST, OPERATOR), API keys para sistemas de origem e configurações do tenant." />
      <div className="space-y-6">
        {tenant.error ? <ErrorBox error={tenant.error} /> : null}
        {tenant.loading && !tenant.data ? <Loading /> : null}
        {tenant.data ? (
          <>
            <Card title={tenant.data.name} subtitle={`slug ${tenant.data.slug} · plano ${tenant.data.plan}`}>
              <KeyValue
                items={[
                  ["Moeda / fuso padrão", `${tenant.data.defaultCurrency} · ${tenant.data.defaultTimezone}`],
                  ["WABAs", tenant.data.wabas.map((w: any) => `${w.name} (${w.provider}, ${w.timezone}, ${w.currency})`).join("; ") || "—"],
                  ["Números", tenant.data.phones.map((p: any) => `${p.displayPhoneNumber}${p.isDefault ? " (padrão)" : ""}`).join("; ") || "—"],
                  ["Retenção de dados", `${tenant.data.retentionPolicy?.retentionDays ?? 90} dias`],
                ]}
              />
            </Card>
            <Settings tenant={tenant.data} onSaved={tenant.reload} />
          </>
        ) : null}
        {err ? <ErrorBox error={err} title="Operação recusada" /> : null}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Usuários" padded={false}>
            {users.data ? (
              <Table
                rows={users.data}
                rowKey={(u) => u.id}
                columns={[
                  { key: "e", header: "E-mail", render: (u) => u.email },
                  { key: "r", header: "Papel", render: (u) => <Badge tone="info">{u.role}</Badge> },
                  { key: "l", header: "Último login", render: (u) => <span className="text-xs">{dateTime(u.lastLoginAt)}</span> },
                ]}
              />
            ) : users.error ? <div className="p-5"><ErrorBox error={users.error} /></div> : <Loading />}
            <form onSubmit={addUser} className="grid grid-cols-2 gap-3 border-t border-line p-5">
              <Field label="E-mail"><Input type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} required /></Field>
              <Field label="Nome"><Input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} required /></Field>
              <Field label="Senha inicial (mín. 10)"><Input type="password" autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} minLength={10} required /></Field>
              <Field label="Papel">
                <Select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
                  {["OWNER", "ADMIN", "ANALYST", "OPERATOR"].map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
              <div className="col-span-2"><Button type="submit">Adicionar usuário</Button></div>
            </form>
          </Card>
          <Card title="API keys" subtitle="Armazenadas apenas como hash SHA-256" padded={false}>
            {keys.data ? (
              <Table
                rows={keys.data}
                rowKey={(k) => k.id}
                columns={[
                  { key: "n", header: "Nome", render: (k) => k.name },
                  { key: "p", header: "Prefixo", render: (k) => <code className="text-xs">{k.prefix}…</code> },
                  { key: "r", header: "Papel", render: (k) => <Badge tone="info">{k.role}</Badge> },
                  { key: "u", header: "Último uso", render: (k) => <span className="text-xs">{dateTime(k.lastUsedAt)}</span> },
                  { key: "x", header: "", render: (k) => (k.revokedAt ? <Badge>revogada</Badge> : <Button variant="danger" className="h-7" onClick={() => revoke(k.id)}>Revogar</Button>) },
                ]}
              />
            ) : keys.error ? <div className="p-5"><ErrorBox error={keys.error} /></div> : <Loading />}
            <form onSubmit={addKey} className="grid grid-cols-2 gap-3 border-t border-line p-5">
              <Field label="Nome"><Input value={nk.name} onChange={(e) => setNk({ ...nk, name: e.target.value })} placeholder="ERP produção" required /></Field>
              <Field label="Papel">
                <Select value={nk.role} onChange={(e) => setNk({ ...nk, role: e.target.value })}>
                  {["OPERATOR", "ANALYST", "ADMIN"].map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
              <div className="col-span-2"><Button type="submit">Criar API key</Button></div>
            </form>
            {created ? (
              <div className="px-5 pb-5">
                <Notice tone="warning">
                  <p className="font-medium">{created.note}</p>
                  <code className="mt-1 block break-all text-xs">{created.key}</code>
                </Notice>
              </div>
            ) : null}
          </Card>
        </div>
        {platform.data ? (
          <Card title="Plataforma — todos os tenants" subtitle="Visível apenas para administradores da plataforma (PLATFORM_ADMIN_EMAILS)" padded={false}>
            <Table
              rows={platform.data}
              rowKey={(t: any) => t.id}
              columns={[
                { key: "n", header: "Tenant", render: (t: any) => `${t.name} (${t.slug})` },
                { key: "i", header: "Eventos", align: "right", render: (t: any) => int(t.intents) },
                { key: "a", header: "Evitadas", align: "right", render: (t: any) => int(t.avoided) },
                { key: "s", header: "Economia Meta estimada", align: "right", render: (t: any) => money(t.metaSavingsEstimated, "BRL") },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
