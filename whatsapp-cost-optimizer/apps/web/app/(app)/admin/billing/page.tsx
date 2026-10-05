"use client";

import { Badge, Card, ErrorBox, KeyValue, Loading, Notice, PageHeader, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTime, int, money, pct } from "@/lib/format";

interface PlanRow {
  code: string;
  name: string;
  monthlyFee: string | null;
  savingsShare: string | null;
  includedIntents: number | null;
  currency: string | null;
}
interface Billing {
  plan: PlanRow;
  subscription: { status: string; startedAt: string; endsAt: string | null } | null;
  usage: { periodKey: string; timezone: string; intents: number; messages: number; includedIntents: number | null; percentUsed: number | null };
  plans: PlanRow[];
  invoices: Array<{ id: string; periodKey: string; amount: string; currency: string; status: string; createdAt: string; snapshot: { usage?: { intents: number }; realizedMetaSavings?: string; overIncluded?: boolean } }>;
  paymentGateway: string | null;
  notes: string[];
}

/** Usage bar: one quantity, so a single accent fill on a neutral track; the number is always printed. */
function UsageBar({ used, included }: { used: number; included: number }) {
  const ratio = Math.min(used / included, 1);
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={`${int(used)} de ${int(included)} eventos`}>
        <div className={used >= included ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-accent"} style={{ width: `${Math.max(ratio * 100, used > 0 ? 1 : 0)}%` }} />
      </div>
      <p className="mt-2 text-sm text-ink-2">
        <span className="font-semibold text-ink">{int(used)}</span> de {int(included)} eventos incluídos
      </p>
    </div>
  );
}

export default function BillingPage() {
  const { data, error, loading } = useApi<Billing>("billing");
  const fee = (p: PlanRow) => (p.monthlyFee === null ? "—" : p.code === "ENTERPRISE" ? "sob consulta" : money(p.monthlyFee, p.currency ?? "BRL"));

  return (
    <>
      <PageHeader title="Plano e uso" description="Sua assinatura do WCO. As mensagens de WhatsApp são cobradas pela Meta diretamente na forma de pagamento da sua conta." />
      {error ? <ErrorBox error={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title="Plano atual">
              <KeyValue
                cols={1}
                items={[
                  ["Plano", <Badge key="p" tone="good">{data.plan.name}</Badge>],
                  ["Mensalidade", fee(data.plan)],
                  ["Eventos incluídos/mês", data.plan.includedIntents === null ? "—" : int(data.plan.includedIntents)],
                  ["Assinatura", data.subscription ? `${data.subscription.status === "ACTIVE" ? "ativa" : data.subscription.status} desde ${dateTime(data.subscription.startedAt)}` : "—"],
                ]}
              />
            </Card>
            <Card title={`Uso em ${data.usage.periodKey}`} subtitle={`Mês civil no fuso ${data.usage.timezone}.`} className="xl:col-span-2">
              {data.usage.includedIntents ? <UsageBar used={data.usage.intents} included={data.usage.includedIntents} /> : null}
              <div className="mt-4">
                <KeyValue
                  items={[
                    ["Eventos recebidos", int(data.usage.intents)],
                    ["Mensagens enviadas", int(data.usage.messages)],
                    ["Uso do plano", data.usage.percentUsed === null ? "—" : pct(data.usage.percentUsed)],
                    ["Excedente", data.usage.includedIntents && data.usage.intents > data.usage.includedIntents ? int(data.usage.intents - data.usage.includedIntents) : "nenhum"],
                  ]}
                />
              </div>
              <div className="mt-4 space-y-2">
                {data.notes.map((n) => (
                  <Notice key={n}>{n}</Notice>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Planos" subtitle="Mudança de plano é feita pela equipe do WCO enquanto não há cobrança online integrada.">
            <Table
              rows={data.plans}
              rowKey={(p) => p.code}
              columns={[
                { key: "name", header: "Plano", render: (p) => (p.code === data.plan.code ? <span className="font-semibold text-ink">{p.name} (atual)</span> : p.name) },
                { key: "fee", header: "Mensalidade", align: "right", render: fee },
                { key: "inc", header: "Eventos incluídos/mês", align: "right", render: (p) => (p.includedIntents === null ? "—" : int(p.includedIntents)) },
              ]}
            />
          </Card>

          <Card title="Faturas" subtitle="Rascunhos gerados no fechamento de cada mês. Uma fatura gerada não é recalculada.">
            {!data.paymentGateway ? (
              <div className="mb-3">
                <Notice tone="warning">Cobrança online ainda não integrada: as faturas ficam como rascunho (DRAFT).</Notice>
              </div>
            ) : null}
            <Table
              rows={data.invoices}
              rowKey={(i) => i.id}
              empty="Nenhuma fatura ainda: a primeira é gerada quando o mês atual fechar."
              columns={[
                { key: "period", header: "Mês", render: (i) => i.periodKey },
                { key: "intents", header: "Eventos", align: "right", render: (i) => int(i.snapshot.usage?.intents ?? 0) },
                { key: "amount", header: "Valor", align: "right", render: (i) => money(i.amount, i.currency) },
                { key: "status", header: "Situação", render: (i) => <Badge tone={i.status === "PAID" ? "good" : "neutral"}>{i.status === "DRAFT" ? "rascunho" : i.status}</Badge> },
                { key: "created", header: "Gerada em", render: (i) => dateTime(i.createdAt) },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
