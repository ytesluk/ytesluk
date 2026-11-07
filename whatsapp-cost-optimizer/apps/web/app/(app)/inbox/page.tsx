"use client";

import { ArrowLeft, Clock, Megaphone, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, cx } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

type Fep = { state: "REPLY_TO_UNLOCK" | "FREE_OPEN" | "LOST" | "EXPIRED"; until: string | null } | null;
interface ConvSummary {
  id: string;
  customer: string;
  lastMessage: string | null;
  lastDirection: "IN" | "OUT" | null;
  lastAt: string;
  waitingReply: boolean;
  windowOpen: boolean;
  windowExpiresAt: string | null;
  fep: Fep;
}
interface InboxList {
  inboxEnabled: boolean;
  conversations: ConvSummary[];
}
interface ChatMsg {
  id: string;
  direction: "IN" | "OUT";
  kind: string;
  text: string | null;
  purged: boolean;
  templateName: string | null;
  occurredAt: string;
  status: { code: string; label: string; joinedInto: string | null } | null;
}
interface Conversation {
  id: string;
  customer: string;
  optedOut: boolean;
  windowOpen: boolean;
  windowExpiresAt: string | null;
  fep: Fep;
  messages: ChatMsg[];
  savings: { repliesTyped: number; messagesSent: number; joined: number; pending: number };
}
interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  metaCategory: string | null;
  declaredCategory: string;
}

const time = (v: string) => new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const when = (v: string) => {
  const d = new Date(v);
  const today = new Date().toDateString() === d.toDateString();
  return today ? time(v) : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
function remaining(until: string | null): string {
  if (!until) return "";
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return "agora";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** The deadlines that decide what a reply costs, in the agent's words. */
function DeadlineBadges({ c, compact }: { c: Pick<ConvSummary, "windowOpen" | "windowExpiresAt" | "fep">; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {c.fep?.state === "REPLY_TO_UNLOCK" ? (
        <Badge tone="warning" title="Lead que veio de anúncio: a primeira resposta em até 24 h libera 72 h de mensagens grátis">
          <Megaphone className="size-3" aria-hidden /> {compact ? `responda em ${remaining(c.fep.until)}` : `Lead de anúncio · responda em ${remaining(c.fep.until)} para 72 h grátis`}
        </Badge>
      ) : null}
      {c.fep?.state === "FREE_OPEN" ? <Badge tone="good">{compact ? "grátis" : `Grátis (anúncio) por mais ${remaining(c.fep.until)}`}</Badge> : null}
      {c.fep?.state === "LOST" && !compact ? <Badge tone="critical">Janela grátis do anúncio perdida</Badge> : null}
      {c.windowOpen ? (
        <Badge tone="info" title="Mensagens livres só dentro de 24 h da última mensagem do cliente">
          <Clock className="size-3" aria-hidden /> {compact ? remaining(c.windowExpiresAt) : `Janela aberta · fecha em ${remaining(c.windowExpiresAt)}`}
        </Badge>
      ) : (
        <Badge tone="neutral">{compact ? "fechada" : "Janela fechada · só template (pago)"}</Badge>
      )}
    </div>
  );
}

function EnableInbox({ onEnabled }: { onEnabled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <Card title="Ativar a caixa de entrada">
      <div className="space-y-3 text-sm text-ink-2">
        <p>Com ela, seus atendentes conversam com os clientes aqui dentro, e o WCO aplica as economias sozinho: junta mensagens picadas, avisa quando a janela vai fechar e lembra do prazo dos leads de anúncio.</p>
        <Notice>
          Para mostrar o histórico, o WCO passa a guardar o texto das conversas — criptografado e apagado após o prazo de retenção em Privacidade (LGPD). Só mensagens recebidas depois de ativar aparecem aqui.
        </Notice>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api("inbox/settings", { body: { enabled: true } });
              onEnabled();
            } catch (e) {
              setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
            } finally {
              setBusy(false);
            }
          }}
        >
          Ativar caixa de entrada
        </Button>
        {error ? <ErrorBox error={error} title="Não foi possível ativar (requer OWNER ou ADMIN)" /> : null}
      </div>
    </Card>
  );
}

/** MOCK only: makes a fake customer write to the business, to try the inbox without Meta. */
function SimulateCustomer({ onSent }: { onSent: () => void }) {
  const [phone, setPhone] = useState("+5541999990001");
  const [text, setText] = useState("Oi! Vi o anúncio, quanto custa?");
  const [viaAd, setViaAd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <Card title="Simular cliente (modo MOCK)" subtitle="Um cliente fictício escreve para a empresa. Nada sai para o WhatsApp de verdade.">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("dev/simulate-inbound", { body: { customer: phone, text, viaAd } });
            setTimeout(onSent, 1200);
          } catch (err) {
            setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Telefone do cliente">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </Field>
        <Field label="Mensagem">
          <Input value={text} onChange={(e) => setText(e.target.value)} required />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4" checked={viaAd} onChange={(e) => setViaAd(e.target.checked)} />
          Veio de um anúncio (clique para WhatsApp)
        </label>
        <Button type="submit" loading={busy} className="w-full">
          Cliente envia
        </Button>
        {error ? <ErrorBox error={error} title="Simulação recusada" /> : null}
      </form>
    </Card>
  );
}

function Bubble({ m }: { m: ChatMsg }) {
  const out = m.direction === "OUT";
  const body = m.text ?? (m.templateName ? `Template: ${m.templateName}` : m.purged ? "[conteúdo apagado pela retenção]" : `[${m.kind}]`);
  const joined = m.status?.code === "CONSOLIDATED";
  return (
    <div className={cx("flex", out ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[85%] rounded-xl px-3 py-2 text-sm", out ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm border border-line bg-surface text-ink")}>
        <p className="whitespace-pre-wrap break-words">{body}</p>
        <p className={cx("mt-1 text-right text-[10px]", out ? "text-white/80" : "text-muted")}>
          {time(m.occurredAt)}
          {m.status ? ` · ${joined ? "juntada à próxima (não cobrada à parte)" : m.status.label}` : ""}
        </p>
      </div>
    </div>
  );
}

function Composer({ conv, onSent }: { conv: Conversation; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const templates = useApi<Template[]>(conv.windowOpen ? null : "templates");
  const approved = (templates.data ?? []).filter((t) => t.status === "APPROVED");
  const [tpl, setTpl] = useState("");

  const send = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(`inbox/${conv.id}/reply`, { body });
      setText("");
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };

  if (conv.optedOut) return <Notice tone="warning">Este cliente pediu para não receber mensagens (opt-out).</Notice>;
  if (!conv.windowOpen) {
    const chosen = approved.find((t) => t.id === tpl);
    return (
      <div className="space-y-2">
        <Notice tone="warning">A janela de 24 h fechou. A Meta só permite enviar um template aprovado — é uma mensagem paga. Se o cliente escrever de novo, a janela reabre.</Notice>
        <div className="flex gap-2">
          <Select value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Template">
            <option value="">Escolha um template aprovado…</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language}) · {(t.metaCategory ?? t.declaredCategory).toLowerCase()}
              </option>
            ))}
          </Select>
          <Button variant="primary" disabled={!chosen} loading={busy} onClick={() => chosen && send({ template: { name: chosen.name, language: chosen.language }, data: {} })}>
            Enviar template
          </Button>
        </div>
        {error ? <ErrorBox error={error} title="Envio recusado" /> : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void send({ text: text.trim() });
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) void send({ text: text.trim() });
            }
          }}
          rows={2}
          placeholder="Digite a resposta (Enter envia, Shift+Enter quebra linha)"
          aria-label="Resposta"
          className="min-h-11 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
        />
        <Button type="submit" variant="primary" loading={busy} aria-label="Enviar">
          <Send className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="text-[11px] text-muted">Mensagens enviadas em sequência são juntadas em uma só (até ~8 s de pausa), para pagar uma mensagem em vez de várias.</p>
      {error ? <ErrorBox error={error} title="Envio recusado" /> : null}
    </form>
  );
}

function Chat({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload } = useApi<Conversation>(`inbox/${id}`, { refreshMs: 3000 });
  const end = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect must
  // return nothing or a cleanup function.
  useEffect(() => {
    void end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const s = data.savings;
  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-md p-1 text-ink-2 hover:bg-surface-2 lg:hidden" aria-label="Voltar para a lista">
          <ArrowLeft className="size-4" />
        </button>
        <div className="mr-auto">
          <p className="text-sm font-semibold text-ink">{data.customer}</p>
          {s.repliesTyped > 0 ? (
            <p className="text-[11px] text-muted">
              {s.repliesTyped} resposta(s) digitada(s) → {s.messagesSent} mensagem(ns) enviada(s)
              {s.joined > 0 ? ` · ${s.joined} juntada(s) (não enviadas à parte)` : ""}
              {s.pending > 0 ? ` · ${s.pending} aguardando` : ""}
            </p>
          ) : null}
        </div>
        <DeadlineBadges c={data} />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-page px-4 py-4">
        {data.messages.length === 0 ? <Empty>Nenhuma mensagem guardada ainda.</Empty> : data.messages.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={end} />
      </div>
      <div className="border-t border-line px-4 py-3">
        <Composer conv={data} onSent={reload} />
      </div>
    </div>
  );
}

export default function InboxPage() {
  const list = useApi<InboxList>("inbox", { refreshMs: 4000 });
  const health = useApi<{ mockWhatsApp: boolean }>("health");
  const [selected, setSelected] = useState<string | null>(null);
  const convs = list.data?.conversations ?? [];

  return (
    <>
      <PageHeader title="Caixa de entrada" description="Converse com os clientes aqui dentro: o WCO junta mensagens picadas, controla a janela de 24 h e o prazo dos leads de anúncio." />
      {list.error ? <ErrorBox error={list.error} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && !list.data.inboxEnabled ? <EnableInbox onEnabled={list.reload} /> : null}
      {list.data?.inboxEnabled ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,1fr)_2fr]">
          <div className={cx("space-y-4", selected ? "hidden lg:block" : "")}>
            <Card title="Conversas" padded={false}>
              {convs.length === 0 ? (
                <Empty>Nenhuma conversa ainda. {health.data?.mockWhatsApp ? "Use “Simular cliente” abaixo." : "Elas aparecem quando um cliente escrever."}</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {convs.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setSelected(c.id)} className={cx("w-full px-4 py-3 text-left hover:bg-surface-2", selected === c.id && "bg-surface-2")}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={cx("truncate text-sm", c.waitingReply ? "font-semibold text-ink" : "text-ink")}>{c.customer}</span>
                          <span className="shrink-0 text-[11px] text-muted">{when(c.lastAt)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-2">
                          {c.lastDirection === "OUT" ? "Você: " : ""}
                          {c.lastMessage ?? "—"}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          {c.waitingReply ? <Badge tone="info">aguardando resposta</Badge> : null}
                          <DeadlineBadges c={c} compact />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {health.data?.mockWhatsApp ? <SimulateCustomer onSent={list.reload} /> : null}
          </div>
          <div className={cx(selected ? "" : "hidden lg:block")}>
            <Card padded={false}>
              {selected ? <Chat key={selected} id={selected} onBack={() => setSelected(null)} /> : <Empty>Escolha uma conversa.</Empty>}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
