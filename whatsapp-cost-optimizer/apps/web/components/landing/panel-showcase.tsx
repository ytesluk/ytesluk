import { ArrowRight } from "lucide-react";
import { Mark } from "@/components/brand";
import { Badge, ConfidenceBadge } from "@/components/ui";

/**
 * The dashboard's opening screen, rebuilt in HTML with the product's own pieces (so it is sharp at
 * any size and zoom, unlike a screenshot): the month's saving, estimated and confirmed side by side,
 * the cost with and without the WCO, and the meter in the corner. Example figures, labelled as such.
 * Inside a `ScrollStage` the window rises into place as the section arrives.
 */
export function PanelShowcase() {
  return (
    <figure>
      <div className="stage3d-inner relative">
        <div className="theme-paper panel-window">
          <div className="flex h-9 items-center gap-1.5 bg-[#e3dfd2] px-4" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#14201b]/20" />
            <span className="size-2.5 rounded-full bg-[#14201b]/20" />
            <span className="size-2.5 rounded-full bg-[#14201b]/20" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-dashed border-rule px-5 py-3 sm:px-7">
            <div className="flex items-center gap-2.5">
              <Mark className="size-8 shrink-0" />
              <div>
                <p className="text-[14px] font-semibold leading-tight text-ink">Loja Exemplo</p>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Visão geral</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="demo">Dados de demonstração</Badge>
              <div className="hidden rounded-full border border-rule p-0.5 text-[11px] font-medium text-ink-2 sm:flex" aria-hidden>
                <span className="px-2.5 py-1">7 dias</span>
                <span className="rounded-full bg-[#14201b] px-2.5 py-1 text-[#f4f1e6]">30 dias</span>
                <span className="px-2.5 py-1">90 dias</span>
              </div>
            </div>
          </div>

          <div className="px-5 pb-14 pt-6 sm:px-7 lg:pb-[92px]">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">Últimos 30 dias</p>
            <p className="mt-2 font-display text-[30px] font-semibold leading-[1.05] tracking-tight text-ink">Você deixou de pagar</p>
            <p className="figure mt-2.5 text-[38px] font-semibold leading-none text-ink">
              <span className="marker">R$ 5.526,00</span>
            </p>
            <ul className="mt-5 space-y-2 text-[13px] leading-snug text-ink-2">
              <li className="flex flex-wrap items-center gap-2">
                <ConfidenceBadge value="ESTIMATED" /> pela conta do WCO
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <ConfidenceBadge value="REALIZED" />
                <span>
                  <span className="figure font-semibold text-ink">R$ 4.190,00</span> já confirmados pela Meta
                </span>
              </li>
            </ul>

            <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
              <div className="rounded-xl border border-dashed border-rule p-3">
                <p className="text-[11.5px] leading-tight text-ink-2">Custo sem WCO</p>
                <p className="figure struck mt-2 whitespace-nowrap text-[14px] sm:text-[17px]">R$ 18.420,00</p>
                <p className="mt-1.5 text-[10.5px] leading-tight text-muted">estimado</p>
              </div>
              <ArrowRight className="size-4 self-center text-muted" aria-hidden />
              <div className="rounded-xl border border-line bg-surface p-3">
                <p className="text-[11.5px] leading-tight text-ink-2">Custo com WCO</p>
                <p className="figure mt-2 whitespace-nowrap text-[14px] font-semibold text-ink sm:text-[17px]">R$ 12.894,00</p>
                <p className="mt-1.5 text-[10.5px] leading-tight text-muted">30% a menos</p>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-[13px] leading-snug text-ink-2">
                De cada <strong className="text-ink">R$ 100</strong> da fatura, <strong className="text-ink">R$ 30</strong> ficaram no caixa.
              </p>
              <div className="mt-2.5 flex h-3 gap-[2px]" aria-hidden>
                <span className="rounded-l-[4px] bg-ink" style={{ width: "70%" }} />
                <span className="rounded-r-[4px] bg-marker ring-1 ring-inset ring-[var(--rule)]" style={{ width: "30%" }} />
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink-2">
                <li className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-[3px] bg-ink" aria-hidden />
                  <span className="figure text-ink">R$ 70</span> pagos à Meta
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-[3px] bg-marker ring-1 ring-inset ring-[var(--rule)]" aria-hidden />
                  <span className="figure text-ink">R$ 30</span> economizados
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* The running total kept in the corner of every screen of the dashboard. */}
        <div className="panel-meter float-z theme-paper" style={{ ["--z" as string]: "55px" }} aria-hidden>
          <p className="font-mono text-[9.5px] uppercase tracking-widest text-muted">Economímetro · 30 dias</p>
          <p className="figure mt-1.5 text-[19px] font-semibold text-ink">
            <span className="marker">R$ 5.526,00</span>
          </p>
          <p className="mt-1.5 text-[10.5px] leading-snug text-muted">deixou de ser pago (estimado)</p>
        </div>
      </div>
      <figcaption className="mt-9 font-mono text-[11px] uppercase tracking-wider text-muted">Painel do WCO, com valores de exemplo</figcaption>
    </figure>
  );
}
