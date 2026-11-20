import { ArrowDown, ArrowRight, MessageCircle, Smartphone } from "lucide-react";
import { Mark } from "@/components/brand";

/**
 * How the WCO works, in one picture: the company's WhatsApp → WCO → the customer. It says what each part
 * does for the business and nothing about how the saving is made.
 */
export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)_auto_minmax(0,1fr)]">
      <li className="flex flex-col rounded-3xl border border-line bg-surface p-6">
        <span className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-ink" aria-hidden>
          <Smartphone className="size-5" />
        </span>
        <p className="figure mt-5 text-[11px] text-muted">01</p>
        <h3 className="mt-1 font-display text-[21px] font-semibold tracking-tight text-ink">O WhatsApp da empresa</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Você conecta o número oficial da sua empresa ao WCO. A equipe continua usando o WhatsApp como sempre.</p>
      </li>

      <Connector />

      <li className="flex flex-col rounded-3xl bg-[#14201b] p-6 text-[#f4f1e6] shadow-[0_30px_50px_-30px_rgba(20,32,27,.6)]">
        <Mark className="size-11" />
        <p className="figure mt-5 text-[11px] text-[#94a39a]">02</p>
        <h3 className="mt-1 font-display text-[21px] font-semibold tracking-tight">O WCO</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-[#c3cdc4]">
          Recebe cada envio antes da Meta e escolhe o caminho <span className="marker">mais econômico</span>, sempre dentro das regras oficiais do WhatsApp.
        </p>
      </li>

      <Connector />

      <li className="flex flex-col rounded-3xl border border-line bg-surface p-6">
        <span className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-ink" aria-hidden>
          <MessageCircle className="size-5" />
        </span>
        <p className="figure mt-5 text-[11px] text-muted">03</p>
        <h3 className="mt-1 font-display text-[21px] font-semibold tracking-tight text-ink">O seu cliente</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Recebe a mensagem pelo número oficial da sua empresa. E a fatura da Meta chega menor no fim do mês.</p>
      </li>
    </ol>
  );
}

function Connector() {
  return (
    <li aria-hidden className="flex items-center justify-center text-muted">
      <ArrowDown className="size-5 lg:hidden" />
      <ArrowRight className="hidden size-5 lg:block" />
    </li>
  );
}
