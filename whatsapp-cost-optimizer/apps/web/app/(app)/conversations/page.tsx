"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Table } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";

interface Conversation {
  id: string;
  customer: string;
  phoneNumberId: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  customerServiceWindow: { lastInboundMessageAt: string | null; expiresAt: string | null; open: boolean; windowHours: number; policy: string | null };
  entryPoints: Array<{ id: string; type: string; source: string | null; userMessageAt: string; firstBusinessReplyAt: string | null; freeWindowStartedAt: string | null; freeWindowExpiresAt: string | null; open: boolean; eligibility: string; verificationStatus: string }>;
}

const EP: Record<string, string> = { CLICK_TO_WHATSAPP_AD: "Anúncio Click-to-WhatsApp", FACEBOOK_PAGE_CTA: "CTA da Página", ORGANIC: "Orgânica", UNKNOWN: "Desconhecida" };

function SimulateInbound({ onDone }: { onDone: () => void }) {
  const [customer, setCustomer] = useState("+5511977776666");
  const [viaAd, setViaAd] = useState("true");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("dev/simulate-inbound", { body: { customer, viaAd: viaAd === "true", text: "Olá! Vi o anúncio." } });
      setMsg("Mensagem do cliente simulada: a janela de atendimento abriu" + (viaAd === "true" ? " e o Free Entry Point abre na primeira resposta da empresa em até 24h." : "."));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Simular mensagem de cliente (MOCK)" subtitle="Gera um webhook Meta assinado de mensagem recebida — útil para demonstrar janelas gratuitas sem tráfego real.">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Cliente (E.164)">
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </Field>
        <Field label="Origem">
          <Select value={viaAd} onChange={(e) => setViaAd(e.target.value)}>
            <option value="true">Anúncio Click-to-WhatsApp</option>
            <option value="false">Orgânica</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" loading={busy}>
            Simular mensagem recebida
          </Button>
        </div>
      </form>
      {msg ? (
        <div className="mt-3">
          <Notice tone="good">{msg}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorBox error={error} title="Não foi possível simular" />
        </div>
      ) : null}
    </Card>
  );
}

export default function ConversationsPage() {
  const { data, error, loading, reload } = useApi<Conversation[]>("conversations?limit=100", { refreshMs: 15_000 });
  return (
    <>
      <PageHeader
        title="Conversas e janelas"
        description="Janela de atendimento ao cliente (24h após a última mensagem do cliente) e janelas de Free Entry Point. A expiração confirmada pela Meta (webhooks) prevalece sobre a estimativa."
      />
      <div className="space-y-6">
        <SimulateInbound onDone={() => setTimeout(reload, 2500)} />
        <Card title="Conversas recentes" padded={false}>
          {error ? (
            <div className="p-5">
              <ErrorBox error={error} />
            </div>
          ) : null}
          {loading && !data ? <Loading /> : null}
          {data ? (
            <Table
              rows={data}
              rowKey={(r) => r.id}
              empty="Nenhuma conversa ainda."
              columns={[
                { key: "c", header: "Cliente", render: (r) => <span className="font-mono text-xs">{r.customer}</span> },
                { key: "in", header: "Última do cliente", render: (r) => <span className="text-xs">{dateTime(r.lastInboundAt)}</span> },
                { key: "out", header: "Última da empresa", render: (r) => <span className="text-xs">{dateTime(r.lastOutboundAt)}</span> },
                {
                  key: "csw",
                  header: "Janela de atendimento",
                  render: (r) =>
                    r.customerServiceWindow.open ? (
                      <span className="text-xs">
                        <Badge tone="good">ABERTA</Badge> até {dateTime(r.customerServiceWindow.expiresAt)}
                      </span>
                    ) : (
                      <Badge>FECHADA</Badge>
                    ),
                },
                {
                  key: "fep",
                  header: "Free Entry Point",
                  render: (r) =>
                    r.entryPoints.length ? (
                      <div className="space-y-1">
                        {r.entryPoints.map((e) => (
                          <div key={e.id} className="text-xs">
                            <Badge tone={e.open ? "good" : "neutral"}>{e.eligibility}</Badge> {EP[e.type] ?? e.type}
                            {e.freeWindowExpiresAt ? <span className="text-muted"> · até {dateTime(e.freeWindowExpiresAt)}</span> : null}
                            <span className="ml-1">
                              <Badge tone={e.verificationStatus === "CONFIRMED" ? "good" : e.verificationStatus === "REJECTED" ? "critical" : "info"}>{e.verificationStatus === "CONFIRMED" ? "confirmada pela Meta" : e.verificationStatus === "REJECTED" ? "rejeitada pela Meta" : "aguardando confirmação"}</Badge>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    ),
                },
                { key: "p", header: "Política", render: (r) => <span className="font-mono text-[11px] text-muted">{r.customerServiceWindow.policy ?? "—"}</span> },
              ]}
            />
          ) : null}
        </Card>
      </div>
    </>
  );
}
