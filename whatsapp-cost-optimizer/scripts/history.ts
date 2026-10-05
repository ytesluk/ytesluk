/**
 * pnpm historico <arquivo.csv> [--rate-card tarifas.json] [--timezone America/Sao_Paulo] [--json saida.json]
 *
 * Replays a company's REAL sending history through the optimizer, locally (the file never leaves
 * this machine — useful for a prospect's data under LGPD). Same engine as "Simular economia ›
 * Histórico CSV" in the dashboard. Columns: see docs/TESTAR-ECONOMIA.md.
 * Without --rate-card the money values use the DEMO (fictitious) rates; message counts are real.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { RateCatalog, importRateCard } from "@wco/pricing";
import { importHistory } from "@wco/simulator";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "rate-card": { type: "string" }, timezone: { type: "string" }, json: { type: "string" } },
});
const file = positionals[0];
if (!file) {
  console.error("uso: pnpm historico <arquivo.csv> [--rate-card tarifas.json] [--timezone America/Sao_Paulo] [--json saida.json]");
  process.exit(2);
}

let rates: RateCatalog | undefined;
let currency = "BRL";
if (values["rate-card"]) {
  const r = importRateCard(readFileSync(values["rate-card"], "utf8"), {});
  if (!r.ok || !r.card) throw new Error(`rate card inválido: ${r.issues.map((i) => i.message).join("; ")}`);
  rates = new RateCatalog([r.card]);
  currency = r.card.meta.currency;
}

const r = importHistory(readFileSync(file, "utf8"), { timezone: values.timezone ?? "America/Sao_Paulo", currency, rates });
const n = (v: number) => v.toLocaleString("pt-BR");
const brl = (v: string | undefined) => (v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency, maximumFractionDigits: 4 }));
const A = r.replay?.control;
const E = r.replay?.optimized;

console.log(`\nHistórico: ${file}`);
console.log(`Linhas: ${n(r.rows)} · válidas ${n(r.valid)} · com erro ${n(r.invalid)} · período ${r.period.from?.slice(0, 10) ?? "—"} a ${r.period.to?.slice(0, 10) ?? "—"}`);
console.log(`Tarifas: ${r.isDemoRate ? "DEMO (fictícias) — use --rate-card com o rate card oficial para valores reais" : "importadas"}`);
console.log(`\nComo foi enviado: ${n(r.asSent.delivered)} mensagens entregues · custo Meta estimado ${brl(r.asSent.cost)}`);
if (A && E && r.savings) {
  console.log(`Mesmos eventos sem WCO: ${n(A.messagesSent)} mensagens · ${brl(A.metaCost)}`);
  console.log(`Mesmos eventos com WCO: ${n(E.messagesSent)} mensagens · ${brl(E.metaCost)}`);
  console.log(`\nEconomia Meta estimada: ${brl(r.savings.meta)} (${r.savings.percent ?? "—"}%) · ${n(r.savings.messagesAvoided)} mensagens evitadas`);
}
if (r.mechanisms) {
  const m = r.mechanisms;
  console.log(`  · reenvios idênticos bloqueados: ${n(m.duplicatesBlocked)}`);
  console.log(`  · atualizações substituídas pela mais recente: ${n(m.supersessions)}`);
  console.log(`  · atualizações consolidadas: ${n(m.consolidatedIntents)} em ${n(m.consolidatedMessages)} mensagens`);
  console.log(`  · gratuitas por conversa via anúncio (FEP): ${n(m.freeEntryPoint)} · pela cota de Service: ${n(m.freeQuota)}`);
}
const id = r.identification;
console.log(`Identificação: ${n(id.withEntity)} com entityId · ${n(id.contentOnly)} só content · ${n(id.unidentified)} sem identificação`);
for (const note of r.notes) console.log(`! ${note}`);
for (const e of r.errors.slice(0, 10)) console.log(`  linha ${e.line}: ${e.message}`);
console.log("\nEstimativa (ESTIMATED), não economia garantida: a cobrança final é da Meta.\n");
if (values.json) writeFileSync(values.json, JSON.stringify(r, null, 2));
