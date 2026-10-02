"use client";

import { useState } from "react";
import { BarCard } from "@/components/charts";
import { Button, Card, DemoBadge, ErrorBox, Field, Input, Loading, Notice, PageHeader, Table } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";
import { dateTime, int, money, pct } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any -- experiment results are rendered read-only */
interface Run {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  params: any;
  results: any;
}

function Results({ r }: { r: any }) {
  const c = r.currency;
  const A = r.arms.find((a: any) => a.arm === "A");
  return (
    <div className="space-y-6">
      <Card
        title={<span className="flex items-center gap-2">Braços A–F {r.isDemoRates ? <DemoBadge /> : null}</span>}
        subtitle={`${int(r.datasetSize.intents)} eventos + ${int(r.datasetSize.inbound)} mensagens de clientes · mesmo dataset em todos os braços · resultado SIMULADO`}
        padded={false}
      >
        <Table
          rows={r.arms}
          rowKey={(a: any) => a.arm}
          columns={[
            { key: "a", header: "Braço", render: (a: any) => <span className="font-semibold">{a.arm}</span> },
            { key: "l", header: "Técnicas", render: (a: any) => <span className="text-xs">{a.label}</span> },
            { key: "s", header: "Mensagens", align: "right", render: (a: any) => int(a.messagesSent) },
            { key: "v", header: "Evitadas", align: "right", render: (a: any) => int(A.messagesSent - a.messagesSent) },
            { key: "m", header: "Custo Meta", align: "right", render: (a: any) => money(a.metaCost, c) },
            { key: "b", header: "BSP", align: "right", render: (a: any) => money(a.bspCost, c) },
            { key: "i", header: "Infra", align: "right", render: (a: any) => money(a.infraCost, c, 4) },
            { key: "t", header: "Total", align: "right", render: (a: any) => money(a.totalCost, c) },
            { key: "p", header: "Economia total", align: "right", render: (a: any) => (a.arm === "A" ? "controle" : pct(r.comparisons.find((x: any) => x.arm === a.arm)?.totalSavingsPercent)) },
          ]}
        />
      </Card>
      <BarCard
        title="Custo total por braço"
        subtitle="Meta + BSP (hipotético) + infraestrutura"
        rows={r.arms.map((a: any) => ({ arm: `${a.arm}`, total: Number(a.totalCost) }))}
        xKey="arm"
        xLabel="Braço"
        series={[{ key: "total", label: "Custo total" }]}
        format={(v) => money(v, c)}
      />
    </div>
  );
}

export default function ResearchPage() {
  const runs = useApi<Run[]>("research/runs");
  const [f, setF] = useState({ events: "5000", customers: "1500", duplicateRate: "8", burstRate: "35", fepRate: "25", seed: "20261002" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState<any>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<any>("research/run", {
        body: { name: "dashboard-run", events: Number(f.events), customers: Number(f.customers), duplicateRate: Number(f.duplicateRate) / 100, burstRate: Number(f.burstRate) / 100, fepRate: Number(f.fepRate) / 100, seed: Number(f.seed) },
      });
      setCurrent(r);
      runs.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Experimento A–F"
        description="Reprocessa o mesmo dataset sintético em seis braços (A controle, B deduplicação, C + supersession, D + agregação, E + otimizador de preço, F + Cloud API direta). Execuções grandes (até 1M eventos): pnpm research."
      />
      <div className="space-y-6">
        <Card title="Nova execução" subtitle="Até 20.000 eventos pelo dashboard">
          <form onSubmit={submit} className="grid grid-cols-2 gap-3 md:grid-cols-7">
            <Field label="Eventos"><Input value={f.events} onChange={set("events")} /></Field>
            <Field label="Clientes"><Input value={f.customers} onChange={set("customers")} /></Field>
            <Field label="Duplicação (%)"><Input value={f.duplicateRate} onChange={set("duplicateRate")} /></Field>
            <Field label="Rajadas (%)"><Input value={f.burstRate} onChange={set("burstRate")} /></Field>
            <Field label="Via anúncio/FEP (%)"><Input value={f.fepRate} onChange={set("fepRate")} /></Field>
            <Field label="Seed"><Input value={f.seed} onChange={set("seed")} /></Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary" loading={busy} className="w-full">Executar</Button>
            </div>
          </form>
        </Card>
        {error ? <ErrorBox error={error} /> : null}
        {busy ? <Loading label="Simulando os seis braços…" /> : null}
        {current ? <Results r={current} /> : null}
        <Card title="Execuções anteriores" padded={false}>
          {runs.loading && !runs.data ? <Loading /> : null}
          {runs.error ? <ErrorBox error={runs.error} /> : null}
          {runs.data ? (
            <Table
              rows={runs.data}
              rowKey={(r) => r.id}
              empty="Nenhuma execução ainda."
              columns={[
                { key: "d", header: "Quando", render: (r) => <span className="text-xs">{dateTime(r.createdAt)}</span> },
                { key: "e", header: "Eventos", align: "right", render: (r) => int(r.params?.events) },
                { key: "s", header: "Status", render: (r) => r.status },
                { key: "x", header: "Economia total F vs A", align: "right", render: (r) => pct(r.results?.comparisons?.find((c: any) => c.arm === "F")?.totalSavingsPercent) },
                { key: "o", header: "", render: (r) => (r.results ? <Button variant="ghost" onClick={() => setCurrent(r.results)}>Ver</Button> : null) },
              ]}
            />
          ) : null}
        </Card>
        <Notice>Resultados simulados com o motor de produção (mesmas regras de otimização e preço). Metodologia, hipóteses e ameaças à validade em docs/ACADEMIC-EXPERIMENT.md.</Notice>
      </div>
    </>
  );
}
