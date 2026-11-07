"use client";

import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, Megaphone, MessageCirclePlus, Search, SendHorizontal, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, Select, cx } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

/*
 * Inbox laid out like WhatsApp (list of chats + conversation), so agents feel at home. What the WCO
 * adds is visible but discreet: replies joined into one message, the 24 h window and the ad-lead
 * deadline that decides whether the next 72 h are free.
 */

type Fep = { state: "REPLY_TO_UNLOCK" | "FREE_OPEN" | "LOST" | "EXPIRED"; until: string | null } | null;
interface ConvSummary {
  id: string;
  customer: string;
  lastMessage: string | null;
  lastDirection: "IN" | "OUT" | null;
  lastStatus: string | null;
  lastAt: string;
  waitingReply: boolean;
  unread: number;
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
  intentId: string | null;
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
function listTime(v: string): string {
  const d = new Date(v);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time(v);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function dayLabel(v: string): string {
  const t = listTime(v);
  return t.includes(":") ? "Hoje" : t;
}
function remaining(until: string | null): string {
  if (!until) return "";
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return "agora";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function Avatar({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full bg-chat-meta/25 text-chat-meta", size === "md" ? "size-11" : "size-9")}>
      <User className={size === "md" ? "size-6" : "size-5"} aria-hidden />
    </span>
  );
}

const NOT_SENT = new Set(["FAILED", "BLOCKED", "CANCELLED"]);

/** WhatsApp-style delivery ticks for a business message. */
function Ticks({ code }: { code: string | undefined }) {
  if (!code) return null;
  if (code === "READ") return <CheckCheck className="size-4 text-chat-read" aria-label="lida" />;
  if (code === "DELIVERED") return <CheckCheck className="size-4" aria-label="entregue" />;
  if (code === "SENT") return <Check className="size-4" aria-label="enviada" />;
  if (NOT_SENT.has(code)) return <AlertCircle className="size-3.5 text-critical" aria-label="não enviada" />;
  return <Clock className="size-3.5" aria-label="aguardando" />;
}

/** The deadlines that decide what a reply costs. */
function CostHints({ c, compact }: { c: Pick<ConvSummary, "windowOpen" | "windowExpiresAt" | "fep">; compact?: boolean }) {
  const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium";
  return (
    <>
      {c.fep?.state === "REPLY_TO_UNLOCK" ? (
        <span className={cx(pill, "bg-warning/20 text-ink")} title="Lead de anúncio: responder em até 24 h libera 72 h de mensagens grátis">
          <Megaphone className="size-3" aria-hidden />
          {compact ? `responda em ${remaining(c.fep.until)}` : `Lead de anúncio · responda em ${remaining(c.fep.until)} para 72 h grátis`}
        </span>
      ) : null}
      {c.fep?.state === "FREE_OPEN" && !compact ? <span className={cx(pill, "bg-chat-unread/20 text-ink")}>Grátis (anúncio) por mais {remaining(c.fep.until)}</span> : null}
      {c.fep?.state === "LOST" && !compact ? <span className={cx(pill, "bg-critical/15 text-ink")}>Janela grátis do anúncio perdida</span> : null}
      {!c.windowOpen ? (
        <span className={cx(pill, "bg-chat-meta/20 text-ink")} title="Passadas 24 h da última mensagem do cliente, a Meta só aceita template aprovado (pago)">
          janela fechada
        </span>
      ) : !compact ? (
        <span className={cx(pill, "bg-chat-meta/15 text-ink")} title="Mensagens livres só dentro de 24 h da última mensagem do cliente">
          <Clock className="size-3" aria-hidden /> janela fecha em {remaining(c.windowExpiresAt)}
        </span>
      ) : null}
    </>
  );
}

function EnableInbox({ onEnabled }: { onEnabled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <Card title="Ativar a caixa de entrada">
      <div className="space-y-3 text-sm text-ink-2">
        <p>Com ela, seus atendentes conversam com os clientes aqui dentro, e o WCO aplica as economias sozinho: junta mensagens picadas, avisa quando a janela vai fechar e lembra do prazo dos leads de anúncio.</p>
        <Notice>Para mostrar o histórico, o WCO passa a guardar o texto das conversas — criptografado e apagado após o prazo de retenção em Privacidade (LGPD). Só mensagens recebidas depois de ativar aparecem aqui.</Notice>
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

/** MOCK only: a fake customer writes to the business, to try the inbox without Meta. */
function SimulateCustomer({ onSent, onClose }: { onSent: () => void; onClose: () => void }) {
  const [phone, setPhone] = useState("+5541999990002");
  const [text, setText] = useState("Oi! Vi o anúncio, quanto custa?");
  const [viaAd, setViaAd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="absolute inset-x-2 top-14 z-20 rounded-xl border border-line bg-surface p-4 shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Simular cliente (modo MOCK)</p>
          <p className="text-xs text-muted">Um cliente fictício escreve para a empresa. Use outro telefone para abrir outra conversa.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
          <X className="size-4" />
        </button>
      </div>
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
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Cliente envia
        </Button>
        {error ? <ErrorBox error={error} title="Simulação recusada" /> : null}
      </form>
    </div>
  );
}

/**
 * What the customer actually received: replies joined by the WCO become ONE bubble, exactly as the
 * WhatsApp message arrived. Replies still waiting to be joined stay separate with a clock.
 */
type MsgItem = { kind: "msg"; dir: "IN" | "OUT"; lines: string[]; at: string; code?: string; joined: number; template: string | null; key: string };
type Item = { kind: "day"; label: string; key: string } | MsgItem;
function toItems(messages: ChatMsg[]): Item[] {
  const byIntent = new Map(messages.filter((m) => m.intentId).map((m) => [m.intentId!, m]));
  const joinedInto = new Map<string, ChatMsg[]>();
  const isJoined = (m: ChatMsg) => m.status?.code === "CONSOLIDATED" && !!m.status.joinedInto && byIntent.has(m.status.joinedInto);
  for (const m of messages) if (isJoined(m)) joinedInto.set(m.status!.joinedInto!, [...(joinedInto.get(m.status!.joinedInto!) ?? []), m]);
  const items: Item[] = [];
  let lastDay = "";
  for (const m of messages) {
    if (isJoined(m)) continue; // shown inside the message it was joined into
    const day = dayLabel(m.occurredAt);
    if (day !== lastDay) items.push({ kind: "day", label: day, key: `d-${m.id}` });
    lastDay = day;
    const parts = [...(m.intentId ? (joinedInto.get(m.intentId) ?? []) : []), m];
    const lines = parts.map((p) => p.text ?? (p.purged ? "[conteúdo apagado pela retenção]" : p.templateName ? `Template: ${p.templateName}` : `[${p.kind}]`));
    items.push({ kind: "msg", dir: m.direction, lines, at: m.occurredAt, code: m.status?.code, joined: parts.length - 1, template: m.templateName, key: m.id });
  }
  return items;
}

function Bubble({ item }: { item: MsgItem }) {
  const out = item.dir === "OUT";
  return (
    <div className={cx("flex", out ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[78%] rounded-lg px-2.5 pb-1 pt-1.5 text-[14.2px] leading-[19px] text-chat-ink shadow-sm", out ? "rounded-tr-none bg-chat-out" : "rounded-tl-none bg-chat-in")}>
        {item.template ? <p className="mb-0.5 text-[11px] font-medium text-chat-meta">Template (mensagem paga)</p> : null}
        <p className="whitespace-pre-wrap break-words">{item.lines.join("\n")}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-chat-meta">
          {time(item.at)}
          {out ? <Ticks code={item.code} /> : null}
        </p>
        {item.code && NOT_SENT.has(item.code) ? (
          <p className="text-[11px] font-medium text-critical">Não entregue: veja o motivo em Mensagens</p>
        ) : item.joined > 0 ? (
          <p className="mt-1 border-t border-chat-meta/20 pt-0.5 text-[10.5px] text-chat-meta">
            {item.joined + 1} mensagens juntadas em 1: o cliente recebeu assim e conta como uma só
          </p>
        ) : null}
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

  if (conv.optedOut) return <p className="px-4 py-3 text-center text-sm text-chat-meta">Este cliente pediu para não receber mensagens (opt-out).</p>;
  if (!conv.windowOpen) {
    const chosen = approved.find((t) => t.id === tpl);
    return (
      <div className="space-y-2 px-4 py-3">
        <p className="text-xs text-chat-meta">A janela de 24 h fechou: a Meta só permite um template aprovado (mensagem paga). Se o cliente escrever de novo, a janela reabre.</p>
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
      className="px-3 py-2"
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
          rows={1}
          placeholder="Digite uma mensagem"
          aria-label="Resposta"
          className="max-h-32 min-h-10 w-full resize-none rounded-3xl border-0 bg-chat-in px-4 py-2.5 text-sm text-chat-ink placeholder:text-chat-meta focus:outline-none focus:ring-2 focus:ring-chat-send/40"
        />
        <button type="submit" disabled={busy} className="grid size-10 shrink-0 place-items-center rounded-full bg-chat-send text-white disabled:opacity-60" aria-label="Enviar">
          <SendHorizontal className="size-5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 px-2 text-[10.5px] text-chat-meta">Mensagens mandadas em sequência (até ~8 s de pausa) chegam ao cliente como uma só.</p>
      {error ? <ErrorBox error={error} title="Envio recusado" /> : null}
    </form>
  );
}

function Chat({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload } = useApi<Conversation>(`inbox/${id}`, { refreshMs: 3000 });
  const end = useRef<HTMLDivElement>(null);
  const items = useMemo(() => toItems(data?.messages ?? []), [data]);
  const count = data?.messages.length ?? 0;
  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect must
  // return nothing or a cleanup function.
  useEffect(() => {
    void end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  if (error)
    return (
      <div className="p-4">
        <ErrorBox error={error} />
      </div>
    );
  if (!data) return <Loading />;
  const s = data.savings;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-3 py-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5 text-ink-2 hover:bg-surface lg:hidden" aria-label="Voltar para a lista">
          <ArrowLeft className="size-5" />
        </button>
        <Avatar size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-ink">{data.customer}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <CostHints c={data} />
          </div>
        </div>
        {s.repliesTyped > 0 ? (
          <div className="hidden text-right text-[11px] leading-4 text-muted sm:block">
            <p>
              {s.repliesTyped} digitada(s) → <span className="font-medium text-ink">{s.messagesSent} enviada(s)</span>
            </p>
            {s.joined > 0 ? <p>{s.joined} juntada(s), não cobrada(s) à parte</p> : null}
            {s.pending > 0 ? <p>{s.pending} aguardando</p> : null}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-chat-bg px-[4%] py-3">
        {items.map((it) =>
          it.kind === "day" ? (
            <div key={it.key} className="flex justify-center py-1.5">
              <span className="rounded-md bg-chat-in px-2.5 py-1 text-[11.5px] text-chat-meta shadow-sm">{it.label}</span>
            </div>
          ) : (
            <Bubble key={it.key} item={it} />
          ),
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-line bg-surface-2">
        <Composer conv={data} onSent={reload} />
      </div>
    </div>
  );
}

function ChatList({ convs, selected, onSelect, query }: { convs: ConvSummary[]; selected: string | null; onSelect: (id: string) => void; query: string }) {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const shown = q ? convs.filter((c) => (digits && c.customer.replace(/\D/g, "").includes(digits)) || (c.lastMessage ?? "").toLowerCase().includes(q)) : convs;
  if (shown.length === 0) return <p className="px-6 py-10 text-center text-sm text-muted">{q ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda. Elas aparecem quando um cliente escrever."}</p>;
  return (
    <ul>
      {shown.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onSelect(c.id)} className={cx("flex w-full items-center gap-3 px-3 text-left hover:bg-surface-2", selected === c.id && "bg-surface-2")}>
            <Avatar />
            <div className="min-w-0 flex-1 border-b border-line py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[15px] text-ink">{c.customer}</span>
                <span className={cx("shrink-0 text-[11.5px]", c.unread > 0 ? "font-medium text-chat-send" : "text-muted")}>{listTime(c.lastAt)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {c.lastDirection === "OUT" ? (
                  <span className={cx("shrink-0", c.lastStatus !== "READ" && "text-muted")}>
                    <Ticks code={c.lastStatus ?? undefined} />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{c.lastMessage ?? "—"}</span>
                {c.unread > 0 ? <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-chat-unread px-1.5 text-[11px] font-semibold leading-5 text-white">{c.unread}</span> : null}
              </div>
              {c.fep?.state === "REPLY_TO_UNLOCK" || !c.windowOpen ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  <CostHints c={c} compact />
                </div>
              ) : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function InboxPage() {
  const list = useApi<InboxList>("inbox", { refreshMs: 4000 });
  const health = useApi<{ mockWhatsApp: boolean }>("health");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [simulating, setSimulating] = useState(false);
  const convs = list.data?.conversations ?? [];

  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  if (!list.data.inboxEnabled) return <EnableInbox onEnabled={list.reload} />;

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100dvh-3.5rem)] min-h-[480px] grid-cols-1 overflow-hidden border-line bg-surface sm:mx-0 sm:my-0 sm:h-[calc(100dvh-7rem)] sm:rounded-xl sm:border lg:grid-cols-[minmax(300px,30%)_1fr]">
      <aside className={cx("relative min-h-0 flex-col border-r border-line", selected ? "hidden lg:flex" : "flex")}>
        <div className="flex items-center justify-between gap-2 bg-surface-2 px-4 py-3">
          <h1 className="text-lg font-semibold text-ink">Conversas</h1>
          {health.data?.mockWhatsApp ? (
            <button type="button" onClick={() => setSimulating((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface" title="Modo MOCK: simular um cliente escrevendo">
              <MessageCirclePlus className="size-4" aria-hidden /> Simular cliente
            </button>
          ) : null}
        </div>
        {simulating ? (
          <SimulateCustomer
            onClose={() => setSimulating(false)}
            onSent={() => {
              setSimulating(false);
              list.reload();
            }}
          />
        ) : null}
        <div className="px-3 py-2">
          <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5">
            <Search className="size-4 text-muted" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar conversa" aria-label="Pesquisar conversa" className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatList convs={convs} selected={selected} onSelect={setSelected} query={query} />
        </div>
      </aside>
      <section className={cx("min-h-0 flex-col", selected ? "flex" : "hidden lg:flex")}>
        {selected ? (
          <Chat key={selected} id={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="grid h-full place-items-center bg-chat-bg px-6 text-center">
            <div>
              <p className="text-lg font-medium text-ink">Caixa de entrada do WCO</p>
              <p className="mt-1 max-w-sm text-sm text-muted">Escolha uma conversa. Mensagens mandadas em sequência chegam ao cliente como uma só, e os prazos que mudam o custo aparecem no topo de cada conversa.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
