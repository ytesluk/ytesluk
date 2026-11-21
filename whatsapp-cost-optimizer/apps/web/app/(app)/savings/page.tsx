"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Clock3, X } from "lucide-react";
import { Button, Card, ErrorBox, Loading, Notice, PageHeader } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

/**
 * "Economia de juntar mensagens": the company writes, here, the one message that carries several
 * updates of the same order. The API sends it to Meta as a template and switches joining on; this
 * page explains the idea with two wrong/right examples and shows Meta's answer.
 * The company types the friendly marker [atualizações]; the API receives {{atualizacoes}}.
 */

interface JoinMessage {
  connected: boolean;
  current: { name: string; status: string; text: string | null; writtenInWco: boolean } | null;
}

const MARK = "[atualizações]";
const PARAM = "{{atualizacoes}}";
const EXAMPLE = "pagamento aprovado; pedido separado; pedido enviado";
const SUGGESTION = `Olá! Novidades do seu pedido: ${MARK}. Qualquer dúvida, é só responder esta mensagem.`;

const toApi = (t: string) => t.split(MARK).join(PARAM);
const fromApi = (t: string) => t.split(PARAM).join(MARK);

/** The same rules the API applies (Meta refuses a body that starts or ends with a variable). */
function problems(raw: string): string[] {
  const text = raw.trim();
  const out: string[] = [];
  const marks = text.split(MARK).length - 1;
  if (marks === 0) out.push(`Inclua ${MARK} onde as novidades devem aparecer.`);
  if (marks > 1) out.push(`Use ${MARK} só uma vez.`);
  if (/\{\{|\}\}/.test(text)) out.push("Tire as chaves {{ }}: use só o marcador das atualizações.");
  if (marks === 1 && text.startsWith(MARK)) out.push(`Escreva algo antes de ${MARK}.`);
  if (marks === 1 && text.endsWith(MARK)) out.push(`Escreva algo depois de ${MARK}.`);
  if (marks >= 1 && text.split(MARK).join(" ").split(/\s+/).filter(Boolean).length < 4) out.push("Escreva um pouco mais de texto.");
  if (toApi(text).length > 1024) out.push("A mensagem pode ter no máximo 1024 caracteres.");
  return out;
}

function Bubble({ from, children }: { from: "client" | "company"; children: React.ReactNode }) {
  return (
    <div className={`flex ${from === "company" ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${
          from === "company" ? "rounded-br-md bg-[#d9fdd3] text-[#111b21]" : "rounded-bl-md bg-surface text-ink ring-1 ring-inset ring-[var(--line)]"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function Side({ right, count, children }: { right: boolean; count: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col rounded-2xl p-4 ring-1 ring-inset ${right ? "bg-[#30a46c]/10 ring-[#30a46c]/35" : "bg-[#e5484d]/10 ring-[#e5484d]/35"}`}>
      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${right ? "text-[#2f9e65]" : "text-[#e5484d]"}`}>
        {right ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
        {right ? "Jeito certo" : "Jeito errado"}
      </p>
      <div className="mt-3 flex-1 space-y-1.5">{children}</div>
      <p className={`mt-3 text-xs font-medium ${right ? "text-[#2f9e65]" : "text-[#e5484d]"}`}>{count}</p>
    </div>
  );
}

function ExampleBlock({ title, note, ask, wrong, right }: { title: string; note: string; ask?: string; wrong: string[]; right: string }) {
  return (
    <div>
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
      {ask ? (
        <div className="mt-3">
          <Bubble from="client">{ask}</Bubble>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Side right={false} count={`${wrong.length} mensagens cobradas`}>
          {wrong.map((w) => (
            <Bubble key={w} from="company">
              {w}
            </Bubble>
          ))}
        </Side>
        <Side right count="1 mensagem cobrada">
          <Bubble from="company">{right}</Bubble>
        </Side>
      </div>
    </div>
  );
}

function Status({ current }: { current: NonNullable<JoinMessage["current"]> }) {
  if (!current.writtenInWco) {
    return current.status === "APPROVED" ? (
      <Notice tone="good">
        A junção já está ativa com o template <strong>{current.name}</strong>, aprovado pela Meta. Se quiser usar um texto seu, escreva abaixo.
      </Notice>
    ) : null;
  }
  if (current.status === "APPROVED")
    return (
      <Notice tone="good">
        <strong>Economia ativa.</strong> A Meta aprovou a sua mensagem e o WCO já junta as novidades de um mesmo pedido.
      </Notice>
    );
  if (current.status === "PENDING")
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-rule bg-surface px-4 py-3 text-sm leading-relaxed text-ink-2">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-serious" aria-hidden />
        <p>
          <strong className="text-ink">Em análise na Meta.</strong> Costuma levar de minutos a algumas horas. Enquanto isso, as mensagens saem separadas, como hoje.
        </p>
      </div>
    );
  return (
    <Notice tone="warning">
      <strong>A Meta não aprovou esta mensagem.</strong> Ajuste o texto e envie de novo. Enquanto isso, as mensagens saem separadas.
    </Notice>
  );
}

function Editor({ data, onSaved }: { data: JoinMessage; onSaved: (d: JoinMessage) => void }) {
  const initial = data.current?.writtenInWco && data.current.text ? fromApi(data.current.text) : SUGGESTION;
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const issues = problems(text);
  const [before, after] = text.includes(MARK) ? [text.slice(0, text.indexOf(MARK)), text.slice(text.indexOf(MARK) + MARK.length)] : [text, ""];
  const unchanged = !!data.current?.writtenInWco && data.current.status !== "REJECTED" && toApi(text.trim()) === (data.current.text ?? "");

  const insert = () => {
    const el = box.current;
    const at = el ? el.selectionStart : text.length;
    const next = text.slice(0, at) + MARK + text.slice(el ? el.selectionEnd : at);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + MARK.length, at + MARK.length);
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<JoinMessage>("optimization/join-message", { body: { text: toApi(text.trim()) } });
      onSaved(d);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="join-text" className="block text-sm font-medium text-ink">
          Sua mensagem
        </label>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Onde estiver <strong className="text-ink-2">{MARK}</strong>, o WCO coloca as novidades do pedido, todas juntas.
        </p>
        <textarea
          id="join-text"
          ref={box}
          rows={4}
          value={text}
          maxLength={1100}
          onChange={(e) => setText(e.target.value)}
          className="mt-2 w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" className="h-8 text-xs" onClick={insert}>
            Inserir {MARK}
          </Button>
          <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setText(SUGGESTION)}>
            Usar a sugestão
          </Button>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Como o cliente vai receber</p>
        <div className="mt-2 rounded-2xl bg-surface-2 p-4">
          <Bubble from="company">
            {before}
            {text.includes(MARK) ? <span className="rounded bg-[#fff3a3] px-0.5 text-[#111b21]">{EXAMPLE}</span> : null}
            {after}
          </Bubble>
        </div>
      </div>

      {issues.length ? (
        <ul className="space-y-1 text-sm text-serious">
          {issues.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      ) : null}

      {error ? <ErrorBox error={error} title="A mensagem não foi enviada" /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!data.connected || issues.length > 0 || unchanged}>
          Enviar para aprovação da Meta
        </Button>
        {!data.connected ? (
          <span className="text-sm text-ink-2">
            Primeiro, <Link href="/admin/providers" className="font-medium text-ink underline underline-offset-2">conecte o WhatsApp da empresa</Link>.
          </span>
        ) : unchanged ? (
          <span className="text-xs text-muted">Esta é a mensagem que já está em uso.</span>
        ) : (
          <span className="text-xs text-muted">A Meta analisa todo modelo de mensagem antes de liberar o envio.</span>
        )}
      </div>
    </div>
  );
}

export default function JoinSavingsPage() {
  const { data, error, loading } = useApi<JoinMessage>("optimization/join-message");
  const [state, setState] = useState<JoinMessage | null>(null);
  const current = state ?? data;

  return (
    <>
      <PageHeader
        title="Economia de juntar mensagens"
        description="Juntar mensagens é uma das formas de a sua empresa economizar dinheiro. Configure agora, se fizer sentido para a sua empresa. As demais economias o WCO já faz sozinho, sem você configurar nada."
      />

      <div className="max-w-4xl space-y-6">
        <Card title="Como funciona">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Em vez de mandar uma mensagem de cada vez para o cliente, você manda tudo o que for necessário em <strong className="text-ink">uma mensagem só</strong>. Cada mensagem enviada é cobrada, então menos mensagens significa uma fatura menor.
          </p>
          <p className="mt-4 text-sm font-medium text-ink">Veja como funcionaria:</p>
          <div className="mt-4 space-y-8">
            <ExampleBlock
              title="Respondendo um orçamento"
              note="O cliente pediu o preço ontem e a empresa responde hoje (passadas 24 horas, cada mensagem é cobrada)."
              ask="Oi! Quanto custa o serviço?"
              wrong={["O serviço custa R$ 300.", "Ficamos na Rua das Flores, 120, no Centro.", "Posso agendar um horário para você?"]}
              right="Olá! O serviço custa R$ 300. Ficamos na Rua das Flores, 120, no Centro. Posso agendar um horário para você?"
            />
            <ExampleBlock
              title="Loja atualizando um pedido"
              note="Três novidades do mesmo pedido em poucos minutos."
              wrong={["Pedido #4521: pagamento aprovado.", "Pedido #4521: pedido separado.", "Pedido #4521: pedido enviado."]}
              right="Olá! Novidades do seu pedido #4521: pagamento aprovado; pedido separado; pedido enviado. Qualquer dúvida, é só responder esta mensagem."
            />
          </div>
        </Card>

        <Card title="Escreva a mensagem que junta tudo" subtitle="Quando houver mais de uma novidade sobre o mesmo pedido, o cliente recebe esta mensagem no lugar de várias.">
          {error ? <ErrorBox error={error} /> : null}
          {loading && !current ? <Loading /> : null}
          {current ? (
            <div className="space-y-5">
              {current.current ? <Status current={current.current} /> : null}
              <Editor key={current.current?.name ?? "new"} data={current} onSaved={setState} />
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
