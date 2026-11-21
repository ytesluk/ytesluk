"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Card, ErrorBox, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

/**
 * The company's own switch for two optimizations: joining related notices into one message and
 * sending only the newest status. It edits the same per-notice-type policies as the operator's
 * screen (same API, same audit trail), showing only the two choices a company makes. Urgent and
 * service notices are not listed: they are never held back.
 */

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
  allowMarketingFreeFormInWindow: boolean;
  inboundFirstGraceMinutes: number;
  maxConsolidatedItems: number;
  enabled: boolean;
}

interface Template {
  id: string;
  name: string;
  status: string;
}

const NAMES: Record<string, string> = {
  "order.status": "Status do pedido",
  "order.updated": "Atualização do pedido",
  "payment.approved": "Pagamento aprovado",
  "shipment.tracking": "Rastreio da entrega",
  "stock.update": "Produto de volta ao estoque",
  "appointment.reminder": "Lembrete de agendamento",
  "marketing.campaign": "Campanha de marketing",
  "cart.reminder": "Carrinho abandonado",
};

/** When a switch is turned on for a notice type that never waits, it may wait up to 1 minute. */
const MIN_WAIT_S = 60;
const MIN_PAUSE_S = 30;

const shown = (p: Policy) => p.eventType !== "*" && !p.requiresImmediateDelivery && p.priority !== "CRITICAL" && p.category !== "SERVICE";

function waitLabel(s: number): string {
  if (s <= 0) return "sai na hora";
  if (s % 3600 === 0) return `espera até ${s / 3600} h`;
  if (s >= 60) return `espera até ${Math.round(s / 60)} min`;
  return `espera até ${s} s`;
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-accent" : "bg-surface-2 ring-1 ring-inset ring-[var(--rule)]"}`}
    >
      <span className={`inline-block size-5 rounded-full bg-[#fdfcf8] shadow transition ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

function Example({ before, after }: { before: string[]; after: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px]">
      {before.map((b) => (
        <span key={b} className="rounded-lg bg-surface-2 px-2.5 py-1 text-ink-2">
          {b}
        </span>
      ))}
      <ArrowRight className="size-4 text-muted" aria-hidden />
      <span className="rounded-lg bg-accent px-2.5 py-1 font-medium text-accent-ink">{after}</span>
    </div>
  );
}

function Row({ initial, approved }: { initial: Policy; approved: string[] }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [picking, setPicking] = useState(false);

  const save = async (next: Policy) => {
    const before = p;
    setP(next);
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const { id: _id, ...body } = next;
      void _id;
      await api("optimization/policies", { body });
      setSaved(true);
    } catch (e) {
      setP(before);
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };

  const turn = (k: "allowAggregation" | "allowSupersession") => (v: boolean) => {
    const next = { ...p, [k]: v };
    if (v && next.maxDelaySeconds === 0) {
      next.maxDelaySeconds = MIN_WAIT_S;
      next.debounceSeconds = Math.max(next.debounceSeconds, MIN_PAUSE_S);
    }
    if (k === "allowAggregation" && v && !next.consolidationTemplate && approved.length === 1) next.consolidationTemplate = approved[0]!;
    void save(next);
  };

  const name = NAMES[p.eventType] ?? p.eventType;
  const templateOk = !!p.consolidationTemplate && approved.includes(p.consolidationTemplate);

  return (
    <li className="py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 sm:gap-x-10">
        <div className="min-w-0">
          <p className="font-medium leading-snug text-ink">{name}</p>
          <p className="text-xs text-muted">
            {waitLabel(p.maxDelaySeconds)}
            {busy ? " · salvando…" : saved ? " · salvo" : ""}
          </p>
          {p.allowAggregation && templateOk && !picking ? (
            <p className="mt-0.5 text-xs text-muted">
              Mensagem junta: <span className="text-ink-2">{p.consolidationTemplate}</span>{" "}
              {approved.length > 1 ? (
                <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-ink" onClick={() => setPicking(true)}>
                  trocar
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex w-14 justify-center sm:w-[84px]">
          <Switch on={p.allowAggregation} onChange={turn("allowAggregation")} label={`Juntar avisos: ${name}`} disabled={busy} />
        </div>
        <div className="flex w-14 justify-center sm:w-[84px]">
          <Switch on={p.allowSupersession} onChange={turn("allowSupersession")} label={`Só o mais recente: ${name}`} disabled={busy} />
        </div>
      </div>

      {p.allowAggregation && (!templateOk || picking) ? (
        <div className="mt-3 max-w-xl rounded-xl bg-surface-2/60 p-3 text-sm">
          <label className="block text-xs font-medium text-ink-2" htmlFor={`tpl-${p.id}`}>
            Template da mensagem junta
          </label>
          {approved.length ? (
            <Select id={`tpl-${p.id}`} value={p.consolidationTemplate ?? ""} disabled={busy} onChange={(e) => {
                setPicking(false);
                void save({ ...p, consolidationTemplate: e.target.value || null });
              }}>
              <option value="">Escolha um template aprovado</option>
              {approved.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {p.consolidationTemplate && !templateOk ? <option value={p.consolidationTemplate}>{p.consolidationTemplate} (não aprovado)</option> : null}
            </Select>
          ) : null}
          {!templateOk ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              {approved.length
                ? "Enquanto nenhum template aprovado estiver escolhido, os avisos continuam saindo separados."
                : "Você ainda não tem template aprovado. Crie na Meta um template de resumo (por exemplo: “Atualizações do seu pedido {{1}}: {{2}}”) e importe na tela Templates. Até lá, os avisos saem separados."}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <ErrorBox error={error} title="Não foi possível salvar" />
        </div>
      ) : null}
    </li>
  );
}

export default function GroupingPage() {
  const policies = useApi<{ policies: Policy[] }>("optimization/policies");
  const templates = useApi<Template[]>("templates");
  const rows = (policies.data?.policies ?? []).filter(shown);
  const approved = (templates.data ?? []).filter((t) => t.status === "APPROVED").map((t) => t.name);

  return (
    <>
      <PageHeader title="Juntar avisos" description="Escolha se o WCO pode juntar avisos parecidos e enviar só o status mais recente para o seu cliente." />

      <div className="space-y-6">
        <Card title="Como funciona">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <p className="font-medium text-ink">Juntar avisos parecidos</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Quando o mesmo cliente recebe vários avisos sobre o mesmo pedido em poucos minutos, ele recebe tudo numa mensagem só.
              </p>
              <Example before={["Pagamento aprovado", "Pedido separado"]} after="1 mensagem com os dois" />
            </div>
            <div>
              <p className="font-medium text-ink">Enviar só o mais recente</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Se o status muda antes de o aviso sair, o cliente recebe só o status atual, sem as etapas que já ficaram para trás.
              </p>
              <Example before={["Processando", "Separado", "Enviado"]} after="Enviado" />
            </div>
          </div>
          <p className="mt-6 border-t border-dashed border-rule pt-4 text-xs leading-relaxed text-muted">
            Códigos de verificação e alertas críticos sempre saem na hora e não aparecem aqui. Nenhum aviso espera mais do que o tempo mostrado em cada linha.
          </p>
        </Card>

        <Card title="Configurar" subtitle="Ligue ou desligue para cada tipo de aviso. A mudança vale para os próximos envios e fica registrada na auditoria.">
          {policies.error ? <ErrorBox error={policies.error} /> : null}
          {policies.loading && !policies.data ? <Loading /> : null}
          {policies.data && rows.length === 0 ? <Notice>Nenhum tipo de aviso configurado ainda.</Notice> : null}
          {rows.length ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-x-3 border-b border-dashed border-rule pb-2 text-[11px] font-medium uppercase leading-tight tracking-wide text-muted sm:gap-x-10">
                <span>Tipo de aviso</span>
                <span className="w-14 text-center sm:w-[84px]">Juntar</span>
                <span className="w-14 text-center sm:w-[84px]">Só o mais recente</span>
              </div>
              <ul className="divide-y divide-dashed divide-[var(--rule)]">
                {rows.map((p) => (
                  <Row key={p.id} initial={p} approved={approved} />
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
