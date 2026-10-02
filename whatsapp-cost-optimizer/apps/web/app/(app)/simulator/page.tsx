"use client";

import { useState } from "react";
import { BarCard } from "@/components/charts";
import { Badge, Button, Card, DemoBadge, ErrorBox, Field, Input, KeyValue, Notice, PageHeader, Select, Table, Tabs, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { int, money, pct } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any -- simulator results are rendered read-only */
type Tab = "savings" | "ratecard" | "bsp" | "template" | "history";

function useRun<T>() {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<T>(path, { body }));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };
  return { result, error, busy, run };
}

const num = (v: string) => (v === "" ? 0 : Number(v));

function BspFields({ bsp, setBsp }: { bsp: { type: string; value: string }; setBsp: (b: { type: string; value: string }) => void }) {
  return (
    <>
      <Field label="Modelo de cobrança do BSP" hint="Hipótese — nem todo BSP cobra markup">
        <Select value={bsp.type} onChange={(e) => setBsp({ ...bsp, type: e.target.value })}>
          <option value="NONE">Sem BSP (Cloud API direta)</option>
          <option value="PERCENTAGE">% sobre a cobrança da Meta</option>
          <option value="FIXED_PER_MESSAGE">Valor fixo por mensagem</option>
          <option value="MONTHLY">Mensalidade</option>
        </Select>
      </Field>
      {bsp.type !== "NONE" ? (
        <Field label={bsp.type === "PERCENTAGE" ? "Percentual (%)" : bsp.type === "MONTHLY" ? "Mensalidade" : "Valor por mensagem"}>
          <Input value={bsp.value} onChange={(e) => setBsp({ ...bsp, value: e.target.value })} inputMode="decimal" />
        </Field>
      ) : null}
    </>
  );
}

const bspBody = (b: { type: string; value: string }) =>
  b.type === "NONE" ? { type: "NONE" } : b.type === "PERCENTAGE" ? { type: "PERCENTAGE", percentOfMeta: b.value } : b.type === "MONTHLY" ? { type: "MONTHLY", monthlyFee: b.value } : { type: "FIXED_PER_MESSAGE", perMessage: b.value };

function ResultNotes({ r }: { r: { warnings?: string[]; assumptions?: string[]; notes?: string[]; isDemoRate?: boolean } }) {
  const items = [...(r.assumptions ?? []), ...(r.notes ?? [])];
  return (
    <div className="space-y-2">
      {r.isDemoRate ? <Notice tone="warning">Calculado com tarifas DEMO (valores fictícios, não são tarifas da Meta).</Notice> : null}
      {r.warnings?.filter((w) => !/DEMO/.test(w)).map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}
      {items.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">
          {items.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SavingsSim() {
  const [f, setF] = useState({ monthlyMessages: "100000", marketing: "20", utility: "60", authentication: "10", service: "10", duplicateRate: "8", consolidationRate: "10", supersessionRate: "10", fep: "10", windowCapture: "5", phoneNumbers: "1", market: "BR", currency: "BRL" });
  const [bsp, setBsp] = useState({ type: "PERCENTAGE", value: "10" });
  const { result, error, busy, run } = useRun<any>();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run("simulate/savings", {
      monthlyMessages: num(f.monthlyMessages),
      market: f.market,
      currency: f.currency,
      mix: { marketing: num(f.marketing), utility: num(f.utility), authentication: num(f.authentication), service: num(f.service) },
      duplicateRate: num(f.duplicateRate) / 100,
      consolidationRate: num(f.consolidationRate) / 100,
      supersessionRate: num(f.supersessionRate) / 100,
      fepEligibilityPercent: num(f.fep),
      windowCaptureImprovement: num(f.windowCapture),
      phoneNumbers: num(f.phoneNumbers),
      bsp: bspBody(bsp),
    });
  };
  const c = result?.currency ?? f.currency;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card title="Parâmetros" className="xl:col-span-2">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Mensagens por mês" className="col-span-2">
            <Input value={f.monthlyMessages} onChange={set("monthlyMessages")} inputMode="numeric" />
          </Field>
          <Field label="Mercado do destinatário">
            <Select value={f.market} onChange={set("market")}>
              {["BR", "US", "MX", "IN", "FR", "DE", "OTHER"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Moeda de cobrança">
            <Select value={f.currency} onChange={set("currency")}>
              <option>BRL</option>
              <option>USD</option>
            </Select>
          </Field>
          <p className="col-span-2 pt-1 text-xs font-semibold text-ink-2">Mix de categorias (%)</p>
          <Field label="Marketing"><Input value={f.marketing} onChange={set("marketing")} inputMode="decimal" /></Field>
          <Field label="Utility"><Input value={f.utility} onChange={set("utility")} inputMode="decimal" /></Field>
          <Field label="Autenticação"><Input value={f.authentication} onChange={set("authentication")} inputMode="decimal" /></Field>
          <Field label="Service"><Input value={f.service} onChange={set("service")} inputMode="decimal" /></Field>
          <p className="col-span-2 pt-1 text-xs font-semibold text-ink-2">Características do tráfego (%)</p>
          <Field label="Taxa de duplicação"><Input value={f.duplicateRate} onChange={set("duplicateRate")} inputMode="decimal" /></Field>
          <Field label="Atualizações consolidáveis"><Input value={f.consolidationRate} onChange={set("consolidationRate")} inputMode="decimal" /></Field>
          <Field label="Atualizações substituíveis"><Input value={f.supersessionRate} onChange={set("supersessionRate")} inputMode="decimal" /></Field>
          <Field label="Elegível a Free Entry Point"><Input value={f.fep} onChange={set("fep")} inputMode="decimal" /></Field>
          <Field label="Melhora no uso de janelas"><Input value={f.windowCapture} onChange={set("windowCapture")} inputMode="decimal" /></Field>
          <Field label="Números de telefone"><Input value={f.phoneNumbers} onChange={set("phoneNumbers")} inputMode="numeric" /></Field>
          <BspFields bsp={bsp} setBsp={setBsp} />
          <div className="col-span-2 pt-2">
            <Button type="submit" variant="primary" loading={busy} className="w-full">
              Simular economia
            </Button>
          </div>
        </form>
      </Card>
      <div className="space-y-6 xl:col-span-3">
        {error ? <ErrorBox error={error} title="Simulação inválida" /> : null}
        {!result && !error ? <Notice>Preencha os parâmetros e clique em “Simular economia”. O resultado é sempre uma estimativa.</Notice> : null}
        {result ? (
          <>
            <Card title={<span className="flex items-center gap-2">Resultado estimado {result.isDemoRate ? <DemoBadge /> : null}</span>} subtitle={`Política ${result.policyVersion} · nunca é economia garantida`}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-ink-2">Sem WCO</p>
                  <p className="text-xl font-semibold">{money(result.baseline.total, c)}</p>
                  <p className="text-xs text-muted">{int(result.baseline.messages)} mensagens</p>
                </div>
                <div>
                  <p className="text-xs text-ink-2">Com WCO</p>
                  <p className="text-xl font-semibold">{money(result.optimized.total, c)}</p>
                  <p className="text-xs text-muted">{int(result.optimized.messages)} mensagens</p>
                </div>
                <div>
                  <p className="text-xs text-ink-2">Economia estimada</p>
                  <p className="text-xl font-semibold text-good">{money(result.savings.total, c)}</p>
                  <p className="text-xs text-muted">{pct(result.savings.percent)} · {int(result.savings.messagesAvoided)} mensagens evitadas</p>
                </div>
              </div>
              <div className="mt-5">
                <KeyValue
                  items={[
                    ["Economia Meta", money(result.savings.meta, c)],
                    ["Economia BSP", money(result.savings.bsp, c)],
                    ["Economia de infraestrutura", money(result.savings.infra, c)],
                    ["Meta sem / com WCO", `${money(result.baseline.meta, c)} / ${money(result.optimized.meta, c)}`],
                  ]}
                />
              </div>
            </Card>
            <BarCard
              title="Custo Meta por categoria"
              rows={result.byCategory.map((r: any) => ({ category: r.category, baseline: Number(r.baselineMeta), optimized: Number(r.optimizedMeta) }))}
              xKey="category"
              xLabel="Categoria"
              series={[
                { key: "baseline", label: "Sem WCO" },
                { key: "optimized", label: "Com WCO" },
              ]}
              format={(v) => money(v, c)}
            />
            <ResultNotes r={result} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function RateCardSim() {
  const [f, setF] = useState({ category: "UTILITY", monthlyMessages: "50000", market: "BR", currency: "BRL", currentTierPosition: "0", fepPercent: "0", serviceWindowPercent: "0", optimizationReductionPercent: "15", phoneNumbers: "1" });
  const { result, error, busy, run } = useRun<any>();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run("simulate/rate-card", {
      category: f.category,
      monthlyMessages: num(f.monthlyMessages),
      market: f.market,
      currency: f.currency,
      currentTierPosition: num(f.currentTierPosition),
      fepPercent: num(f.fepPercent),
      serviceWindowPercent: num(f.serviceWindowPercent),
      optimizationReductionPercent: num(f.optimizationReductionPercent),
      phoneNumbers: num(f.phoneNumbers),
    });
  };
  const c = result?.currency ?? f.currency;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card title="Parâmetros" className="xl:col-span-2">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Categoria">
            <Select value={f.category} onChange={set("category")}>
              {["MARKETING", "UTILITY", "AUTHENTICATION", "AUTHENTICATION_INTERNATIONAL", "SERVICE"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label="Mensagens por mês"><Input value={f.monthlyMessages} onChange={set("monthlyMessages")} /></Field>
          <Field label="Mercado"><Input value={f.market} onChange={set("market")} /></Field>
          <Field label="Moeda"><Select value={f.currency} onChange={set("currency")}><option>BRL</option><option>USD</option></Select></Field>
          <Field label="Posição atual no mês (tier)"><Input value={f.currentTierPosition} onChange={set("currentTierPosition")} /></Field>
          <Field label="Números de telefone"><Input value={f.phoneNumbers} onChange={set("phoneNumbers")} /></Field>
          <Field label="% em Free Entry Point"><Input value={f.fepPercent} onChange={set("fepPercent")} /></Field>
          <Field label="% na janela de atendimento"><Input value={f.serviceWindowPercent} onChange={set("serviceWindowPercent")} /></Field>
          <Field label="Redução por otimização (%)" className="col-span-2"><Input value={f.optimizationReductionPercent} onChange={set("optimizationReductionPercent")} /></Field>
          <div className="col-span-2 pt-2">
            <Button type="submit" variant="primary" loading={busy} className="w-full">Calcular</Button>
          </div>
        </form>
      </Card>
      <div className="space-y-6 xl:col-span-3">
        {error ? <ErrorBox error={error} title="Simulação inválida" /> : null}
        {result ? (
          <>
            <Card title={<span className="flex items-center gap-2">Rate card {result.isDemoRate ? <DemoBadge /> : null}</span>} subtitle={`${result.rateCard ?? "—"} · política ${result.policyVersion}`}>
              <KeyValue
                items={[
                  ["Custo Meta sem otimização", money(result.baseline.metaCost, c)],
                  ["Custo Meta com otimização", money(result.optimized.metaCost, c)],
                  ["Economia", `${money(result.savings.total, c)} (${pct(result.savings.percent)})`],
                  ["Mensagens cobradas (sem / com)", `${int(result.baseline.charged)} / ${int(result.optimized.charged)}`],
                  ["Grátis FEP / janela / cota", `${int(result.optimized.freeEntryPoint)} / ${int(result.optimized.freeServiceWindow)} / ${int(result.optimized.freeQuota)}`],
                ]}
              />
            </Card>
            <Card title="Distribuição por tier (cenário otimizado)" padded={false}>
              <Table
                rows={result.optimized.tiers}
                rowKey={(t: any) => t.label}
                columns={[
                  { key: "l", header: "Faixa", render: (t: any) => t.label },
                  { key: "n", header: "Mensagens", align: "right", render: (t: any) => int(t.count) },
                  { key: "r", header: "Tarifa", align: "right", render: (t: any) => money(t.rate, c, 4) },
                  { key: "s", header: "Subtotal", align: "right", render: (t: any) => money(t.subtotal, c) },
                ]}
              />
            </Card>
            <ResultNotes r={result} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function BspSim() {
  const [f, setF] = useState({ metaMonthlyCost: "5000", monthlyMessages: "100000", directMonthlyExtra: "1500", currency: "BRL" });
  const [bsp, setBsp] = useState({ type: "FIXED_PER_MESSAGE", value: "0.01" });
  const { result, error, busy, run } = useRun<any>();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run("simulate/bsp", { currency: f.currency, metaMonthlyCost: f.metaMonthlyCost, monthlyMessages: num(f.monthlyMessages), directMonthlyExtra: f.directMonthlyExtra, bsp: bspBody(bsp) });
  };
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card title="Cloud API direta vs BSP" subtitle="A tarifa da Meta é a mesma nos dois caminhos; muda o que se paga além dela." className="xl:col-span-2">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Custo Meta mensal"><Input value={f.metaMonthlyCost} onChange={set("metaMonthlyCost")} /></Field>
          <Field label="Mensagens por mês"><Input value={f.monthlyMessages} onChange={set("monthlyMessages")} /></Field>
          <BspFields bsp={bsp} setBsp={setBsp} />
          <Field label="Custo extra de operar direto (mês)" hint="Equipe, infraestrutura, suporte" className="col-span-2">
            <Input value={f.directMonthlyExtra} onChange={set("directMonthlyExtra")} />
          </Field>
          <div className="col-span-2 pt-2">
            <Button type="submit" variant="primary" loading={busy} className="w-full">Comparar</Button>
          </div>
        </form>
      </Card>
      <div className="space-y-4 xl:col-span-3">
        {error ? <ErrorBox error={error} /> : null}
        {result ? (
          <>
            <Card title="Comparação (estimada)" subtitle={`Mais barato neste cenário: ${result.difference.cheaper === "BSP" ? "BSP" : result.difference.cheaper === "DIRECT" ? "Cloud API direta" : "equivalente"}`}>
              <KeyValue
                items={[
                  ["Cloud API direta — mês / ano", `${money(result.direct.monthly, result.currency)} / ${money(result.direct.annual, result.currency)}`],
                  ["Via BSP — mês / ano", `${money(result.bsp.monthly, result.currency)} / ${money(result.bsp.annual, result.currency)}`],
                  ["Taxas do BSP (% / por mensagem / mensalidade)", `${money(result.bsp.fees.percent, result.currency)} / ${money(result.bsp.fees.perMessage, result.currency)} / ${money(result.bsp.fees.monthly, result.currency)}`],
                  ["Diferença — mês / ano", `${money(result.difference.monthly, result.currency)} / ${money(result.difference.annual, result.currency)}`],
                ]}
              />
            </Card>
            <ResultNotes r={{ notes: result.notes }} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function TemplateSim() {
  const [f, setF] = useState({ body: "Olá {{1}}, seu pedido {{2}} foi enviado. Acompanhe pelo código {{3}}.", declaredCategory: "UTILITY", market: "BR", monthlyVolume: "10000" });
  const { result, error, busy, run } = useRun<any>();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run("templates/cost-analysis", { body: f.body, declaredCategory: f.declaredCategory, market: f.market, monthlyVolume: num(f.monthlyVolume) });
  };
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card title="Template Cost Analyzer" subtitle="Analisa custo e risco de categoria. Não sugere alterar texto para mudar a categoria." className="xl:col-span-2">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Texto do template"><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Categoria declarada">
              <Select value={f.declaredCategory} onChange={(e) => setF({ ...f, declaredCategory: e.target.value })}>
                <option>UTILITY</option>
                <option>MARKETING</option>
                <option>AUTHENTICATION</option>
              </Select>
            </Field>
            <Field label="Mercado"><Input value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })} /></Field>
            <Field label="Volume/mês"><Input value={f.monthlyVolume} onChange={(e) => setF({ ...f, monthlyVolume: e.target.value })} /></Field>
          </div>
          <Button type="submit" variant="primary" loading={busy} className="w-full">Analisar</Button>
        </form>
      </Card>
      <div className="space-y-4 xl:col-span-3">
        {error ? <ErrorBox error={error} /> : null}
        {result ? (
          <Card title={<span className="flex items-center gap-2">Análise {result.isDemoRate ? <DemoBadge /> : null}</span>} subtitle={result.disclaimer}>
            <KeyValue
              items={[
                ["Categoria provável (heurística)", <Badge key="c" tone="info">{result.analysis.category}</Badge>],
                ["Confiança", pct(result.analysis.classificationConfidence * 100, 0)],
                ["Revisão humana recomendada", result.analysis.requiresHumanReview ? "sim" : "não"],
                ["Categoria considerada no custo", result.billedCategory],
                ["Tarifa estimada", money(result.estimatedRate, "BRL", 4)],
                ["Custo mensal estimado", money(result.estimatedMonthlyCost, "BRL")],
              ]}
            />
            {result.alerts?.length ? (
              <div className="mt-4 space-y-2">
                {result.alerts.map((a: string) => (
                  <Notice key={a} tone="warning">{a}</Notice>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

const HISTORY_SAMPLE = `timestamp,customer,eventType,category,country,template,delivered,status,source,isFEP,isServiceWindow
2026-09-01T12:00:00Z,+5511900000001,order.status,UTILITY,BR,order_status_update,true,delivered,erp,false,false
2026-09-01T12:00:20Z,+5511900000001,order.status,UTILITY,BR,order_status_update,true,delivered,erp,false,false
2026-09-01T12:00:20Z,+5511900000001,order.status,UTILITY,BR,order_status_update,true,delivered,erp,false,false
2026-09-01T13:10:00Z,+5511900000002,authentication.otp,AUTHENTICATION,BR,otp_code,true,delivered,app,false,false
2026-09-02T09:00:00Z,+5511900000003,marketing.campaign,MARKETING,BR,weekly_offer,true,read,crm,true,false`;

function HistorySim() {
  const [content, setContent] = useState(HISTORY_SAMPLE);
  const { result, error, busy, run } = useRun<any>();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setContent(await file.text());
  };
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card title="Importar histórico (CSV)" subtitle="Colunas: timestamp, customer, eventType, category, country, template, delivered, status, source, isFEP, isServiceWindow" className="xl:col-span-2">
        <div className="space-y-3">
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-xs text-ink-2" aria-label="Arquivo CSV" />
          <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} />
          <Button variant="primary" className="w-full" loading={busy} onClick={() => void run("import/history", { content, filename: "history.csv" })}>
            Calcular baseline e simulação
          </Button>
        </div>
      </Card>
      <div className="space-y-4 xl:col-span-3">
        {error ? <ErrorBox error={error} title="Importação rejeitada" /> : null}
        {result ? (
          <>
            <Card title="Resultado (estimado)" subtitle={`${int(result.valid)} linhas válidas de ${int(result.rows)} · período ${result.period.from?.slice(0, 10) ?? "—"} a ${result.period.to?.slice(0, 10) ?? "—"}`}>
              <KeyValue
                items={[
                  ["Custo como enviado (histórico)", money(result.asSent.cost, result.currency)],
                  ["Mensagens entregues", int(result.asSent.delivered)],
                  ["Economia Meta estimada com WCO", result.savings ? `${money(result.savings.meta, result.currency)} (${pct(result.savings.percent)})` : "—"],
                  ["Mensagens evitadas", result.savings ? int(result.savings.messagesAvoided) : "—"],
                ]}
              />
            </Card>
            {result.errors?.length ? (
              <Card title={`Linhas com erro (${result.invalid})`} padded={false}>
                <Table dense rows={result.errors} rowKey={(e: any) => `${e.line}-${e.message}`} columns={[{ key: "l", header: "Linha", render: (e: any) => e.line }, { key: "m", header: "Erro", render: (e: any) => e.message }]} />
              </Card>
            ) : null}
            <ResultNotes r={{ notes: result.notes, isDemoRate: result.isDemoRate }} />
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function SimulatorPage() {
  const [tab, setTab] = useState<Tab>("savings");
  return (
    <>
      <PageHeader
        title="Simular economia"
        description="Estimativas para decisão — nunca economia garantida. A cobrança final é feita pela Meta conforme a política e o rate card vigentes."
        actions={
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "savings", label: "Economia" },
              { value: "ratecard", label: "Rate card" },
              { value: "bsp", label: "BSP vs direto" },
              { value: "template", label: "Templates" },
              { value: "history", label: "Histórico CSV" },
            ]}
          />
        }
      />
      {tab === "savings" ? <SavingsSim /> : null}
      {tab === "ratecard" ? <RateCardSim /> : null}
      {tab === "bsp" ? <BspSim /> : null}
      {tab === "template" ? <TemplateSim /> : null}
      {tab === "history" ? <HistorySim /> : null}
    </>
  );
}
