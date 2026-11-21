"use client";

import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

/**
 * The savings a company has to switch on itself, in one place. Everything else the WCO does on its
 * own and is not listed. Per notice type: join related notices, send only the newest status, send
 * as a conversation message inside the 24 h window. Per template: a backup template for when Meta
 * reclassifies it (the FinOps mirror pool). It edits the existing policies and mirror variants
 * through the same API as the operator's screens and the overview panel (audited).
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
  language: string;
  declaredCategory: string;
  metaCategory: string | null;
  status: string;
}

interface Variant {
  id: string;
  groupKey: string;
  metaTemplateName: string;
  language: string;
  category: string;
  status: string;
  priority: number;
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

/** A notice type that never waited may wait up to 1 minute once joining or replacing is switched on. */
const MIN_WAIT_S = 60;
const MIN_PAUSE_S = 30;

const listed = (p: Policy) => p.eventType !== "*" && !p.requiresImmediateDelivery && p.priority !== "CRITICAL" && p.category !== "SERVICE";
const chatKey = (p: Policy): "allowFreeFormInWindow" | "allowMarketingFreeFormInWindow" => (p.category === "MARKETING" ? "allowMarketingFreeFormInWindow" : "allowFreeFormInWindow");

function waitLabel(s: number): string {
  if (s <= 0) return "sai na hora";
  if (s % 3600 === 0) return `espera até ${s / 3600} h`;
  if (s >= 60) return `espera até ${Math.round(s / 60)} min`;
  return `espera até ${s} s`;
}

function errorOf(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, String(e));
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
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
      {before.map((b) => (
        <span key={b} className="rounded-lg bg-surface-2 px-2 py-0.5 text-ink-2">
          {b}
        </span>
      ))}
      <ArrowRight className="size-3.5 text-muted" aria-hidden />
      <span className="rounded-lg bg-accent px-2 py-0.5 font-medium text-accent-ink">{after}</span>
    </div>
  );
}

function Mode({ n, title, children, example }: { n: string; title: string; children: React.ReactNode; example: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[11px] text-muted">{n}</p>
      <p className="mt-1 font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{children}</p>
      {example}
    </div>
  );
}

const COL = "flex w-12 justify-center sm:w-[92px]";

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
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };

  const turn = (k: "allowAggregation" | "allowSupersession" | "allowFreeFormInWindow" | "allowMarketingFreeFormInWindow") => (v: boolean) => {
    const next = { ...p, [k]: v };
    if (v && (k === "allowAggregation" || k === "allowSupersession") && next.maxDelaySeconds === 0) {
      next.maxDelaySeconds = MIN_WAIT_S;
      next.debounceSeconds = Math.max(next.debounceSeconds, MIN_PAUSE_S);
    }
    if (k === "allowAggregation" && v && !next.consolidationTemplate && approved.length === 1) next.consolidationTemplate = approved[0]!;
    void save(next);
  };

  const name = NAMES[p.eventType] ?? p.eventType;
  const chat = chatKey(p);
  const templateOk = !!p.consolidationTemplate && approved.includes(p.consolidationTemplate);

  return (
    <li className="py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 gap-y-1 sm:gap-x-6">
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
        <div className={COL}>
          <Switch on={p.allowAggregation} onChange={turn("allowAggregation")} label={`Juntar mensagens: ${name}`} disabled={busy} />
        </div>
        <div className={COL}>
          <Switch on={p.allowSupersession} onChange={turn("allowSupersession")} label={`Só o mais recente: ${name}`} disabled={busy} />
        </div>
        <div className={COL}>
          <Switch on={!!p[chat]} onChange={turn(chat)} label={`Como conversa: ${name}`} disabled={busy} />
        </div>
      </div>

      {p.allowAggregation && (!templateOk || picking) ? (
        <div className="mt-3 max-w-xl rounded-xl bg-surface-2/60 p-3 text-sm">
          <label className="block text-xs font-medium text-ink-2" htmlFor={`tpl-${p.id}`}>
            Template da mensagem junta
          </label>
          {approved.length ? (
            <Select
              id={`tpl-${p.id}`}
              value={p.consolidationTemplate ?? ""}
              disabled={busy}
              onChange={(e) => {
                setPicking(false);
                void save({ ...p, consolidationTemplate: e.target.value || null });
              }}
            >
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

const metaCategory = (t: Template): "UTILITY" | "MARKETING" | "AUTHENTICATION" => {
  const c = t.metaCategory ?? t.declaredCategory;
  return c === "MARKETING" || c === "AUTHENTICATION" ? c : "UTILITY";
};

function Backups({ templates }: { templates: Template[] }) {
  const variants = useApi<Variant[]>("templates/mirrors");
  const approved = templates.filter((t) => t.status === "APPROVED");
  const [main, setMain] = useState("");
  const [backup, setBackup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const rows = variants.data ?? [];
  const groups = new Map<string, Variant[]>();
  for (const v of rows) groups.set(v.groupKey, [...(groups.get(v.groupKey) ?? []), v]);
  const ordered = [...groups.values()].map((g) => [...g].sort((a, b) => a.priority - b.priority));

  const byName = (n: string) => approved.find((t) => t.name === n);
  const variantBody = (t: Template, groupKey: string, priority: number) => ({ groupKey, metaTemplateName: t.name, language: t.language, category: metaCategory(t), status: "APPROVED", priority });

  const add = async () => {
    const m = byName(main);
    const b = byName(backup);
    if (!m || !b || m.name === b.name) return;
    setBusy(true);
    setError(null);
    try {
      const existing = rows.find((v) => v.metaTemplateName === m.name);
      const groupKey = existing?.groupKey ?? m.name;
      if (!existing) await api("templates/mirrors", { body: variantBody(m, groupKey, 1) });
      const top = Math.max(1, ...rows.filter((v) => v.groupKey === groupKey).map((v) => v.priority));
      await api("templates/mirrors", { body: variantBody(b, groupKey, top + 1) });
      setBackup("");
      variants.reload();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`templates/mirrors/${id}`, { method: "DELETE" });
      // Without any backup left, the group means nothing: take its main template out too.
      const gone = rows.find((v) => v.id === id);
      const left = rows.filter((v) => v.id !== id && v.groupKey === gone?.groupKey);
      if (left.length === 1) await api(`templates/mirrors/${left[0]!.id}`, { method: "DELETE" });
      variants.reload();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Template reserva" subtitle="Para cada template importante, cadastre uma reserva de utilidade já aprovada pela Meta.">
      <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
        A Meta pode reclassificar um template de utilidade como marketing, que é mais caro. Se ele tiver uma reserva, o WCO passa a usar a reserva sozinho, sem você mexer em nada.
      </p>
      <Example before={["lembrete_consulta virou marketing"]} after="sai lembrete_consulta_b" />

      <div className="mt-6 border-t border-dashed border-rule pt-5">
        {variants.error ? <ErrorBox error={variants.error} /> : null}
        {variants.loading && !variants.data ? <Loading /> : null}
        {ordered.length ? (
          <ul className="mb-5 space-y-3">
            {ordered.map((g) => (
              <li key={g[0]!.groupKey} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">{g[0]!.metaTemplateName}</span>
                {g.slice(1).length ? <ArrowRight className="size-3.5 text-muted" aria-hidden /> : null}
                {g.slice(1).map((v) => (
                  <span key={v.id} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-0.5 pl-2 pr-1 text-ink-2">
                    {v.metaTemplateName}
                    <button type="button" aria-label={`Remover reserva ${v.metaTemplateName}`} disabled={busy} onClick={() => void remove(v.id)} className="grid size-5 place-items-center rounded hover:bg-surface hover:text-ink">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
                {g.length === 1 ? <span className="text-xs text-muted">sem reserva</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {approved.length >= 2 ? (
          <div className="grid max-w-3xl grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label htmlFor="backup-main" className="block text-xs font-medium text-ink-2">
                Template
              </label>
              <Select id="backup-main" value={main} onChange={(e) => setMain(e.target.value)}>
                <option value="">Escolha</option>
                {approved.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="backup-reserve" className="block text-xs font-medium text-ink-2">
                Reserva
              </label>
              <Select id="backup-reserve" value={backup} onChange={(e) => setBackup(e.target.value)}>
                <option value="">Escolha</option>
                {approved
                  .filter((t) => t.name !== main && metaCategory(t) === "UTILITY")
                  .map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </div>
            <Button variant="primary" onClick={() => void add()} loading={busy} disabled={!main || !backup}>
              Adicionar reserva
            </Button>
          </div>
        ) : (
          <Notice>Para cadastrar uma reserva, você precisa de pelo menos dois templates aprovados. Importe os seus na tela Templates.</Notice>
        )}
        {error ? (
          <div className="mt-3">
            <ErrorBox error={error} title="Não foi possível salvar" />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function SavingsPage() {
  const policies = useApi<{ policies: Policy[] }>("optimization/policies");
  const templates = useApi<Template[]>("templates");
  const rows = (policies.data?.policies ?? []).filter(listed);
  const approved = (templates.data ?? []).filter((t) => t.status === "APPROVED").map((t) => t.name);

  return (
    <>
      <PageHeader
        title="Configurar economias"
        description="Estas economias dependem de uma escolha da sua empresa. Ligue as que fizerem sentido. As demais o WCO já faz sozinho, sem configurar nada."
      />

      <div className="space-y-6">
        <Card title="Avisos">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Mode n="1" title="Juntar mensagens parecidas" example={<Example before={["Pagamento aprovado", "Pedido separado"]} after="1 mensagem" />}>
              Várias mensagens sobre o mesmo pedido, em poucos minutos, chegam ao cliente numa mensagem só.
            </Mode>
            <Mode n="2" title="Enviar só o mais recente" example={<Example before={["Separado", "Enviado"]} after="Enviado" />}>
              Se o status muda antes de o aviso sair, o cliente recebe só o status atual.
            </Mode>
            <Mode n="3" title="Mandar como conversa" example={<Example before={["Template"]} after="Mensagem de conversa" />}>
              Se o cliente falou com você nas últimas 24 horas, o aviso vai como mensagem de conversa, quando isso sair mais barato. Promoções só para quem aceitou receber.
            </Mode>
          </div>
          <p className="mt-6 border-t border-dashed border-rule pt-4 text-xs leading-relaxed text-muted">
            Códigos de verificação e alertas críticos sempre saem na hora e não aparecem aqui. Nenhum aviso espera mais do que o tempo mostrado em cada linha.
          </p>

          <div className="mt-6">
            {policies.error ? <ErrorBox error={policies.error} /> : null}
            {policies.loading && !policies.data ? <Loading /> : null}
            {policies.data && rows.length === 0 ? <Notice>Nenhum tipo de aviso configurado ainda.</Notice> : null}
            {rows.length ? (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-x-2 border-b border-dashed border-rule pb-2 text-[11px] font-medium uppercase leading-tight tracking-wide text-muted sm:gap-x-6">
                  <span>Tipo de aviso</span>
                  <span className="w-12 text-center sm:w-[92px]">1. Juntar</span>
                  <span className="w-12 text-center sm:w-[92px]">2. Só o mais recente</span>
                  <span className="w-12 text-center sm:w-[92px]">3. Como conversa</span>
                </div>
                <ul className="divide-y divide-dashed divide-[var(--rule)]">
                  {rows.map((p) => (
                    <Row key={p.id} initial={p} approved={approved} />
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </Card>

        {templates.data ? <Backups templates={templates.data} /> : null}
      </div>
    </>
  );
}
